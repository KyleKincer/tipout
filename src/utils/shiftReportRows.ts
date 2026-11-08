import type { ShiftReportResult } from './reportCalculations'

type DisplayFilters = { employeeId?: string; role?: string }

// Filter AFTER the shared report has allocated every contribution for each day.
export function filterShiftReportResults(shifts: ShiftReportResult[], filters: DisplayFilters) {
  return shifts.filter(shift =>
    (!filters.employeeId || shift.employee.id === filters.employeeId) &&
    (!filters.role || shift.role.name === filters.role)
  ).sort((a, b) => b.date.localeCompare(a.date))
}

export type PayrollTipsBreakdown = {
  lines: { label: string; amount: number }[] // signed amounts that add up to payrollTips
  notes: string[]                             // context already baked into the lines
}

type BreakdownInput = Pick<ShiftReportResult,
  'creditTips' | 'originalCreditTips' | 'tipPoolGroup' |
  'paidBarTipout' | 'paidHostTipout' | 'paidSaTipout' |
  'receivedBarTipout' | 'receivedHostTipout' | 'receivedSaTipout'>

const money = (amount: number) => `$${amount.toFixed(2)}`

// Mirrors the payroll formula in calculateProcessedShiftsDaily. Pooled shifts pay
// host/SA tipouts out of the pool before the split, so only bar is subtracted here.
export function payrollTipsBreakdown(shift: BreakdownInput): PayrollTipsBreakdown {
  const pool = shift.tipPoolGroup
  const lines: PayrollTipsBreakdown['lines'] = [
    pool
      ? { label: `${pool} pool share`, amount: shift.creditTips }
      : { label: 'credit tips', amount: shift.originalCreditTips },
  ]
  const notes: string[] = pool
    ? [`${money(shift.originalCreditTips)} gross went into the ${pool} pool, split by hours`]
    : []

  const received: [string, number][] = [
    ['bar tipout received', shift.receivedBarTipout],
    ['host tipout received', shift.receivedHostTipout],
    ['sa tipout received', shift.receivedSaTipout],
  ]
  for (const [label, amount] of received) if (amount > 0) lines.push({ label, amount })

  if (shift.paidBarTipout > 0) lines.push({ label: 'bar tipout', amount: -shift.paidBarTipout })
  const paidHostSa: [string, number][] = [['host tipout', shift.paidHostTipout], ['sa tipout', shift.paidSaTipout]]
  for (const [label, amount] of paidHostSa) {
    if (amount <= 0) continue
    if (pool) notes.push(`${label} ${money(amount)} was paid by the pool before the split`)
    else lines.push({ label, amount: -amount })
  }

  return { lines, notes }
}
