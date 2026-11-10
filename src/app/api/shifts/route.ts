import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireNamedUser, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { assertUnlocked, loadEngineShifts, shiftDateRange } from '@/lib/roleData'
import { assertRoleUsable, parseShiftInput, shiftData, shiftRecord } from '@/lib/shiftWrites'
import { isDateOnly } from '@/utils/roleVersions'

/** Shifts, each with the role settings in effect on its own date. */
export async function GET(request: Request) {
  try {
    await requireUser()
    const params = new URL(request.url).searchParams
    const startDate = params.get('startDate')
    const endDate = params.get('endDate') || startDate
    const where: Prisma.ShiftWhereInput = {}
    if (params.get('employeeId')) where.employeeId = params.get('employeeId')!
    if (params.get('role')) where.role = { name: params.get('role')! }
    if (isDateOnly(startDate) && isDateOnly(endDate)) Object.assign(where, shiftDateRange(startDate, endDate))
    return NextResponse.json(await loadEngineShifts(prisma, where, { date: 'desc' }))
  } catch (error) {
    return errorResponse(error, 'Failed to fetch shifts')
  }
}

/** Add a shift. Not allowed inside a locked pay period. */
export async function POST(request: Request) {
  try {
    const actor = await requireNamedUser()
    const input = parseShiftInput(await request.json())
    const shift = await prisma.$transaction(async tx => {
      await assertUnlocked(tx, [input.date], 'add shifts')
      const role = await assertRoleUsable(tx, input.roleId, input.date)
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId } })
      if (!employee) throw new HttpError(400, 'That employee no longer exists.')
      const created = await tx.shift.create({ data: shiftData(input) })
      await audit(tx, actor, {
        action: 'shift.create', entityType: 'shift', entityId: created.id,
        summary: `Added ${employee.name}'s ${role.name} shift on ${input.date} (${input.hours}h)`,
        after: shiftRecord(created),
      })
      return created
    })
    return NextResponse.json(shiftRecord(shift))
  } catch (error) {
    return errorResponse(error, 'Failed to create shift')
  }
}
