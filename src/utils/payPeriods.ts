import type { EmployeeRoleSummary } from '../types/reports'
import type { ShiftReportResult } from './reportCalculations'
import { addDays, isDateOnly, type DateOnly, type RoleSettings } from './roleVersions'

/** Results exactly as paid, saved when a pay period is locked. */
export type PayPeriodSnapshot = {
  format: 1
  generatedAt: string
  startDate: DateOnly
  endDate: DateOnly
  shiftResults: ShiftReportResult[]
  employeeSummaries: EmployeeRoleSummary[]
  /** The settings each role used during the period, so "what were the rules" never changes either. */
  roleVersions: { roleName: string; versionId: string; effectiveFrom: DateOnly; effectiveTo: DateOnly | null; settings: RoleSettings }[]
}

export type PayPeriodRange = { id?: string; startDate: DateOnly; endDate: DateOnly }
export type LockedPeriod = PayPeriodRange & { id: string; lockedAt: string; lockedBy: string | null; snapshot: PayPeriodSnapshot }

export type MarkedShiftResult = ShiftReportResult & { lockedPeriodId?: string }

export type Drift = {
  shiftId: string
  date: DateOnly
  employeeName: string
  roleName: string
  /** Payroll tips as paid (from the locked snapshot), or null if the shift was added after locking. */
  paid: number | null
  /** Payroll tips as the app calculates them today, or null if the shift was deleted after locking. */
  now: number | null
}

const day = (iso: string) => iso.slice(0, 10)
const inRange = (d: DateOnly, start: DateOnly, end: DateOnly) => start <= d && d <= end

/** Problems with a new pay period, in plain words. */
export function validatePayPeriod(period: PayPeriodRange, existing: PayPeriodRange[]): string[] {
  if (!isDateOnly(period.startDate) || !isDateOnly(period.endDate)) return ['Pick a start and end date.']
  if (period.endDate < period.startDate) return ['The end date has to be on or after the start date.']
  if (period.endDate > addDays(period.startDate, 62)) return ['A pay period can be at most two months long.']
  const clash = existing.find(p => p.id !== period.id && p.startDate <= period.endDate && period.startDate <= p.endDate)
  return clash ? [`That overlaps the pay period ${clash.startDate} to ${clash.endDate}.`] : []
}

/**
 * Report rows for a date range. Days inside a locked pay period show the saved, as-paid results;
 * other days show live results. Pools are worked out one night at a time, so mixing by day is exact.
 * Anything that calculates differently today than it was paid is listed as drift.
 */
export function mergeWithLocked(
  live: ShiftReportResult[],
  locked: LockedPeriod[],
  range: { startDate: DateOnly; endDate: DateOnly },
): { shiftResults: MarkedShiftResult[]; drift: Drift[] } {
  const lockFor = (d: DateOnly) => locked.find(p => inRange(d, p.startDate, p.endDate))
  const shiftResults: MarkedShiftResult[] = live.filter(r => !lockFor(day(r.date)))
  const drift: Drift[] = []
  for (const period of locked) {
    const saved = period.snapshot.shiftResults.filter(r => inRange(day(r.date), range.startDate, range.endDate))
    shiftResults.push(...saved.map(r => ({ ...r, lockedPeriodId: period.id })))
    const liveHere = live.filter(r => inRange(day(r.date), period.startDate, period.endDate))
    const liveById = new Map(liveHere.map(r => [r.id, r]))
    const savedIds = new Set(saved.map(r => r.id))
    for (const r of saved) {
      const now = liveById.get(r.id)
      if (!now || Math.abs(now.payrollTips - r.payrollTips) >= 0.005) {
        drift.push({ shiftId: r.id, date: day(r.date), employeeName: r.employee.name, roleName: r.role.name, paid: r.payrollTips, now: now?.payrollTips ?? null })
      }
    }
    for (const r of liveHere) {
      if (!savedIds.has(r.id) && inRange(day(r.date), range.startDate, range.endDate)) {
        drift.push({ shiftId: r.id, date: day(r.date), employeeName: r.employee.name, roleName: r.role.name, paid: null, now: r.payrollTips })
      }
    }
  }
  shiftResults.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return { shiftResults, drift }
}
