import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { audit } from './lib/audit'
import { fail, requireAdmin, requireUser } from './lib/auth'
import { mustFind } from './lib/data'
import { buildSnapshot } from './lib/reports'
import { validatePayPeriod, type PayPeriodSnapshot } from '../src/utils/payPeriods'
import { addDays, todayInRestaurant } from '../src/utils/roleVersions'

const dayMs = 86400000

export const list = query({
  args: {},
  handler: async ctx => {
    await requireUser(ctx)
    const rows = (await ctx.db.query('payPeriods').collect()).sort((a, b) => b.startDate.localeCompare(a.startDate))
    const periods = rows.map(p => {
      const snapshot = p.snapshot as PayPeriodSnapshot | null
      return {
        id: p._id as string,
        startDate: p.startDate,
        endDate: p.endDate,
        lockedAt: p.lockedAt ? new Date(p.lockedAt).toISOString() : null,
        lockedBy: p.lockedBy,
        createdBy: p.createdBy,
        shiftCount: snapshot?.shiftResults.length ?? null,
        payrollTips: snapshot ? Number(snapshot.shiftResults.reduce((s, r) => s + r.payrollTips, 0).toFixed(2)) : null,
      }
    })
    // Suggest the next period: right after the latest one, the same length.
    const latest = periods[0]
    const days = latest ? Math.round((Date.parse(latest.endDate) - Date.parse(latest.startDate)) / dayMs) : 13
    const suggestion = latest ? { startDate: addDays(latest.endDate, 1), endDate: addDays(latest.endDate, 1 + days) } : null
    return { periods, suggestion }
  },
})

export const create = mutation({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    const actor = await requireAdmin(ctx)
    const existing = (await ctx.db.query('payPeriods').collect()).map(p => ({ id: p._id as string, startDate: p.startDate, endDate: p.endDate }))
    const problems = validatePayPeriod({ startDate, endDate }, existing)
    if (problems.length) fail(400, problems.join(' '))
    const id = await ctx.db.insert('payPeriods', {
      startDate, endDate, lockedAt: null, lockedBy: null, snapshot: null, createdAt: Date.now(), createdBy: actor.name,
    })
    await audit(ctx, actor, { action: 'payPeriod.create', entityType: 'payPeriod', entityId: id, summary: `Added pay period ${startDate} to ${endDate}` })
    return { id: id as string }
  },
})

/** Save the period's results exactly as calculated now, and block changes to them. */
export const lock = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const actor = await requireAdmin(ctx)
    const period = await mustFind(ctx, 'payPeriods', id, 'Pay period')
    if (period.lockedAt) fail(409, 'That pay period is already locked.')
    if (period.endDate > todayInRestaurant()) fail(409, `This pay period runs through ${period.endDate}. Lock it once it's over.`)
    const snapshot = await buildSnapshot(ctx, period.startDate, period.endDate)
    const payrollTips = snapshot.shiftResults.reduce((s, r) => s + r.payrollTips, 0)
    const lockedAt = Date.now()
    await ctx.db.patch(period._id, { lockedAt, lockedBy: actor.name, snapshot: JSON.parse(JSON.stringify(snapshot)) })
    await audit(ctx, actor, {
      action: 'payPeriod.lock', entityType: 'payPeriod', entityId: period._id,
      summary: `Locked payroll for ${period.startDate} to ${period.endDate}: ${snapshot.shiftResults.length} shifts, $${payrollTips.toFixed(2)} in payroll tips`,
    })
    return { lockedAt: new Date(lockedAt).toISOString() }
  },
})

/** Reopen a locked period. The saved results stay in the change log. */
export const unlock = mutation({
  args: { id: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { id, reason }) => {
    const actor = await requireAdmin(ctx)
    const period = await mustFind(ctx, 'payPeriods', id, 'Pay period')
    if (!period.lockedAt) fail(409, 'That pay period is not locked.')
    const why = reason?.trim()
    if (!why) fail(400, 'Say why it needs unlocking. It goes in the change log.')
    await audit(ctx, actor, {
      action: 'payPeriod.unlock', entityType: 'payPeriod', entityId: period._id,
      summary: `Unlocked payroll for ${period.startDate} to ${period.endDate}: ${why}`,
      before: { lockedAt: new Date(period.lockedAt).toISOString(), lockedBy: period.lockedBy, snapshot: period.snapshot },
    })
    await ctx.db.patch(period._id, { lockedAt: null, lockedBy: null, snapshot: null })
    return { lockedAt: null }
  },
})

/** Remove a pay period that isn't locked. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const actor = await requireAdmin(ctx)
    const period = await mustFind(ctx, 'payPeriods', id, 'Pay period')
    if (period.lockedAt) fail(409, 'Unlock the pay period before removing it.')
    await ctx.db.delete(period._id)
    await audit(ctx, actor, { action: 'payPeriod.delete', entityType: 'payPeriod', entityId: period._id, summary: `Removed pay period ${period.startDate} to ${period.endDate}` })
    return { success: true }
  },
})
