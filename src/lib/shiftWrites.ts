import { HttpError } from './apiAuth'
import { dbDate, loadVersions, type Db } from './roleData'
import { isDateOnly, toDateOnly, versionOn, type DateOnly } from '@/utils/roleVersions'

export type ShiftInput = {
  employeeId: string
  roleId: string
  date: DateOnly
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

const money = (value: unknown, label: string) => {
  const n = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be zero or more.`)
  return n
}

/** A shift from a request body, validated. Dates are taken as calendar days (YYYY-MM-DD). */
export function parseShiftInput(body: Record<string, unknown>): ShiftInput {
  const date = typeof body.date === 'string' ? body.date.slice(0, 10) : ''
  if (!body.employeeId || !body.roleId || !isDateOnly(date)) throw new HttpError(400, 'Pick an employee, a role and a date.')
  const hours = Number(body.hours)
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new HttpError(400, 'Hours must be more than 0 and at most 24.')
  return {
    employeeId: String(body.employeeId),
    roleId: String(body.roleId),
    date,
    hours,
    cashTips: money(body.cashTips, 'Cash tips'),
    creditTips: money(body.creditTips, 'Credit tips'),
    liquorSales: money(body.liquorSales, 'Liquor sales'),
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
