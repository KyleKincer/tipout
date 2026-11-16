import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { audit } from './lib/audit'
import { fail, requireAdmin, requireUser } from './lib/auth'
import { findByAnyId, mustFind } from './lib/data'

/** Same shape the Postgres API returned, so the pages don't change. */
async function present(ctx: QueryCtx, e: Doc<'employees'>) {
  const role = e.defaultRoleId ? await ctx.db.get(e.defaultRoleId) : null
  return {
    id: e._id as string,
    name: e.name,
    active: e.active,
    defaultRoleId: (e.defaultRoleId as string | null) ?? null,
    defaultRole: role ? { id: role._id as string, name: role.name, active: role.active } : null,
    createdAt: new Date(e.createdAt).toISOString(),
    updatedAt: new Date(e.updatedAt).toISOString(),
  }
}

const plain = (e: Doc<'employees'>) => ({ id: e._id as string, name: e.name, active: e.active, defaultRoleId: (e.defaultRoleId as string | null) ?? null })

export const list = query({
  args: {},
  handler: async ctx => {
    await requireUser(ctx)
    const employees = (await ctx.db.query('employees').collect()).sort((a, b) => a.name.localeCompare(b.name))
    return Promise.all(employees.map(e => present(ctx, e)))
  },
})

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    return present(ctx, await mustFind(ctx, 'employees', id, 'Employee'))
  },
})

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const name = args.name.trim()
    if (!name) fail(400, 'Name is required')
    const now = Date.now()
    const id = await ctx.db.insert('employees', { name, active: true, defaultRoleId: null, createdAt: now, updatedAt: now })
    const created = (await ctx.db.get(id))!
    await audit(ctx, actor, { action: 'employee.create', entityType: 'employee', entityId: id, summary: `Added employee ${name}`, after: plain(created) })
    return present(ctx, created)
  },
})

export const update = mutation({
  args: { id: v.string(), name: v.optional(v.string()), active: v.optional(v.boolean()), defaultRoleId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const before = await mustFind(ctx, 'employees', args.id, 'Employee')
    const name = args.name?.trim()
    if (name === '') fail(400, 'Name is required')
    let defaultRoleId = before.defaultRoleId
    if (args.defaultRoleId !== undefined) {
      if (!args.defaultRoleId) defaultRoleId = null
      else {
        const role = await findByAnyId(ctx, 'roles', args.defaultRoleId)
        if (!role) fail(400, 'That role no longer exists.')
        defaultRoleId = role._id
      }
    }
    await ctx.db.patch(before._id, { name: name ?? before.name, active: args.active ?? before.active, defaultRoleId, updatedAt: Date.now() })
    const after = (await ctx.db.get(before._id))!
    await audit(ctx, actor, { action: 'employee.update', entityType: 'employee', entityId: before._id, summary: `Updated employee ${after.name}`, before: plain(before), after: plain(after) })
    return present(ctx, after)
  },
})

/** Delete an employee with no shifts. Anyone with shifts is marked inactive instead, so history keeps them. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const actor = await requireAdmin(ctx)
    const before = await mustFind(ctx, 'employees', id, 'Employee')
    const shifts = await ctx.db.query('shifts').withIndex('by_employee_date', q => q.eq('employeeId', before._id)).collect()
    if (shifts.length > 0) fail(409, `${before.name} has ${shifts.length} shifts, so they can't be deleted. Mark them inactive instead.`)
    await ctx.db.delete(before._id)
    await audit(ctx, actor, { action: 'employee.delete', entityType: 'employee', entityId: before._id, summary: `Deleted employee ${before.name}`, before: plain(before) })
    return { success: true }
  },
})
