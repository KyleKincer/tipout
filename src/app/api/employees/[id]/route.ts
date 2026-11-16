import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    return viaConvex('Failed to fetch employee', c => c.query(api.employees.get, { id }))
  }
  try {
    await requireUser()
    const { id } = await params
    const employee = await prisma.employee.findUnique({ where: { id }, include: { defaultRole: true } })
    if (!employee) throw new HttpError(404, 'Employee not found')
    return NextResponse.json({
      ...employee,
      defaultRole: employee.defaultRole ? { id: employee.defaultRole.id, name: employee.defaultRole.name, active: employee.defaultRole.active } : null,
    })
  } catch (error) {
    return errorResponse(error, 'Failed to fetch employee')
  }
}

export async function PUT(request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    const body = await request.json()
    return viaConvex('Failed to update employee', c => c.mutation(api.employees.update, {
      id,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      ...(body.defaultRoleId !== undefined ? { defaultRoleId: body.defaultRoleId || null } : {}),
    }))
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    if (name === '') throw new HttpError(400, 'Name is required')
    const employee = await prisma.$transaction(async tx => {
      const before = await tx.employee.findUnique({ where: { id } })
      if (!before) throw new HttpError(404, 'Employee not found')
      const after = await tx.employee.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
          ...(body.defaultRoleId !== undefined ? { defaultRoleId: body.defaultRoleId || null } : {}),
        },
      })
      await audit(tx, actor, { action: 'employee.update', entityType: 'employee', entityId: id, summary: `Updated employee ${after.name}`, before, after })
      return after
    })
    return NextResponse.json(employee)
  } catch (error) {
    return errorResponse(error, 'Failed to update employee')
  }
}

/** Delete an employee with no shifts. Anyone with shifts is marked inactive instead, so history keeps them. */
export async function DELETE(_request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    return viaConvex('Failed to delete employee', c => c.mutation(api.employees.remove, { id }))
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    await prisma.$transaction(async tx => {
      const before = await tx.employee.findUnique({ where: { id } })
      if (!before) throw new HttpError(404, 'Employee not found')
      const shifts = await tx.shift.count({ where: { employeeId: id } })
      if (shifts > 0) throw new HttpError(409, `${before.name} has ${shifts} shifts, so they can't be deleted. Mark them inactive instead.`)
      await tx.employee.delete({ where: { id } })
      await audit(tx, actor, { action: 'employee.delete', entityType: 'employee', entityId: id, summary: `Deleted employee ${before.name}`, before })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Failed to delete employee')
  }
}
