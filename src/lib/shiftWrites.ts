import { HttpError } from './apiAuth'
import { dbDate, loadVersions, type Db } from './roleData'
import { toDateOnly, versionOn, type DateOnly } from '@/utils/roleVersions'
import { InputError, parseShiftInput as parseShift, type ShiftInput } from '@/utils/shiftInput'

export type { ShiftInput } from '@/utils/shiftInput'

/** A shift from a request body, validated; input problems become a 400. */
export function parseShiftInput(body: Record<string, unknown>): ShiftInput {
  try {
    return parseShift(body)
  } catch (error) {
    if (error instanceof InputError) throw new HttpError(400, error.message)
    throw error
  }
}

/** The role must exist, be in use, and have settings for the shift's date. */
export async function assertRoleUsable(db: Db, roleId: string, day: DateOnly, allowArchived = false) {
  const role = await db.role.findUnique({ where: { id: roleId } })
  if (!role) throw new HttpError(400, 'That role no longer exists.')
  if (!role.active && !allowArchived) throw new HttpError(400, `${role.name} is archived. Pick another role or restore it on the roles page.`)
  const versions = (await loadVersions(db, [roleId])).get(roleId) ?? []
  if (!versionOn(versions, day)) {
    const first = versions[0]?.effectiveFrom
    throw new HttpError(400, first ? `${role.name} has no settings before ${first}.` : `${role.name} has no settings yet.`)
  }
  return role
}

export const shiftData = (input: ShiftInput) => ({ ...input, date: dbDate(input.date) })

export const shiftRecord = (s: { id: string; employeeId: string; roleId: string; date: Date; hours: unknown; cashTips: unknown; creditTips: unknown; liquorSales: unknown }) => ({
  id: s.id, employeeId: s.employeeId, roleId: s.roleId, date: toDateOnly(s.date),
  hours: Number(s.hours), cashTips: Number(s.cashTips), creditTips: Number(s.creditTips), liquorSales: Number(s.liquorSales),
})
