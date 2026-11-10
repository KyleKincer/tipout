import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { earliestChangeDate, loadVersions } from '@/lib/roleData'
import { affectedShifts } from '@/lib/roleWrites'
import { describeChanges, describeSettings, todayInRestaurant, versionOn } from '@/utils/roleVersions'

type Params = { params: Promise<{ id: string }> }

async function findRole(id: string) {
  const role = await prisma.role.findUnique({ where: { id } })
  if (!role) throw new HttpError(404, 'Role not found')
  return role
}

/** A role with its full settings history. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireUser()
    const { id } = await params
    const role = await findRole(id)
    const versions = (await loadVersions(prisma, [id])).get(id) ?? []
    const today = todayInRestaurant()
    const latest = versions[versions.length - 1]
    const lockedBefore = await earliestChangeDate(prisma)
    return NextResponse.json({
      id: role.id,
      name: role.name,
      active: role.active,
      today,
      current: versionOn(versions, today),
      versions: versions.map((v, i) => ({
        ...v,
        summary: describeSettings(v),
        changes: i > 0 ? describeChanges(versions[i - 1], v) : [],
      })),
      /** New settings may start on this date or later. */
      earliestChange: [lockedBefore, latest?.effectiveFrom].filter(Boolean).sort().pop() ?? null,
      lockedBefore,
      shiftCount: await prisma.shift.count({ where: { roleId: id } }),
      /** Shifts already entered that undoing the latest change would recalculate. */
      undoAffects: versions.length > 1 ? await affectedShifts(prisma, id, latest.effectiveFrom) : null,
    })
  } catch (error) {
    return errorResponse(error, 'Failed to fetch role')
  }
}

/** Rename or archive a role. Settings changes go through /versions so they stay dated. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const role = await findRole(id)
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    const active = typeof body.active === 'boolean' ? body.active : undefined
    if (name === '') throw new HttpError(400, 'Give the role a name.')
    const updated = await prisma.$transaction(async tx => {
      const next = await tx.role.update({ where: { id }, data: { ...(name ? { name } : {}), ...(active !== undefined ? { active } : {}) } })
      const what = [
        name && name !== role.name ? `renamed ${role.name} → ${name}` : null,
        active !== undefined && active !== role.active ? (active ? `restored ${next.name}` : `archived ${next.name}`) : null,
      ].filter(Boolean)
      if (what.length) {
        await audit(tx, actor, { action: 'role.update', entityType: 'role', entityId: id, summary: what.join('; '), before: { name: role.name, active: role.active }, after: { name: next.name, active: next.active } })
      }
      return next
    })
    return NextResponse.json({ id: updated.id, name: updated.name, active: updated.active })
  } catch (error) {
    return errorResponse(error, 'Failed to update role')
  }
}

/** Delete a role that was never used. Roles with shifts are archived instead, so history keeps them. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const role = await findRole(id)
    await prisma.$transaction(async tx => {
      const shifts = await tx.shift.count({ where: { roleId: id } })
      if (shifts > 0) throw new HttpError(409, `${role.name} has ${shifts} shifts, so it can't be deleted. Archive it instead.`)
      const versions = (await loadVersions(tx, [id])).get(id) ?? []
      await tx.roleVersion.deleteMany({ where: { roleId: id } })
      await tx.roleConfig.deleteMany({ where: { roleId: id } })
      await tx.role.delete({ where: { id } })
      await audit(tx, actor, { action: 'role.delete', entityType: 'role', entityId: id, summary: `Deleted unused role ${role.name}`, before: { name: role.name, versions } })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Failed to delete role')
  }
}
