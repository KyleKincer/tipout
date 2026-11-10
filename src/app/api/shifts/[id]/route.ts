import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { assertUnlocked, loadEngineShifts } from '@/lib/roleData'
import { assertRoleUsable, parseShiftInput, shiftData, shiftRecord } from '@/lib/shiftWrites'
import { toDateOnly } from '@/utils/roleVersions'

type Params = { params: Promise<{ id: string }> }

/** One shift, with the role settings in effect on its date. */
export async function GET(_request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    return viaConvex('Failed to fetch shift', c => c.query(api.shifts.get, { id }))
  }
  try {
    await requireUser()
    const { id } = await params
    const [shift] = await loadEngineShifts(prisma, { id })
    if (!shift) throw new HttpError(404, 'Shift not found')
    return NextResponse.json(shift)
  } catch (error) {
    return errorResponse(error, 'Failed to fetch shift')
  }
}

/** Change a shift. Neither its old nor its new date may be in a locked pay period. */
export async function PUT(request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    const body = await request.json()
    return viaConvex('Failed to update shift', async c => c.mutation(api.shifts.update, { id, ...parseShiftInput(body) }))
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const input = parseShiftInput(await request.json())
    const updated = await prisma.$transaction(async tx => {
      const before = await tx.shift.findUnique({ where: { id }, include: { employee: true, role: true } })
      if (!before) throw new HttpError(404, 'Shift not found')
      await assertUnlocked(tx, [toDateOnly(before.date), input.date], 'change shifts')
      // An archived role may stay on a shift that already had it.
      await assertRoleUsable(tx, input.roleId, input.date, input.roleId === before.roleId)
      const after = await tx.shift.update({ where: { id }, data: shiftData(input) })
      await audit(tx, actor, {
        action: 'shift.update', entityType: 'shift', entityId: id,
        summary: `Changed ${before.employee.name}'s ${before.role.name} shift on ${toDateOnly(before.date)}`,
        before: shiftRecord(before), after: shiftRecord(after),
      })
      return after
    })
    return NextResponse.json(shiftRecord(updated))
  } catch (error) {
    return errorResponse(error, 'Failed to update shift')
  }
}

/** Delete a shift. Not allowed inside a locked pay period. */
export async function DELETE(_request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    return viaConvex('Failed to delete shift', c => c.mutation(api.shifts.remove, { id }))
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    await prisma.$transaction(async tx => {
      const before = await tx.shift.findUnique({ where: { id }, include: { employee: true, role: true } })
      if (!before) throw new HttpError(404, 'Shift not found')
      await assertUnlocked(tx, [toDateOnly(before.date)], 'delete shifts')
      await tx.shift.delete({ where: { id } })
      await audit(tx, actor, {
        action: 'shift.delete', entityType: 'shift', entityId: id,
        summary: `Deleted ${before.employee.name}'s ${before.role.name} shift on ${toDateOnly(before.date)}`,
        before: shiftRecord(before),
      })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Failed to delete shift')
  }
}
