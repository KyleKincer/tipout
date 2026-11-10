import { calculateDailyReport, calculateOverallSummary, summarizeShiftResults } from '@/utils/reportCalculations'
import { mergeWithLocked, type PayPeriodSnapshot } from '@/utils/payPeriods'
import { describeChanges, describeSettings, versionOn, versionsInRange, type DateOnly, type RoleSettings } from '@/utils/roleVersions'
import { loadEngineShifts, loadLockedPeriods, loadVersions, settingsOf, shiftDateRange, type Db } from './roleData'

export type RoleRules = {
  roleId: string
  roleName: string
  versions: { id: string; effectiveFrom: DateOnly; effectiveTo: DateOnly | null; summary: string; changes: string[]; settings: RoleSettings }[]
}

/** The settings each role used during [start, end], with what changed at each switch. */
export async function roleRulesInRange(db: Db, start: DateOnly, end: DateOnly): Promise<RoleRules[]> {
  const roles = await db.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
  const versions = await loadVersions(db)
  return roles
    .map(role => {
      const all = versions.get(role.id) ?? []
      const inRange = versionsInRange(all, start, end)
      return {
        roleId: role.id,
        roleName: role.name,
        versions: inRange.map(v => {
          const previous = all[all.indexOf(v) - 1]
          return {
            id: v.id, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, settings: settingsOf(v),
            summary: describeSettings(v),
            changes: previous ? describeChanges(previous, v) : [],
          }
        }),
      }
    })
    .filter(r => r.versions.length > 0)
}

/** Results as the app calculates them right now, ignoring locks. */
export async function computeLive(db: Db, start: DateOnly, end: DateOnly) {
  const shifts = await loadEngineShifts(db, shiftDateRange(start, end))
  const { shiftResults, employeeSummaries } = calculateDailyReport(shifts)
  return { shifts, shiftResults, employeeSummaries }
}

/** What gets saved when a pay period is locked. */
export async function buildSnapshot(db: Db, start: DateOnly, end: DateOnly): Promise<PayPeriodSnapshot> {
  const { shiftResults, employeeSummaries } = await computeLive(db, start, end)
  const rules = await roleRulesInRange(db, start, end)
  return {
    format: 1,
    generatedAt: new Date().toISOString(),
    startDate: start,
    endDate: end,
    shiftResults,
    employeeSummaries,
    roleVersions: rules.flatMap(r => r.versions.map(v => ({
      roleName: r.roleName, versionId: v.id, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, settings: v.settings,
    }))),
  }
}

/** Everything the Reports and Shifts pages show for a date range. */
export async function buildReport(db: Db, start: DateOnly, end: DateOnly) {
  const live = await computeLive(db, start, end)
  const locked = await loadLockedPeriods(db, start, end)
  const { shiftResults, drift } = mergeWithLocked(live.shiftResults, locked, { startDate: start, endDate: end })
  const versions = await loadVersions(db)
  const roleIds = new Map(live.shifts.map(s => [s.role.name, s.roleId]))

  // Tipout rates by role for the rates chart: the settings in effect on the last day of the range.
  const roleConfigs = Object.fromEntries([...roleIds].map(([name, id]) => {
    const v = versionOn(versions.get(id) ?? [], end)
    const rate = (type: string) => v?.tipouts.find(t => t.tipoutType === type && t.paysTipout)?.percentageRate ?? 0
    return [name, { barTipout: rate('bar'), hostTipout: rate('host'), sa: rate('sa') }]
  }))

  return {
    summary: live.shifts.length ? calculateOverallSummary(live.shifts) : null,
    employeeSummaries: summarizeShiftResults(shiftResults),
    shiftResults,
    roleConfigs,
    rules: await roleRulesInRange(db, start, end),
    lockedPeriods: locked.map(p => ({ id: p.id, startDate: p.startDate, endDate: p.endDate, lockedAt: p.lockedAt, lockedBy: p.lockedBy })),
    drift,
  }
}
