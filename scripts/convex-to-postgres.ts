/**
 * Rollback helper: copy everything that changed in Convex back into Postgres, so the Postgres app can take
 * over again without losing shifts or settings entered after the cutover.
 *
 *   npm run convex-to-postgres                # show what would change; writes nothing
 *   npm run convex-to-postgres -- --apply     # make Postgres match Convex, in one transaction
 *
 * Needs DATABASE_URL (Postgres), CONVEX_URL and MIGRATION_TOKEN (set on the Convex deployment too).
 * Rows keep their Postgres IDs; rows created in Convex get their Convex ID as their Postgres ID.
 * Convex is treated as the source of truth: Postgres rows missing from Convex are deleted (the change
 * log entries describing those deletions come across too). Freeze writes (WRITES_FROZEN=1) first.
 */
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Prisma, PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()
const log = console.log
const CONVEX_URL = process.env.CONVEX_URL
const TOKEN = process.env.MIGRATION_TOKEN
if (!CONVEX_URL || !TOKEN) throw new Error('Set CONVEX_URL and MIGRATION_TOKEN.')
const client = new ConvexHttpClient(CONVEX_URL, { logger: false })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any> & { _id: string; legacyId?: string }
const exportTable = (table: string) =>
  client.query(makeFunctionReference<'query'>('etl:exportTable') as never, { token: TOKEN, table } as never) as Promise<Row[]>

const day = (d: string) => new Date(`${d}T00:00:00.000Z`)
const at = (n: number | null) => (n === null || n === undefined ? null : new Date(n))
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

async function main() {
  const [roles, employees, versions, shifts, periods, audit] = await Promise.all(
    ['roles', 'employees', 'roleVersions', 'shifts', 'payPeriods', 'auditLog'].map(exportTable),
  )
  // Convex ID → the ID the row has (or will have) in Postgres.
  const pgId = new Map<string, string>()
  for (const r of [...roles, ...employees, ...versions, ...shifts, ...periods, ...audit]) pgId.set(r._id, r.legacyId ?? r._id)
  const id = (convexId: string | null) => (convexId ? pgId.get(convexId) ?? convexId : null)
  const remapIds = (value: unknown) =>
    value === null || value === undefined ? value : JSON.parse(JSON.stringify(value).replace(/"([a-z0-9]{32})"/g, (m, x) => (pgId.has(x) ? `"${pgId.get(x)}"` : m)))

  const want = {
    role: roles.map(r => ({ id: id(r._id)!, name: r.name, active: r.active, createdAt: at(r.createdAt)!, updatedAt: at(r.updatedAt)! })),
    employee: employees.map(e => ({ id: id(e._id)!, name: e.name, active: e.active, defaultRoleId: id(e.defaultRoleId), createdAt: at(e.createdAt)!, updatedAt: at(e.updatedAt)! })),
    roleVersion: versions.map(v => ({
      id: id(v._id)!, roleId: id(v.roleId)!, effectiveFrom: day(v.effectiveFrom), effectiveTo: v.effectiveTo ? day(v.effectiveTo) : null,
      basePayRate: new Prisma.Decimal(v.basePayRate), tipPoolGroup: v.tipPoolGroup, note: v.note, createdAt: at(v.createdAt)!, createdBy: v.createdBy,
      tipouts: [...v.tipouts].sort((a, b) => a.tipoutType.localeCompare(b.tipoutType)),
    })),
    shift: shifts.map(s => ({
      id: id(s._id)!, employeeId: id(s.employeeId)!, roleId: id(s.roleId)!, date: day(s.date), hours: new Prisma.Decimal(s.hours),
      cashTips: new Prisma.Decimal(s.cashTips), creditTips: new Prisma.Decimal(s.creditTips), liquorSales: new Prisma.Decimal(s.liquorSales),
      createdAt: at(s.createdAt)!, updatedAt: at(s.updatedAt)!,
    })),
    payPeriod: periods.map(p => ({
      id: id(p._id)!, startDate: day(p.startDate), endDate: day(p.endDate), lockedAt: at(p.lockedAt), lockedBy: p.lockedBy,
      snapshot: remapIds(p.snapshot) ?? Prisma.DbNull, createdAt: at(p.createdAt)!, createdBy: p.createdBy,
    })),
    auditLog: audit.map(a => ({
      id: id(a._id)!, at: at(a.at)!, actorId: a.actorId, actorName: a.actorName, action: a.action, entityType: a.entityType,
      entityId: id(a.entityId), summary: a.summary, before: remapIds(a.before) ?? Prisma.DbNull, after: remapIds(a.after) ?? Prisma.DbNull,
    })),
  }

  const have = {
    role: await prisma.role.findMany(),
    employee: await prisma.employee.findMany(),
    roleVersion: await prisma.roleVersion.findMany({ include: { tipouts: true } }),
    shift: await prisma.shift.findMany(),
    payPeriod: await prisma.payPeriod.findMany(),
    auditLog: await prisma.auditLog.findMany({ select: { id: true } }),
  }

  // Compare only the fields Convex owns, normalising numbers and dates.
  const norm = (v: unknown): unknown => (v instanceof Prisma.Decimal ? Number(v) : v instanceof Date ? v.toISOString() : v === Prisma.DbNull ? null : v)
  const comparable = (row: Record<string, unknown>, keys: string[]) => stable(Object.fromEntries(keys.map(k => [k, k === 'tipouts'
    ? (row[k] as Record<string, unknown>[]).map(t => ({ tipoutType: t.tipoutType, percentageRate: Number(t.percentageRate), paysTipout: t.paysTipout, receivesTipout: t.receivesTipout, distributionGroup: t.distributionGroup ?? null })).sort((a, b) => String(a.tipoutType).localeCompare(String(b.tipoutType)))
    : norm(row[k])])))

  type Plan = { create: Record<string, unknown>[]; update: Record<string, unknown>[]; remove: string[] }
  const plans = {} as Record<keyof typeof want, Plan>
  for (const table of Object.keys(want) as (keyof typeof want)[]) {
    const wanted = want[table] as Record<string, unknown>[]
    const existing = new Map((have[table] as Record<string, unknown>[]).map(r => [r.id as string, r]))
    const keys = Object.keys(wanted[0] ?? {}).filter(k => k !== 'id')
    const plan: Plan = { create: [], update: [], remove: [] }
    for (const w of wanted) {
      const e = existing.get(w.id as string)
      if (!e) plan.create.push(w)
      else if (table !== 'auditLog' && comparable(e, keys) !== comparable(w, keys)) plan.update.push(w)
    }
    const wantedIds = new Set(wanted.map(w => w.id as string))
    if (table !== 'auditLog') plan.remove = [...existing.keys()].filter(k => !wantedIds.has(k))
    plans[table] = plan
  }
  for (const [table, p] of Object.entries(plans)) log(`${table}: ${p.create.length} to add, ${p.update.length} to update, ${p.remove.length} to delete`)
  if (!apply) { log('Dry run: nothing written. Run with --apply to update Postgres.'); return }

  await prisma.$transaction(async tx => {
    // Deletes first (children before parents), then parents before children for inserts/updates.
    await tx.shift.deleteMany({ where: { id: { in: plans.shift.remove } } })
    await tx.roleVersion.deleteMany({ where: { id: { in: plans.roleVersion.remove } } })
    await tx.payPeriod.deleteMany({ where: { id: { in: plans.payPeriod.remove } } })
    await tx.employee.deleteMany({ where: { id: { in: plans.employee.remove } } })
    for (const r of [...plans.role.create, ...plans.role.update] as typeof want.role) await tx.role.upsert({ where: { id: r.id }, create: r, update: r })
    for (const e of [...plans.employee.create, ...plans.employee.update] as typeof want.employee) await tx.employee.upsert({ where: { id: e.id }, create: e, update: e })
    // Versions: move changed ones out of the way first so (roleId, effectiveFrom) stays unique while rewriting.
    const changed = [...plans.roleVersion.create, ...plans.roleVersion.update] as typeof want.roleVersion
    await tx.roleVersion.deleteMany({ where: { id: { in: changed.map(v => v.id) } } })
    for (const { tipouts, ...v } of changed) await tx.roleVersion.create({ data: { ...v, tipouts: { create: tipouts.map(t => ({ ...t })) } } })
    for (const s of [...plans.shift.create, ...plans.shift.update] as typeof want.shift) await tx.shift.upsert({ where: { id: s.id }, create: s, update: s })
    for (const p of [...plans.payPeriod.create, ...plans.payPeriod.update] as typeof want.payPeriod) await tx.payPeriod.upsert({ where: { id: p.id }, create: p, update: p })
    await tx.role.deleteMany({ where: { id: { in: plans.role.remove } } })
    for (const a of plans.auditLog.create as typeof want.auditLog) await tx.auditLog.create({ data: a })
  }, { timeout: 120000 })
  log('Postgres now matches Convex.')
}

main()
  .catch(error => { log(error instanceof Error ? error.message : error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
