import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'

export async function GET() {
  if (usesConvex()) return viaConvex('Failed to fetch employees', c => c.query(api.employees.list, {}))
  try {
    await requireUser()
    const employees = await prisma.employee.findMany({ include: { defaultRole: true }, orderBy: { name: 'asc' } })
    return NextResponse.json(employees.map(e => ({
      ...e,
      defaultRole: e.defaultRole ? { id: e.defaultRole.id, name: e.defaultRole.name, active: e.defaultRole.active } : null,
    })))
  } catch (error) {
    return errorResponse(error, 'Failed to fetch employees')
  }
}

export async function POST(request: Request) {
  if (usesConvex()) {
    const body = await request.json()
    return viaConvex('Failed to create employee', c => c.mutation(api.employees.create, { name: String(body.name ?? '') }))
  }
  try {
    const actor = await requireAdmin()
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new HttpError(400, 'Name is required')
    const employee = await prisma.$transaction(async tx => {
      const created = await tx.employee.create({ data: { name, active: true, defaultRoleId: null } })
      await audit(tx, actor, { action: 'employee.create', entityType: 'employee', entityId: created.id, summary: `Added employee ${name}`, after: created })
      return created
    })
    return NextResponse.json(employee)
  } catch (error) {
    return errorResponse(error, 'Failed to create employee')
  }
}
