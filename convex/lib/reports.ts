import type { MutationCtx, QueryCtx } from '../_generated/server'
import { calculateDailyReport, calculateOverallSummary, summarizeShiftResults } from '../../src/utils/reportCalculations'
import { mergeWithLocked, type PayPeriodSnapshot } from '../../src/utils/payPeriods'
import { describeChanges, describeSettings, versionOn, versionsInRange, type DateOnly } from '../../src/utils/roleVersions'
import { allVersions, lockedPeriodsOverlapping, settingsOf, shiftsInRange, toEngineShifts } from './data'

type Ctx = QueryCtx | MutationCtx

/** The settings each role used during [start, end], with what changed at each switch. */
export async function roleRulesInRange(ctx: Ctx, start: DateOnly, end: DateOnly) {
  const roles = (await ctx.db.query('roles').collect()).sort((a, b) => a.name.localeCompare(b.name))
  const versions = await allVersions(ctx)
  return roles
    .map(role => {
      const all = versions.get(role._id) ?? []
      return {
        roleId: role._id as string,
        roleName: role.name,
        versions: versionsInRange(all, start, end).map(v => {
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
export async function computeLive(ctx: Ctx, start: DateOnly, end: DateOnly) {
  const shifts = await toEngineShifts(ctx, await shiftsInRange(ctx, start, end))
  const { shiftResults, employeeSummaries } = calculateDailyReport(shifts)
  return { shifts, shiftResults, employeeSummaries }
}

/** What gets saved when a pay period is locked. */
export async function buildSnapshot(ctx: Ctx, start: DateOnly, end: DateOnly): Promise<PayPeriodSnapshot> {
  const { shiftResults, employeeSummaries } = await computeLive(ctx, start, end)
  const rules = await roleRulesInRange(ctx, start, end)
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

/** Everything the Reports and Shifts pages show for a date range. Same shape as the Postgres /api/reports. */
export async function buildReport(ctx: Ctx, start: DateOnly, end: DateOnly) {
  const live = await computeLive(ctx, start, end)
  const locked = await lockedPeriodsOverlapping(ctx, start, end)
  const { shiftResults, drift } = mergeWithLocked(live.shiftResults, locked, { startDate: start, endDate: end })
  const versions = await allVersions(ctx)
  const roleIds = new Map(live.shifts.map(s => [s.role.name, s.roleId]))

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
    rules: await roleRulesInRange(ctx, start, end),
    lockedPeriods: locked.map(p => ({ id: p.id, startDate: p.startDate, endDate: p.endDate, lockedAt: p.lockedAt, lockedBy: p.lockedBy })),
    drift,
  }
}
