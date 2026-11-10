/**
 * One-time copy of the legacy RoleConfig settings into dated RoleVersion rows.
 *
 *   npm run backfill:role-versions            # dry run: prints the versions and checks them
 *   npm run backfill:role-versions -- --apply # writes them, only if every check passes
 *
 * The check recalculates every shift in history twice, once the old way (RoleConfig rows, in the
 * order the database returns them) and once from the new versions, and refuses to write anything
 * unless every number matches. Uses DATABASE_URL like the app.
 */
import { PrismaClient } from '@prisma/client'
import { calculateDailyReport } from '../src/utils/reportCalculations'
import { versionsFromLegacy, type LegacyConfig } from '../src/utils/legacyRoleSettings'
import { describeSettings, toDateOnly, toEngineRole, versionOn, type RoleVersion } from '../src/utils/roleVersions'
import type { Shift, TipoutType } from '../src/types/reports'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()
const log = console.log

type ConfigRow = LegacyConfig & { roleId: string }

async function main() {
  console.log = () => {} // the payroll calculation logs heavily
  const existing = await prisma.roleVersion.count()
  if (existing > 0) throw new Error(`RoleVersion already has ${existing} rows; the backfill only runs once.`)

  const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } })
  // Same order the old code saw: Prisma's unordered findMany returns rows in table (ctid) order.
  const configRows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT "roleId", "tipoutType", "percentageRate"::float8 AS "percentageRate",
           to_char("effectiveFrom", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "effectiveFrom",
           CASE WHEN "effectiveTo" IS NULL THEN NULL ELSE to_char("effectiveTo", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "effectiveTo",
           "paysTipout", "receivesTipout", "distributionGroup", "tipPoolGroup"
    FROM "RoleConfig" ORDER BY ctid`
  const firstShift = await prisma.shift.groupBy({ by: ['roleId'], _min: { date: true } })
  const firstShiftDay = new Map(firstShift.map(r => [r.roleId, r._min.date ? toDateOnly(r._min.date) : null]))

  const planned = new Map<string, RoleVersion[]>()
  for (const role of roles) {
    const configs = configRows.filter(c => c.roleId === role.id)
    const candidates = [toDateOnly(role.createdAt), firstShiftDay.get(role.id), ...configs.map(c => toDateOnly(c.effectiveFrom))]
    const firstDay = candidates.filter((d): d is string => !!d).sort()[0]
    const versions = versionsFromLegacy(configs, Number(role.basePayRate), firstDay).map((v, i) => ({
      id: `${role.id}-v${i + 1}`, roleId: role.id, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, ...v.settings,
    }))
    planned.set(role.id, versions)
    log(`\n${role.name}`)
    for (const v of versions) log(`  ${v.effectiveFrom} → ${v.effectiveTo ?? 'open'}: ${describeSettings(v)}`)
  }

  // Recalculate all of history both ways and compare every shift.
  const shiftRows = await prisma.shift.findMany({ include: { employee: true, role: true }, orderBy: { date: 'asc' } })
  const base = (s: (typeof shiftRows)[number]) => ({
    id: s.id, date: s.date.toISOString(), employee: { id: s.employee.id, name: s.employee.name },
    hours: Number(s.hours), cashTips: Number(s.cashTips), creditTips: Number(s.creditTips), liquorSales: Number(s.liquorSales),
  })
  const legacy: Shift[] = shiftRows.map(s => ({
    ...base(s),
    role: {
      name: s.role.name, basePayRate: Number(s.role.basePayRate),
      configs: configRows.filter(c => c.roleId === s.roleId).map((c, i) => ({
        id: `${c.roleId}-${i}`, tipoutType: c.tipoutType as TipoutType, percentageRate: c.percentageRate,
        effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo, paysTipout: c.paysTipout ?? true,
        receivesTipout: c.receivesTipout ?? false, distributionGroup: c.distributionGroup ?? undefined, tipPoolGroup: c.tipPoolGroup ?? undefined,
      })),
    },
  }))
  const versioned: Shift[] = shiftRows.map(s => {
    const day = toDateOnly(s.date)
    return { ...base(s), role: toEngineRole(s.role.name, versionOn(planned.get(s.roleId) ?? [], day), day) }
  })
  const before = calculateDailyReport(legacy)
  const after = calculateDailyReport(versioned)
  const fields = ['cashTips', 'creditTips', 'paidBarTipout', 'paidHostTipout', 'paidSaTipout', 'receivedBarTipout', 'receivedHostTipout', 'receivedSaTipout', 'payrollTips', 'basePayRate', 'tipPoolGroup'] as const
  const afterById = new Map(after.shiftResults.map(r => [r.id, r]))
  const mismatches: string[] = []
  for (const b of before.shiftResults) {
    const a = afterById.get(b.id)
    if (!a) { mismatches.push(`${b.id} missing`); continue }
    for (const f of fields) {
      const x = b[f], y = a[f]
      const same = typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : x === y
      if (!same) mismatches.push(`${b.date.slice(0, 10)} ${b.employee.name} ${b.role.name} ${f}: ${x} vs ${y}`)
    }
  }
  const noVersion = versioned.filter(s => !s.role.versionId).length
  log(`\nChecked ${before.shiftResults.length} shifts: ${mismatches.length} differences, ${noVersion} shifts without settings.`)
  mismatches.slice(0, 20).forEach(m => log(`  ${m}`))
  if (mismatches.length || noVersion) throw new Error('Not writing anything: the new versions would change past results.')

  if (!apply) { log('\nDry run only. Run with --apply to write these versions.'); return }
  await prisma.$transaction(async tx => {
    for (const versions of planned.values()) {
      for (const v of versions) {
        await tx.roleVersion.create({
          data: {
            roleId: v.roleId, effectiveFrom: new Date(`${v.effectiveFrom}T00:00:00.000Z`),
            effectiveTo: v.effectiveTo ? new Date(`${v.effectiveTo}T00:00:00.000Z`) : null,
            basePayRate: v.basePayRate, tipPoolGroup: v.tipPoolGroup, createdBy: 'backfill',
            note: 'Copied from the settings in use before dated versions existed.',
            tipouts: { create: v.tipouts.map(t => ({ ...t })) },
          },
        })
      }
    }
    await tx.auditLog.create({
      data: {
        actorName: 'backfill', action: 'backfill', entityType: 'roleVersion',
        summary: `Copied legacy role settings into ${[...planned.values()].flat().length} dated versions; all ${before.shiftResults.length} shifts recalculate the same.`,
      },
    })
  })
  log('\nWritten.')
}

main()
  .catch(error => { log(`\n${error instanceof Error ? error.message : error}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
