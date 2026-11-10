import { isDateOnly, type DateOnly } from './roleVersions'

/** A problem with what someone entered, safe to show them. Callers turn it into a 400. */
export class InputError extends Error {}

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
  if (!Number.isFinite(n) || n < 0) throw new InputError(`${label} must be zero or more.`)
  return n
}

/** A shift from a request body, validated. Dates are taken as calendar days (YYYY-MM-DD). */
export function parseShiftInput(body: Record<string, unknown>): ShiftInput {
  const date = typeof body.date === 'string' ? body.date.slice(0, 10) : ''
  if (!body.employeeId || !body.roleId || !isDateOnly(date)) throw new InputError('Pick an employee, a role and a date.')
  const hours = Number(body.hours)
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new InputError('Hours must be more than 0 and at most 24.')
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
