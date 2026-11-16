import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { tipoutValidator } from './schema'
import { audit } from './lib/audit'
import { fail, requireAdmin, requireUser, type Actor } from './lib/auth'
import { allVersions, earliestChangeDate, lockedRanges, mustFind, settingsOf, versionsForRole } from './lib/data'
import {
  describeChanges, describeSettings, isDateOnly, normalizeSettings, planUndoLatest, planVersionChange,
  todayInRestaurant, validateSettings, versionOn, type DateOnly, type RoleSettings,
} from '../src/utils/roleVersions'

type Ctx = QueryCtx | MutationCtx

export const settingsValidator = v.object({
  basePayRate: v.number(),
  tipPoolGroup: v.union(v.string(), v.null()),
  tipouts: v.array(tipoutValidator),
})

/** Shifts already entered for a role on or after a date: the ones a change from that date recalculates. */
async function affectedShifts(ctx: Ctx, roleId: Id<'roles'>, from: DateOnly) {
  const shifts = await ctx.db.query('shifts').withIndex('by_role_date', q => q.eq('roleId', roleId).gte('date', from)).collect()
  const dates = shifts.map(s => s.date).sort()
  return { shifts: shifts.length, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null }
}

const describeAffected = (a: { shifts: number; firstDate: string | null; lastDate: string | null }) =>
  `${a.shifts} ${a.shifts === 1 ? 'shift' : 'shifts'} already entered (${a.firstDate}${a.lastDate !== a.firstDate ? ` to ${a.lastDate}` : ''})`

function requireConfirmation(a: { shifts: number; firstDate: string | null; lastDate: string | null }, confirmed: boolean) {
  if (a.shifts > 0 && !confirmed) fail(409, `This recalculates ${describeAffected(a)}, and everyone who worked those nights. Confirm to go ahead.`)
}

function checkedSettings(settings: RoleSettings) {
  const problems = validateSettings(settings)
  if (problems.length) fail(400, problems.join(' '))
  return normalizeSettings(settings)
}

const versionRow = (roleId: Id<'roles'>, effectiveFrom: DateOnly, settings: RoleSettings, actor: Actor, note?: string | null) => ({
  roleId, effectiveFrom, effectiveTo: null as string | null,
  basePayRate: settings.basePayRate, tipPoolGroup: settings.tipPoolGroup, tipouts: settings.tipouts,
  note: note?.trim() || null, createdAt: Date.now(), createdBy: actor.name,
})

/** Roles with the settings in effect on a date (today unless given). `configs` keeps the shape the shift forms read. */
export const list = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    await requireUser(ctx)
    const day = isDateOnly(date) ? date : todayInRestaurant()
    const roles = (await ctx.db.query('roles').collect()).sort((a, b) => a.name.localeCompare(b.name))
    const versions = await allVersions(ctx)
    return roles.map(role => {
      const all = versions.get(role._id) ?? []
      const current = versionOn(all, day)
      const upcoming = all.find(x => x.effectiveFrom > day)
      return {
        id: role._id as string,
        name: role.name,
        active: role.active,
        asOf: day,
        basePayRate: current?.basePayRate ?? 0,
        tipPoolGroup: current?.tipPoolGroup ?? null,
        settingsFrom: current?.effectiveFrom ?? null,
        summary: current ? describeSettings(current) : 'no settings for this date',
        upcomingChange: upcoming ? { effectiveFrom: upcoming.effectiveFrom, summary: describeSettings(upcoming) } : null,
        configs: (current?.tipouts ?? []).map(t => ({ ...t, effectiveFrom: current!.effectiveFrom, effectiveTo: current!.effectiveTo })),
      }
    })
  },
})

/** A role with its full settings history. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const role = await mustFind(ctx, 'roles', id, 'Role')
    const versions = await versionsForRole(ctx, role._id)
    const today = todayInRestaurant()
    const latest = versions[versions.length - 1]
    const lockedBefore = await earliestChangeDate(ctx)
    const shifts = await ctx.db.query('shifts').withIndex('by_role_date', q => q.eq('roleId', role._id)).collect()
    return {
      id: role._id as string,
      name: role.name,
      active: role.active,
      today,
      current: versionOn(versions, today),
      versions: versions.map((x, i) => ({ ...x, summary: describeSettings(x), changes: i > 0 ? describeChanges(versions[i - 1], x) : [] })),
      earliestChange: [lockedBefore, latest?.effectiveFrom].filter((d): d is string => !!d).sort().pop() ?? null,
      lockedBefore,
      shiftCount: shifts.length,
      undoAffects: versions.length > 1 ? await affectedShifts(ctx, role._id, latest.effectiveFrom) : null,
    }
  },
})

/** Create a role with its first settings, starting on a date. */
export const create = mutation({
  args: { name: v.string(), effectiveFrom: v.string(), settings: settingsValidator, note: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const name = args.name.trim()
    if (!name) fail(400, 'Give the role a name.')
    if (!isDateOnly(args.effectiveFrom)) fail(400, 'Pick the date these settings start.')
    const settings = checkedSettings(args.settings)
    const earliest = await earliestChangeDate(ctx)
    if (earliest && args.effectiveFrom < earliest) fail(409, `Payroll is locked before ${earliest}. Start this role on ${earliest} or later.`)
    const now = Date.now()
    const id = await ctx.db.insert('roles', { name, active: true, createdAt: now, updatedAt: now })
    await ctx.db.insert('roleVersions', versionRow(id, args.effectiveFrom, settings, actor, args.note))
    await audit(ctx, actor, {
      action: 'role.create', entityType: 'role', entityId: id,
      summary: `Created role ${name} from ${args.effectiveFrom}: ${describeSettings(settings)}`,
      after: { name, effectiveFrom: args.effectiveFrom, settings },
    })
    return { id: id as string, name }
  },
})

/** Rename or archive a role. Settings changes go through changeSettings so they stay dated. */
export const update = mutation({
  args: { id: v.string(), name: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const role = await mustFind(ctx, 'roles', args.id, 'Role')
    const name = args.name?.trim()
    if (name === '') fail(400, 'Give the role a name.')
    const next = { name: name ?? role.name, active: args.active ?? role.active }
    await ctx.db.patch(role._id, { ...next, updatedAt: Date.now() })
    const what = [
      name && name !== role.name ? `renamed ${role.name} → ${name}` : null,
      args.active !== undefined && args.active !== role.active ? (args.active ? `restored ${next.name}` : `archived ${next.name}`) : null,
    ].filter(Boolean)
    if (what.length) {
      await audit(ctx, actor, {
        action: 'role.update', entityType: 'role', entityId: role._id, summary: what.join('; '),
        before: { name: role.name, active: role.active }, after: next,
      })
    }
    return { id: role._id as string, ...next }
  },
})

/** Delete a role that was never used. Roles with shifts are archived instead, so history keeps them. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const actor = await requireAdmin(ctx)
    const role = await mustFind(ctx, 'roles', id, 'Role')
    const shifts = await ctx.db.query('shifts').withIndex('by_role_date', q => q.eq('roleId', role._id)).collect()
    if (shifts.length > 0) fail(409, `${role.name} has ${shifts.length} shifts, so it can't be deleted. Archive it instead.`)
    const versions = await ctx.db.query('roleVersions').withIndex('by_role_from', q => q.eq('roleId', role._id)).collect()
    for (const doc of versions) await ctx.db.delete(doc._id)
    for (const e of await ctx.db.query('employees').withIndex('by_default_role', q => q.eq('defaultRoleId', role._id)).collect()) {
      await ctx.db.patch(e._id, { defaultRoleId: null, updatedAt: Date.now() })
    }
    await ctx.db.delete(role._id)
    await audit(ctx, actor, { action: 'role.delete', entityType: 'role', entityId: role._id, summary: `Deleted unused role ${role.name}`, before: { name: role.name, versions } })
    return { success: true }
  },
})

async function planFor(ctx: Ctx, role: Doc<'roles'>, settings: RoleSettings, effectiveFrom: string) {
  if (!isDateOnly(effectiveFrom)) fail(400, 'Pick the date the new settings start.')
  const versions = await versionsForRole(ctx, role._id)
  const plan = planVersionChange(versions, settings, effectiveFrom, await lockedRanges(ctx))
  const affects = plan.ok ? await affectedShifts(ctx, role._id, effectiveFrom) : null
  return { versions, plan, affects }
}

/** What saving new settings from a date would do, including how many entered shifts it recalculates. Saves nothing. */
export const planChange = query({
  args: { id: v.string(), effectiveFrom: v.string(), settings: settingsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const role = await mustFind(ctx, 'roles', args.id, 'Role')
    const { plan, affects } = await planFor(ctx, role, args.settings, args.effectiveFrom)
    return plan.ok ? { ...plan, affects } : plan
  },
})

/** New settings for a role from a date onward. Days before that date keep the settings they had. */
export const changeSettings = mutation({
  args: {
    id: v.string(), effectiveFrom: v.string(), settings: settingsValidator,
    note: v.optional(v.union(v.string(), v.null())), confirmAffected: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const role = await mustFind(ctx, 'roles', args.id, 'Role')
    const { versions, plan, affects } = await planFor(ctx, role, args.settings, args.effectiveFrom)
    if (!plan.ok) fail(409, plan.error)
    requireConfirmation(affects!, args.confirmAffected === true)
    const now = Date.now()
    if (plan.kind === 'create') {
      if (plan.close) await ctx.db.patch(plan.close.id as Id<'roleVersions'>, { effectiveTo: plan.close.effectiveTo })
      await ctx.db.insert('roleVersions', versionRow(role._id, plan.create.effectiveFrom, plan.create.settings, actor, args.note))
    } else if (plan.kind === 'replace') {
      const s = plan.replace.settings
      await ctx.db.patch(plan.replace.id as Id<'roleVersions'>, {
        basePayRate: s.basePayRate, tipPoolGroup: s.tipPoolGroup, tipouts: s.tipouts,
        note: args.note?.trim() || null, createdAt: now, createdBy: actor.name,
      })
    } else {
      await ctx.db.delete(plan.delete as Id<'roleVersions'>)
      await ctx.db.patch(plan.reopen as Id<'roleVersions'>, { effectiveTo: null })
    }
    const note = args.note?.trim()
    await audit(ctx, actor, {
      action: plan.kind === 'create' ? 'settings.change' : 'settings.correct',
      entityType: 'role', entityId: role._id,
      summary: `${role.name} from ${args.effectiveFrom}: ${plan.changes.join('; ')}${note ? ` (${note})` : ''}${affects!.shifts ? `; recalculated ${describeAffected(affects!)}` : ''}`,
      before: versions, after: { effectiveFrom: args.effectiveFrom, settings: args.settings },
    })
    return plan
  },
})

/** Undo the most recent settings change. Needs confirmAffected when it recalculates entered shifts. */
export const undoLatest = mutation({
  args: { id: v.string(), confirmAffected: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const role = await mustFind(ctx, 'roles', args.id, 'Role')
    const versions = await versionsForRole(ctx, role._id)
    const plan = planUndoLatest(versions, await lockedRanges(ctx))
    if (!plan.ok) fail(409, plan.error)
    const removed = versions.find(x => x.id === plan.delete)!
    const affects = await affectedShifts(ctx, role._id, removed.effectiveFrom)
    requireConfirmation(affects, args.confirmAffected === true)
    await ctx.db.delete(plan.delete as Id<'roleVersions'>)
    await ctx.db.patch(plan.reopen as Id<'roleVersions'>, { effectiveTo: null })
    await audit(ctx, actor, {
      action: 'settings.undo', entityType: 'role', entityId: role._id,
      summary: `${role.name}: undid the change from ${removed.effectiveFrom}; settings from ${plan.restores.effectiveFrom} apply again${affects.shifts ? `; recalculated ${describeAffected(affects)}` : ''}`,
      before: removed, after: settingsOf(plan.restores),
    })
    return plan
  },
})

/** Pool names and tipout-sharing group names used by any role, for the settings form's suggestions. */
export const groups = query({
  args: {},
  handler: async ctx => {
    await requireUser(ctx)
    const versions = await ctx.db.query('roleVersions').collect()
    const pools = new Set(versions.map(x => x.tipPoolGroup).filter((p): p is string => !!p))
    const shared = new Set(versions.flatMap(x => x.tipouts.map(t => t.distributionGroup)).filter((g): g is string => !!g))
    return { pools: [...pools].sort(), distributionGroups: [...shared].sort() }
  },
})

/** Each active role's settings on a day, for the "how tips work" page. */
export const settingsOn = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    await requireUser(ctx)
    if (!isDateOnly(date)) fail(400, 'Pick a date.')
    const roles = (await ctx.db.query('roles').collect()).filter(r => r.active).sort((a, b) => a.name.localeCompare(b.name))
    const versions = await allVersions(ctx)
    return roles.map(role => ({ name: role.name, version: versionOn(versions.get(role._id) ?? [], date) }))
  },
})
