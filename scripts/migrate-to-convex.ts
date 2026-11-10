/**
 * Copy the Postgres app's data into Convex, then prove both calculate the same payroll.
 *
 *   npm run migrate:convex                 # read Postgres, check the target, compare; writes nothing
 *   npm run migrate:convex -- --apply      # import (insert-only), then compare
 *   npm run migrate:convex -- --compare    # compare only
 *
 * Postgres comes from DATABASE_URL. The Convex target is CONVEX_URL. The target deployment must have a
 * MIGRATION_TOKEN environment variable (32+ random characters) and the script needs the same value in
 * MIGRATION_TOKEN; remove it from the deployment when the migration is done.
 *
 * Import is insert-only and matched by Postgres ID: re-running inserts nothing, and a row that was
 * imported with different values stops everything. The comparison runs both apps' report code over the
 * full history, every month and every pay period, and fails on any difference of a cent or more.
 * Payroll values are never printed; failures list shift IDs and field names only.
 */
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { PrismaClient } from '@prisma/client'
import { buildReport } from '../src/lib/reportData'
import { serializeVersion } from '../src/lib/roleData'
import { addDays, toDateOnly } from '../src/utils/roleVersions'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const compareOnly = args.includes('--compare')
const prisma = new PrismaClient()
const log = console.log

const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
const TOKEN = process.env.MIGRATION_TOKEN
if (!CONVEX_URL || !TOKEN) throw new Error('Set CONVEX_URL (the target deployment) and MIGRATION_TOKEN (the same value set on that deployment).')
const client = new ConvexHttpClient(CONVEX_URL, { logger: false })

/** Calls a migration function. Safe to retry: reads are pure and the import is insert-only. */
async function convexRun(fn: 'etl:importRows' | 'etl:idMap' | 'etl:report', fnArgs: Record<string, unknown>, attempt = 1): Promise<unknown> {
  try {
    const ref = makeFunctionReference<'query' | 'mutation'>(fn)
    const withToken = { ...fnArgs, token: TOKEN }
    return fn === 'etl:importRows' ? await client.mutation(ref as never, withToken as never) : await client.query(ref as never, withToken as never)
  } catch (error) {
    // Report Convex's own message, never the arguments (they hold payroll data).
    const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 300) : 'unknown error'
    if (attempt < 3 && /fetch failed|ECONNRESET|timed out/i.test(reason)) return convexRun(fn, fnArgs, attempt + 1)
    throw new Error(`${fn} failed: ${reason}`)
  }
}

const ms = (d: Date | null) => (d ? d.getTime() : null)

async function readPostgres() {
  const [roles, employees, versions, shifts, periods, audit] = await Promise.all([
    prisma.role.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.employee.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.roleVersion.findMany({ include: { tipouts: true }, orderBy: [{ roleId: 'asc' }, { effectiveFrom: 'asc' }] }),
    prisma.shift.findMany({ orderBy: { date: 'asc' } }),
    prisma.payPeriod.findMany({ orderBy: { startDate: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { at: 'asc' } }),
  ])
  return {
    roles: roles.map(r => ({ legacyId: r.id, name: r.name, active: r.active, createdAt: ms(r.createdAt), updatedAt: ms(r.updatedAt) })),
    employees: employees.map(e => ({ legacyId: e.id, name: e.name, active: e.active, defaultRoleId: e.defaultRoleId, createdAt: ms(e.createdAt), updatedAt: ms(e.updatedAt) })),
    roleVersions: versions.map(v => {
      const s = serializeVersion(v)
      return {
        legacyId: v.id, roleId: v.roleId, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, basePayRate: s.basePayRate,
        tipPoolGroup: s.tipPoolGroup, tipouts: s.tipouts, note: v.note, createdAt: ms(v.createdAt), createdBy: v.createdBy,
      }
    }),
    shifts: shifts.map(s => ({
      legacyId: s.id, employeeId: s.employeeId, roleId: s.roleId, date: toDateOnly(s.date), hours: Number(s.hours),
      cashTips: Number(s.cashTips), creditTips: Number(s.creditTips), liquorSales: Number(s.liquorSales), createdAt: ms(s.createdAt), updatedAt: ms(s.updatedAt),
    })),
    payPeriods: periods.map(p => ({
      legacyId: p.id, startDate: toDateOnly(p.startDate), endDate: toDateOnly(p.endDate), lockedAt: ms(p.lockedAt), lockedBy: p.lockedBy,
      snapshot: p.snapshot ?? null, createdAt: ms(p.createdAt), createdBy: p.createdBy,
    })),
    auditLog: audit.map(a => ({
      legacyId: a.id, at: ms(a.at), actorId: a.actorId, actorName: a.actorName, action: a.action, entityType: a.entityType,
      entityId: a.entityId, summary: a.summary, before: a.before ?? null, after: a.after ?? null,
    })),
  }
}

const TABLES = ['roles', 'employees', 'roleVersions', 'shifts', 'payPeriods', 'auditLog'] as const
type Table = (typeof TABLES)[number]

async function idMaps() {
  const maps = {} as Record<Table, { toLegacy: Map<string, string>; rows: number; native: number }>
  for (const table of TABLES) {
    const rows = (await convexRun('etl:idMap', { table })) as { id: string; legacyId: string | null }[]
    maps[table] = {
      toLegacy: new Map(rows.filter(r => r.legacyId).map(r => [r.id, r.legacyId!])),
      rows: rows.length,
      native: rows.filter(r => !r.legacyId).length,
    }
  }
  return maps
}

type Report = Awaited<ReturnType<typeof buildReport>>

/** JSON with object keys sorted, so field order (which Convex doesn't preserve) can't cause a false difference. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))
const NUMERIC = ['hours', 'cashTips', 'creditTips', 'liquorSales', 'originalCashTips', 'originalCreditTips', 'paidBarTipout', 'paidHostTipout', 'paidSaTipout', 'receivedBarTipout', 'receivedHostTipout', 'receivedSaTipout', 'payrollTips', 'basePayRate', 'barTipout', 'hostTipout', 'saTipout', 'totalTipsPerHour'] as const

/** Differences between the two apps' reports for one range, as "where: field" strings (no money values). */
function diffReports(label: string, pg: Report, cx: Report, shiftToLegacy: Map<string, string>, employeeToLegacy: Map<string, string>): string[] {
  const out: string[] = []
  const close = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : stable(a) === stable(b))
  if (pg.shiftResults.length !== cx.shiftResults.length) out.push(`${label}: ${pg.shiftResults.length} vs ${cx.shiftResults.length} shifts`)
  const cxByLegacy = new Map(cx.shiftResults.map(r => [shiftToLegacy.get(r.id) ?? r.id, r]))
  for (const p of pg.shiftResults) {
    const c = cxByLegacy.get(p.id)
    if (!c) { out.push(`${label}: shift ${p.id} missing in Convex`); continue }
    for (const f of NUMERIC) if (!close(p[f], c[f])) out.push(`${label}: shift ${p.id} ${f}`)
    for (const f of ['date', 'tipPoolGroup'] as const) if (p[f] !== c[f]) out.push(`${label}: shift ${p.id} ${f}`)
    if (p.role.name !== c.role.name || p.employee.name !== c.employee.name) out.push(`${label}: shift ${p.id} names`)
  }
  const key = (employeeId: string, role: string) => `${employeeId}|${role}`
  const cxSummaries = new Map(cx.employeeSummaries.map(s => [key(employeeToLegacy.get(s.employeeId) ?? s.employeeId, s.roleName), s]))
  for (const p of pg.employeeSummaries) {
    const c = cxSummaries.get(key(p.employeeId, p.roleName))
    if (!c) { out.push(`${label}: summary ${p.employeeId}/${p.roleName} missing`); continue }
    for (const [f, v] of Object.entries(p)) if (f !== 'employeeId' && !close(v, (c as Record<string, unknown>)[f])) out.push(`${label}: summary ${p.employeeId}/${p.roleName} ${f}`)
  }
  if (!close(pg.summary, cx.summary)) {
    for (const [f, v] of Object.entries(pg.summary ?? {})) if (!close(v, (cx.summary as Record<string, unknown> | null)?.[f])) out.push(`${label}: summary.${f}`)
  }
  if (stable(pg.roleConfigs) !== stable(cx.roleConfigs)) out.push(`${label}: roleConfigs`)
  const rules = (r: Report) => stable(r.rules.map(x => [x.roleName, x.versions.map(v => [v.effectiveFrom, v.effectiveTo, v.settings, v.changes, v.summary])]))
  if (rules(pg) !== rules(cx)) out.push(`${label}: rules`)
  const locks = (r: Report) => JSON.stringify(r.lockedPeriods.map(l => [l.startDate, l.endDate, l.lockedBy]))
  if (locks(pg) !== locks(cx)) out.push(`${label}: lockedPeriods`)
  if (pg.drift.length || cx.drift.length) out.push(`${label}: drift ${pg.drift.length} vs ${cx.drift.length}`)
  return out
}

async function main() {
  const source = await readPostgres()
  log('Postgres rows:', Object.fromEntries(TABLES.map(t => [t, source[t].length])))

  if (!compareOnly) {
    const before = await idMaps()
    log('Convex rows before:', Object.fromEntries(TABLES.map(t => [t, before[t].rows])))
    for (const table of TABLES) {
      const extra = [...before[table].toLegacy.values()].filter(id => !source[table].some(r => r.legacyId === id))
      if (extra.length) throw new Error(`${table}: ${extra.length} imported rows no longer exist in Postgres. Stopping; review before importing.`)
    }
    if (!apply) log('Dry run: nothing written. Run with --apply to import.')
    else {
      for (const table of TABLES) {
        const rows = source[table]
        const size = table === 'payPeriods' ? 1 : 100
        const totals = { inserted: 0, skipped: 0 }
        for (let i = 0; i < rows.length; i += size) {
          const r = (await convexRun('etl:importRows', { table, rows: rows.slice(i, i + size) })) as typeof totals
          totals.inserted += r.inserted; totals.skipped += r.skipped
        }
        log(`  ${table}: ${totals.inserted} inserted, ${totals.skipped} already there`)
      }
    }
  }

  const maps = await idMaps()
  const counts = TABLES.map(t => [t, source[t].length, maps[t].toLegacy.size, maps[t].native] as const)
  log('Imported rows (Postgres / Convex imported / Convex-only):', counts.map(([t, a, b, c]) => `${t} ${a}/${b}/${c}`).join(', '))
  // Every Postgres row must be in Convex. Convex-only rows are allowed after a cutover (they're new entries);
  // in that case they must have been copied back to Postgres for the comparison to make sense.
  if (counts.some(([table, a, b, c]) => table !== 'auditLog' && a !== b + (compareOnly ? c : 0))) {
    if (apply || compareOnly) throw new Error('Row counts differ; not comparing reports.')
    return
  }

  // Compare reports: full history, every month, every pay period.
  const first = source.shifts[0]?.date
  const last = source.shifts[source.shifts.length - 1]?.date
  if (!first || !last) return
  const ranges: [string, string, string][] = [['full history', first, last]]
  for (let m = first.slice(0, 7); m <= last.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) {
    ranges.push([m, `${m}-01`, addDays(addDays(`${m}-28`, 7).slice(0, 7) + '-01', -1)])
  }
  for (const p of source.payPeriods) ranges.push([`pay period ${p.startDate}`, p.startDate, p.endDate])
  const problems: string[] = []
  for (const [label, start, end] of ranges) {
    const pg = await buildReport(prisma, start, end)
    const cx = (await convexRun('etl:report', { startDate: start, endDate: end })) as Report
    problems.push(...diffReports(label, pg, cx, maps.shifts.toLegacy, maps.employees.toLegacy))
  }
  log(`Compared ${ranges.length} ranges: ${problems.length} differences.`)
  problems.slice(0, 30).forEach(p => log(`  ${p}`))
  if (problems.length) process.exitCode = 1
}

main()
  .catch(error => { log(error instanceof Error ? error.message : error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
