import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import { buildReport } from './lib/reports'
import type { Id, TableNames } from './_generated/dataModel'

/**
 * One-way import from the Postgres app, run by scripts/migrate-to-convex.ts.
 * These functions only work while the deployment has a MIGRATION_TOKEN environment variable and the
 * caller passes the same token. Set it for the migration (`npx convex env set MIGRATION_TOKEN ...`) and
 * remove it afterwards (`npx convex env remove MIGRATION_TOKEN`); without it they refuse every call.
 * Insert-only: rows are matched by their Postgres ID (legacyId). A row already imported with the same
 * values is skipped; one with different values stops the import. Nothing is ever deleted or overwritten.
 */
type LegacyTable = 'roles' | 'employees' | 'roleVersions' | 'shifts' | 'payPeriods' | 'auditLog'

async function byLegacy(ctx: MutationCtx, table: LegacyTable, legacyId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (ctx.db.query(table) as any).withIndex('by_legacy', (q: any) => q.eq('legacyId', legacyId)).take(2)
  if (rows.length > 1) throw new Error(`${table}: two rows share legacy ID ${legacyId}`)
  return rows[0] ?? null
}

async function ref<T extends TableNames>(ctx: MutationCtx, table: LegacyTable, legacyId: string): Promise<Id<T>> {
  const row = await byLegacy(ctx, table, legacyId)
  if (!row) throw new Error(`${table} ${legacyId} hasn't been imported yet`)
  return row._id as Id<T>
}

const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))

async function insertOnce(ctx: MutationCtx, table: LegacyTable, legacyId: string, doc: Record<string, unknown>) {
  const existing = await byLegacy(ctx, table, legacyId)
  if (existing) {
    const { _id, _creationTime, ...stored } = existing
    void _id; void _creationTime
    if (stable(stored) !== stable({ ...doc, legacyId })) throw new Error(`${table} ${legacyId} was already imported with different values`)
    return 'skipped'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ctx.db.insert(table, { ...doc, legacyId } as any)
  return 'inserted'
}

/** Saved as-paid results refer to Postgres IDs; point them at the imported rows so locked periods still line up. */
async function remapSnapshot(ctx: MutationCtx, snapshot: Record<string, unknown> | null) {
  if (!snapshot) return null
  const s = JSON.parse(JSON.stringify(snapshot))
  const id = async (table: LegacyTable, legacyId: string | null | undefined) => (legacyId ? ((await byLegacy(ctx, table, legacyId))?._id ?? legacyId) : legacyId)
  for (const r of s.shiftResults ?? []) {
    r.id = await id('shifts', r.id)
    r.employee.id = await id('employees', r.employee.id)
    r.versionId = await id('roleVersions', r.versionId)
  }
  for (const e of s.employeeSummaries ?? []) e.employeeId = await id('employees', e.employeeId)
  for (const rv of s.roleVersions ?? []) rv.versionId = await id('roleVersions', rv.versionId)
  return s
}

function checkToken(token: string) {
  const expected = process.env.MIGRATION_TOKEN
  if (!expected || expected.length < 32 || token !== expected) throw new Error('Migration functions are disabled on this deployment.')
}

const ENTITY_TABLE: Record<string, LegacyTable> = { role: 'roles', shift: 'shifts', employee: 'employees', payPeriod: 'payPeriods' }

export const importRows = mutation({
  args: {
    token: v.string(),
    table: v.union(v.literal('roles'), v.literal('employees'), v.literal('roleVersions'), v.literal('shifts'), v.literal('payPeriods'), v.literal('auditLog')),
    rows: v.array(v.any()),
  },
  handler: async (ctx, { token, table, rows }) => {
    checkToken(token)
    const counts = { inserted: 0, skipped: 0 }
    for (const r of rows) {
      let doc: Record<string, unknown>
      if (table === 'roles') doc = { name: r.name, active: r.active, createdAt: r.createdAt, updatedAt: r.updatedAt }
      else if (table === 'employees') {
        doc = {
          name: r.name, active: r.active, createdAt: r.createdAt, updatedAt: r.updatedAt,
          defaultRoleId: r.defaultRoleId ? await ref<'roles'>(ctx, 'roles', r.defaultRoleId) : null,
        }
      } else if (table === 'roleVersions') {
        doc = {
          roleId: await ref<'roles'>(ctx, 'roles', r.roleId), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
          basePayRate: r.basePayRate, tipPoolGroup: r.tipPoolGroup, tipouts: r.tipouts, note: r.note,
          createdAt: r.createdAt, createdBy: r.createdBy,
        }
      } else if (table === 'shifts') {
        doc = {
          employeeId: await ref<'employees'>(ctx, 'employees', r.employeeId), roleId: await ref<'roles'>(ctx, 'roles', r.roleId),
          date: r.date, hours: r.hours, cashTips: r.cashTips, creditTips: r.creditTips, liquorSales: r.liquorSales,
          createdAt: r.createdAt, updatedAt: r.updatedAt,
        }
      } else if (table === 'payPeriods') {
        doc = {
          startDate: r.startDate, endDate: r.endDate, lockedAt: r.lockedAt, lockedBy: r.lockedBy, snapshot: await remapSnapshot(ctx, r.snapshot),
          createdAt: r.createdAt, createdBy: r.createdBy,
        }
      } else {
        doc = {
          at: r.at, actorId: r.actorId, actorName: r.actorName, action: r.action, entityType: r.entityType,
          entityId: r.entityId && ENTITY_TABLE[r.entityType] ? ((await byLegacy(ctx, ENTITY_TABLE[r.entityType], r.entityId))?._id ?? r.entityId) : r.entityId,
          summary: r.summary, before: r.before ?? undefined, after: r.after ?? undefined,
        }
        if (doc.before === undefined) delete doc.before
        if (doc.after === undefined) delete doc.after
      }
      counts[await insertOnce(ctx, table, r.legacyId, doc)]++
    }
    return counts
  },
})

/** Row counts and the Postgres-ID → Convex-ID map, for reconciling after an import. */
export const idMap = query({
  args: { token: v.string(), table: v.union(v.literal('roles'), v.literal('employees'), v.literal('roleVersions'), v.literal('shifts'), v.literal('payPeriods'), v.literal('auditLog')) },
  handler: async (ctx, { token, table }) => {
    checkToken(token)
    const rows = await ctx.db.query(table).collect()
    return rows.map(r => ({ id: r._id as string, legacyId: (r as { legacyId?: string }).legacyId ?? null }))
  },
})

/** The report for a range, for the migration's side-by-side comparison with Postgres. */
export const report = query({
  args: { token: v.string(), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { token, startDate, endDate }) => {
    checkToken(token)
    return buildReport(ctx, startDate, endDate)
  },
})

/** Every row of a table, for copying changes back to Postgres if the cutover is rolled back. */
export const exportTable = query({
  args: { token: v.string(), table: v.union(v.literal('roles'), v.literal('employees'), v.literal('roleVersions'), v.literal('shifts'), v.literal('payPeriods'), v.literal('auditLog')) },
  handler: async (ctx, { token, table }) => {
    checkToken(token)
    return ctx.db.query(table).collect()
  },
})
