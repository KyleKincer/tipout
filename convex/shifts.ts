import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { audit } from './lib/audit'
import { fail, requireAdmin, requireUser } from './lib/auth'
import { assertUnlocked, findByAnyId, mustFind, shiftsInRange, toEngineShifts, versionsForRole } from './lib/data'
import { isDateOnly, versionOn, type DateOnly } from '../src/utils/roleVersions'
import { InputError, parseShiftInput, type ShiftInput } from '../src/utils/shiftInput'

const shiftArgs = {
  employeeId: v.string(), roleId: v.string(), date: v.string(), hours: v.number(),
  cashTips: v.optional(v.union(v.number(), v.null())),
  creditTips: v.optional(v.union(v.number(), v.null())),
  liquorSales: v.optional(v.union(v.number(), v.null())),
}

const record = (s: Doc<'shifts'>) => ({
  id: s._id as string, employeeId: s.employeeId as string, roleId: s.roleId as string, date: s.date,
  hours: s.hours, cashTips: s.cashTips, creditTips: s.creditTips, liquorSales: s.liquorSales,
})

function parse(body: Record<string, unknown>): ShiftInput {
  try {
    return parseShiftInput(body)
  } catch (error) {
    if (error instanceof InputError) fail(400, error.message)
    throw error
  }
}

/** The role and employee must exist, the role must be in use, and it must have settings for the date. */
async function resolveRefs(ctx: MutationCtx, input: ShiftInput, allowArchivedRoleId?: Id<'roles'>) {
  const role = await findByAnyId(ctx, 'roles', input.roleId)
  if (!role) fail(400, 'That role no longer exists.')
  if (!role.active && role._id !== allowArchivedRoleId) fail(400, `${role.name} is archived. Pick another role or restore it on the roles page.`)
  const versions = await versionsForRole(ctx, role._id)
  if (!versionOn(versions, input.date)) {
    const first = versions[0]?.effectiveFrom
    fail(400, first ? `${role.name} has no settings before ${first}.` : `${role.name} has no settings yet.`)
  }
  const employee = await findByAnyId(ctx, 'employees', input.employeeId)
  if (!employee) fail(400, 'That employee no longer exists.')
  return { role, employee }
}

/** Shifts, newest first, each with the role settings in effect on its own date. */
export const list = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), employeeId: v.optional(v.string()), role: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const start = args.startDate
    const end = args.endDate || start
    let docs: Doc<'shifts'>[]
    if (isDateOnly(start) && isDateOnly(end)) docs = await shiftsInRange(ctx, start, end)
    else docs = await ctx.db.query('shifts').collect()
    if (args.employeeId) {
      const employee = await findByAnyId(ctx, 'employees', args.employeeId)
      docs = employee ? docs.filter(s => s.employeeId === employee._id) : []
    }
    let shifts = await toEngineShifts(ctx, docs)
    if (args.role) shifts = shifts.filter(s => s.role.name === args.role)
    return shifts.sort((a, b) => b.date.localeCompare(a.date))
  },
})

/** One shift, with the role settings in effect on its date. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const shift = await mustFind(ctx, 'shifts', id, 'Shift')
    const [engine] = await toEngineShifts(ctx, [shift])
    if (!engine) fail(404, 'Shift not found')
    return engine
  },
})

/** Add a shift. Anyone signed in can (daily entry). Not allowed inside a locked pay period. */
export const create = mutation({
  args: shiftArgs,
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx)
    const input = parse(args)
    await assertUnlocked(ctx, [input.date], 'add shifts')
    const { role, employee } = await resolveRefs(ctx, input)
    const now = Date.now()
    const id = await ctx.db.insert('shifts', {
      employeeId: employee._id, roleId: role._id, date: input.date, hours: input.hours,
      cashTips: input.cashTips, creditTips: input.creditTips, liquorSales: input.liquorSales, createdAt: now, updatedAt: now,
    })
    const created = (await ctx.db.get(id))!
    await audit(ctx, actor, {
      action: 'shift.create', entityType: 'shift', entityId: id,
      summary: `Added ${employee.name}'s ${role.name} shift on ${input.date} (${input.hours}h)`,
      after: record(created),
    })
    return record(created)
  },
})

/** Change a shift. Neither its old nor its new date may be in a locked pay period. */
export const update = mutation({
  args: { id: v.string(), ...shiftArgs },
  handler: async (ctx, { id, ...body }) => {
    const actor = await requireAdmin(ctx)
    const input = parse(body)
    const before = await mustFind(ctx, 'shifts', id, 'Shift')
    await assertUnlocked(ctx, [before.date as DateOnly, input.date], 'change shifts')
    // An archived role may stay on a shift that already had it.
    const { role, employee } = await resolveRefs(ctx, input, before.roleId)
    const oldEmployee = await ctx.db.get(before.employeeId)
    const oldRole = await ctx.db.get(before.roleId)
    await ctx.db.patch(before._id, {
      employeeId: employee._id, roleId: role._id, date: input.date, hours: input.hours,
      cashTips: input.cashTips, creditTips: input.creditTips, liquorSales: input.liquorSales, updatedAt: Date.now(),
    })
    const after = (await ctx.db.get(before._id))!
    await audit(ctx, actor, {
      action: 'shift.update', entityType: 'shift', entityId: before._id,
      summary: `Changed ${oldEmployee?.name ?? 'unknown'}'s ${oldRole?.name ?? 'unknown'} shift on ${before.date}`,
      before: record(before), after: record(after),
    })
    return record(after)
  },
})

/** Delete a shift. Not allowed inside a locked pay period. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const actor = await requireAdmin(ctx)
    const before = await mustFind(ctx, 'shifts', id, 'Shift')
    await assertUnlocked(ctx, [before.date], 'delete shifts')
    const employee = await ctx.db.get(before.employeeId)
    const role = await ctx.db.get(before.roleId)
    await ctx.db.delete(before._id)
    await audit(ctx, actor, {
      action: 'shift.delete', entityType: 'shift', entityId: before._id,
      summary: `Deleted ${employee?.name ?? 'unknown'}'s ${role?.name ?? 'unknown'} shift on ${before.date}`,
      before: record(before),
    })
    return { success: true }
  },
})
