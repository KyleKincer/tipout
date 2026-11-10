import type { Prisma, PrismaClient } from '@prisma/client'
import type { Shift, TipoutType } from '@/types/reports'
import type { LockedPeriod, PayPeriodSnapshot } from '@/utils/payPeriods'
import {
  addDays, isLocked, lockedThrough, toDateOnly, toEngineRole, versionOn,
  type DateOnly, type LockedRange, type RoleSettings, type RoleVersion,
} from '@/utils/roleVersions'
import { HttpError } from './apiAuth'

export type Db = PrismaClient | Prisma.TransactionClient

type VersionRow = Prisma.RoleVersionGetPayload<{ include: { tipouts: true } }>

export function serializeVersion(v: VersionRow): RoleVersion {
  return {
    id: v.id,
    roleId: v.roleId,
    effectiveFrom: toDateOnly(v.effectiveFrom),
    effectiveTo: v.effectiveTo ? toDateOnly(v.effectiveTo) : null,
    basePayRate: Number(v.basePayRate),
    tipPoolGroup: v.tipPoolGroup,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    createdBy: v.createdBy,
    tipouts: v.tipouts
      .map(t => ({
        tipoutType: t.tipoutType as TipoutType,
        percentageRate: Number(t.percentageRate),
        paysTipout: t.paysTipout,
        receivesTipout: t.receivesTipout,
        distributionGroup: t.distributionGroup,
      }))
      .sort((a, b) => a.tipoutType.localeCompare(b.tipoutType)),
  }
}

export const settingsOf = (v: RoleVersion): RoleSettings => ({ basePayRate: v.basePayRate, tipPoolGroup: v.tipPoolGroup, tipouts: v.tipouts })

export const dbDate = (day: DateOnly) => new Date(`${day}T00:00:00.000Z`)

/** Every role's versions, oldest first. */
export async function loadVersions(db: Db, roleIds?: string[]): Promise<Map<string, RoleVersion[]>> {
  const rows = await db.roleVersion.findMany({
    where: roleIds ? { roleId: { in: roleIds } } : undefined,
    include: { tipouts: true },
    orderBy: [{ roleId: 'asc' }, { effectiveFrom: 'asc' }],
  })
  const byRole = new Map<string, RoleVersion[]>()
  for (const row of rows) {
    const list = byRole.get(row.roleId) ?? []
    list.push(serializeVersion(row))
    byRole.set(row.roleId, list)
  }
  return byRole
}

export async function loadLockedRanges(db: Db): Promise<LockedRange[]> {
  const rows = await db.payPeriod.findMany({ where: { lockedAt: { not: null } }, select: { startDate: true, endDate: true } })
  return rows.map(r => ({ startDate: toDateOnly(r.startDate), endDate: toDateOnly(r.endDate) }))
}

export async function loadLockedPeriods(db: Db, start: DateOnly, end: DateOnly): Promise<LockedPeriod[]> {
  const rows = await db.payPeriod.findMany({
    where: { lockedAt: { not: null }, startDate: { lte: dbDate(end) }, endDate: { gte: dbDate(start) } },
    orderBy: { startDate: 'asc' },
  })
  return rows.map(r => ({
    id: r.id,
    startDate: toDateOnly(r.startDate),
    endDate: toDateOnly(r.endDate),
    lockedAt: r.lockedAt!.toISOString(),
    lockedBy: r.lockedBy,
    snapshot: r.snapshot as unknown as PayPeriodSnapshot,
  }))
}

/** Refuse a change that would alter a locked pay period. */
export async function assertUnlocked(db: Db, days: DateOnly[], what = 'change shifts') {
  const locks = await loadLockedRanges(db)
  const hit = days.find(d => isLocked(locks, d))
  if (hit) {
    const p = locks.find(l => l.startDate <= hit && hit <= l.endDate)!
    throw new HttpError(409, `Payroll for ${p.startDate} to ${p.endDate} is locked, so you can't ${what} on ${hit}. An admin can unlock that pay period first.`)
  }
}

/** First date new role settings may start on (the day after the last locked pay period), or null. */
export async function earliestChangeDate(db: Db): Promise<DateOnly | null> {
  const through = lockedThrough(await loadLockedRanges(db))
  return through ? addDays(through, 1) : null
}

const shiftInclude = {
  employee: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.ShiftInclude

type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>

/** Shifts in the shape the payroll calculation reads, each with the role settings for its own date. */
export async function loadEngineShifts(db: Db, where: Prisma.ShiftWhereInput, orderBy: Prisma.ShiftOrderByWithRelationInput = { date: 'asc' }): Promise<(Shift & { roleId: string; employeeId: string })[]> {
  const rows: ShiftRow[] = await db.shift.findMany({ where, include: shiftInclude, orderBy })
  const versions = await loadVersions(db, [...new Set(rows.map(r => r.roleId))])
  return rows.map(row => toEngineShift(row, versions.get(row.roleId) ?? []))
}

export function toEngineShift(row: ShiftRow, versions: RoleVersion[]) {
  const day = toDateOnly(row.date)
  return {
    id: row.id,
    date: row.date.toISOString(),
    employeeId: row.employeeId,
    roleId: row.roleId,
    employee: { id: row.employee.id, name: row.employee.name },
    hours: Number(row.hours),
    cashTips: Number(row.cashTips),
    creditTips: Number(row.creditTips),
    liquorSales: Number(row.liquorSales),
    role: { id: row.role.id, ...toEngineRole(row.role.name, versionOn(versions, day), day) },
  }
}

/** Range filter for shifts on [start, end], both inclusive. */
export const shiftDateRange = (start: DateOnly, end: DateOnly): Prisma.ShiftWhereInput => ({
  date: { gte: dbDate(start), lt: dbDate(addDays(end, 1)) },
})
