import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id, TableNames } from '../_generated/dataModel'
import type { LockedPeriod, PayPeriodSnapshot } from '../../src/utils/payPeriods'
import {
  addDays, isLocked, lockedThrough, toEngineRole, versionOn,
  type DateOnly, type LockedRange, type RoleSettings, type RoleVersion,
} from '../../src/utils/roleVersions'
import { fail } from './auth'

type Ctx = QueryCtx | MutationCtx

export function versionFromDoc(d: Doc<'roleVersions'>): RoleVersion {
  return {
    id: d._id,
    roleId: d.roleId,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    basePayRate: d.basePayRate,
    tipPoolGroup: d.tipPoolGroup,
    note: d.note,
    createdAt: new Date(d.createdAt).toISOString(),
    createdBy: d.createdBy,
    tipouts: [...d.tipouts].sort((a, b) => a.tipoutType.localeCompare(b.tipoutType)),
  }
}

export const settingsOf = (v: RoleVersion): RoleSettings => ({ basePayRate: v.basePayRate, tipPoolGroup: v.tipPoolGroup, tipouts: v.tipouts })

/** A role's versions, oldest first. */
export async function versionsForRole(ctx: Ctx, roleId: Id<'roles'>): Promise<RoleVersion[]> {
  const docs = await ctx.db.query('roleVersions').withIndex('by_role_from', q => q.eq('roleId', roleId)).collect()
  return docs.map(versionFromDoc)
}

/** Every role's versions, oldest first. */
export async function allVersions(ctx: Ctx): Promise<Map<string, RoleVersion[]>> {
  const docs = await ctx.db.query('roleVersions').collect()
  const byRole = new Map<string, RoleVersion[]>()
  for (const d of docs.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    byRole.set(d.roleId, [...(byRole.get(d.roleId) ?? []), versionFromDoc(d)])
  }
  return byRole
}

export async function lockedRanges(ctx: Ctx): Promise<LockedRange[]> {
  const periods = await ctx.db.query('payPeriods').collect()
  return periods.filter(p => p.lockedAt !== null).map(p => ({ startDate: p.startDate, endDate: p.endDate }))
}

export async function lockedPeriodsOverlapping(ctx: Ctx, start: DateOnly, end: DateOnly): Promise<LockedPeriod[]> {
  const periods = await ctx.db.query('payPeriods').withIndex('by_start', q => q.lte('startDate', end)).collect()
  return periods
    .filter(p => p.lockedAt !== null && p.endDate >= start)
    .map(p => ({
      id: p._id, startDate: p.startDate, endDate: p.endDate,
      lockedAt: new Date(p.lockedAt!).toISOString(), lockedBy: p.lockedBy,
      snapshot: p.snapshot as PayPeriodSnapshot,
    }))
}

/** Refuse a change that would alter a locked pay period. */
export async function assertUnlocked(ctx: Ctx, days: DateOnly[], what = 'change shifts') {
  const locks = await lockedRanges(ctx)
  const hit = days.find(d => isLocked(locks, d))
  if (hit) {
    const p = locks.find(l => l.startDate <= hit && hit <= l.endDate)!
    fail(409, `Payroll for ${p.startDate} to ${p.endDate} is locked, so you can't ${what} on ${hit}. An admin can unlock that pay period first.`)
  }
}

/** First date new role settings may start on (the day after the last locked pay period), or null. */
export async function earliestChangeDate(ctx: Ctx): Promise<DateOnly | null> {
  const through = lockedThrough(await lockedRanges(ctx))
  return through ? addDays(through, 1) : null
}

export type EngineShift = ReturnType<typeof toEngineShift>

function toEngineShift(s: Doc<'shifts'>, employee: Doc<'employees'>, role: Doc<'roles'>, versions: RoleVersion[]) {
  return {
    id: s._id as string,
    date: `${s.date}T00:00:00.000Z`,
    employeeId: s.employeeId as string,
    roleId: s.roleId as string,
    employee: { id: employee._id as string, name: employee.name },
    hours: s.hours,
    cashTips: s.cashTips,
    creditTips: s.creditTips,
    liquorSales: s.liquorSales,
    role: { id: role._id as string, ...toEngineRole(role.name, versionOn(versions, s.date), s.date) },
  }
}

/** Shifts in the shape the payroll calculation reads, each with the role settings for its own date. */
export async function toEngineShifts(ctx: Ctx, shifts: Doc<'shifts'>[]): Promise<EngineShift[]> {
  const employees = await getMany(ctx, [...new Set(shifts.map(s => s.employeeId))])
  const roles = await getMany(ctx, [...new Set(shifts.map(s => s.roleId))])
  const versions = new Map<string, RoleVersion[]>()
  for (const id of roles.keys()) versions.set(id, await versionsForRole(ctx, id as Id<'roles'>))
  return shifts
    .filter(s => employees.has(s.employeeId) && roles.has(s.roleId))
    .map(s => toEngineShift(s, employees.get(s.employeeId)!, roles.get(s.roleId)!, versions.get(s.roleId)!))
}

async function getMany<T extends TableNames>(ctx: Ctx, ids: Id<T>[]): Promise<Map<string, Doc<T>>> {
  const docs = (await Promise.all(ids.map(id => ctx.db.get(id)))) as (Doc<T> | null)[]
  return new Map(docs.filter((d): d is Doc<T> => d !== null).map(d => [d._id as string, d]))
}

/** Shifts on [start, end], both inclusive, oldest first. */
export const shiftsInRange = (ctx: Ctx, start: DateOnly, end: DateOnly) =>
  ctx.db.query('shifts').withIndex('by_date', q => q.gte('date', start).lte('date', end)).collect()

type LegacyTable = 'employees' | 'roles' | 'shifts' | 'payPeriods'

/** Look a document up by its Convex ID or, for imported rows, its old Postgres ID (keeps old links working). */
export async function findByAnyId<T extends LegacyTable>(ctx: Ctx, table: T, id: string): Promise<Doc<T> | null> {
  if (!id) return null
  const native = ctx.db.normalizeId(table, id)
  if (native) {
    const doc = (await ctx.db.get(native)) as Doc<T> | null
    if (doc) return doc
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (ctx.db.query(table) as any).withIndex('by_legacy', (q: any) => q.eq('legacyId', id)).take(2)) as Doc<T>[]
  if (rows.length > 1) fail(500, 'Two records share that old ID. Contact an admin.')
  return rows[0] ?? null
}

export async function mustFind<T extends LegacyTable>(ctx: Ctx, table: T, id: string, label: string): Promise<Doc<T>> {
  const doc = await findByAnyId(ctx, table, id)
  if (!doc) fail(404, `${label} not found`)
  return doc
}
