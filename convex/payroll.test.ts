/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const TOKEN = 'test-token-0123456789-0123456789-abcdef'
const admin = { subject: 'user_admin', name: 'Kyle', metadata: { roles: ['admin'] } }
const staff = { subject: 'user_staff', name: 'Mary', metadata: { roles: [] } }

const serverSettings = (pool: string | null) => ({
  basePayRate: 3, tipPoolGroup: pool,
  tipouts: [
    { tipoutType: 'bar' as const, percentageRate: 20, paysTipout: true, receivesTipout: false, distributionGroup: null },
    { tipoutType: 'host' as const, percentageRate: 7, paysTipout: true, receivesTipout: false, distributionGroup: null },
  ],
})
const barSettings = {
  basePayRate: 9.75, tipPoolGroup: 'bar',
  tipouts: [{ tipoutType: 'bar' as const, percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: 'bartenders' }],
}
const hostSettings = {
  basePayRate: 10, tipPoolGroup: null,
  tipouts: [{ tipoutType: 'host' as const, percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: 'hosts' }],
}

async function setup() {
  const t = convexTest(schema, modules)
  const a = t.withIdentity(admin)
  const server = await a.mutation(api.roles.create, { name: 'server', effectiveFrom: '2026-01-01', settings: serverSettings('server') })
  const bar = await a.mutation(api.roles.create, { name: 'bar', effectiveFrom: '2026-01-01', settings: barSettings })
  const host = await a.mutation(api.roles.create, { name: 'host', effectiveFrom: '2026-01-01', settings: hostSettings })
  const mary = await a.mutation(api.employees.create, { name: 'Mary' })
  const cierra = await a.mutation(api.employees.create, { name: 'Cierra' })
  const mae = await a.mutation(api.employees.create, { name: 'mae' })
  const hal = await a.mutation(api.employees.create, { name: 'Hal' })
  const shift = (employeeId: string, roleId: string, date: string, hours: number, creditTips: number, liquorSales = 0) =>
    t.withIdentity(staff).mutation(api.shifts.create, { employeeId, roleId, date, hours, creditTips, liquorSales })
  return { t, a, server, bar, host, mary, cierra, mae, hal, shift }
}

describe('Convex backend: access', () => {
  it('rejects anonymous reads and staff edits, allows staff to add shifts', async () => {
    const { t, server, mary, shift } = await setup()
    await expect(t.query(api.reports.get, { startDate: '2026-10-26', endDate: '2026-10-26' })).rejects.toThrow(/Sign in first/)
    await expect(t.query(api.employees.list, {})).rejects.toThrow(/Sign in first/)
    const created = await shift(mary.id, server.id, '2026-10-26', 4, 115)
    const s = t.withIdentity(staff)
    await expect(s.mutation(api.shifts.update, { id: created.id, employeeId: mary.id, roleId: server.id, date: '2026-10-26', hours: 1 })).rejects.toThrow(/Only admins/)
    await expect(s.mutation(api.shifts.remove, { id: created.id })).rejects.toThrow(/Only admins/)
    await expect(s.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-11-16', settings: serverSettings(null) })).rejects.toThrow(/Only admins/)
    await expect(s.query(api.audit.list, {})).rejects.toThrow(/Only admins/)
  })
})

describe('Convex backend: dated settings', () => {
  it('turns server pooling off from a date without changing earlier nights', async () => {
    const { a, server, bar, host, mary, cierra, mae, hal, shift } = await setup()
    for (const day of ['2026-11-15', '2026-11-16']) {
      await shift(mary.id, server.id, day, 4, 115, 138)
      await shift(cierra.id, server.id, day, 6, 45)
      await shift(mae.id, bar.id, day, 6, 90)
      await shift(hal.id, host.id, day, 5, 0)
    }
    const before = await a.query(api.reports.get, { startDate: '2026-11-15', endDate: '2026-11-15' })
    const plan = await a.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-11-16', settings: serverSettings(null), note: 'restaurant ended pooling', confirmAffected: true })
    expect(plan).toMatchObject({ ok: true, kind: 'create', changes: ['stops pooling tips (was the server pool)'] })

    const after = await a.query(api.reports.get, { startDate: '2026-11-15', endDate: '2026-11-16' })
    const tips = (day: string, name: string) => after.shiftResults.find(r => r.date.startsWith(day) && r.employee.name === name)!
    // Nov 15 is unchanged: $160 pooled, host 7% off the top, split over 10 hours.
    expect(tips('2026-11-15', 'Mary').payrollTips).toBeCloseTo(before.shiftResults.find(r => r.employee.name === 'Mary')!.payrollTips, 9)
    expect(tips('2026-11-15', 'Mary').payrollTips).toBeCloseTo(4 * (160 - 11.2) / 10 - 27.6, 9)
    // Nov 16: Mary keeps her own $115, minus her host and bar tipouts.
    expect(tips('2026-11-16', 'Mary').payrollTips).toBeCloseTo(115 - 8.05 - 27.6, 9)
    expect(tips('2026-11-16', 'Mary').tipPoolGroup).toBeNull()
    const rules = after.rules.find(r => r.roleName === 'server')!
    expect(rules.versions.map(v => [v.effectiveFrom, v.effectiveTo])).toEqual([['2026-01-01', '2026-11-16'], ['2026-11-16', null]])
  })

  it('asks before a change recalculates entered shifts, and refuses dates before the latest change', async () => {
    const { a, server, mary, shift } = await setup()
    await shift(mary.id, server.id, '2026-11-10', 4, 100)
    const preview = await a.query(api.roles.planChange, { id: server.id, effectiveFrom: '2026-11-01', settings: serverSettings(null) })
    expect(preview).toMatchObject({ ok: true, affects: { shifts: 1, firstDate: '2026-11-10' } })
    await expect(a.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-11-01', settings: serverSettings(null) })).rejects.toThrow(/Confirm to go ahead/)
    await a.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-11-01', settings: serverSettings(null), confirmAffected: true })
    await expect(a.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-10-01', settings: serverSettings('server') })).rejects.toThrow(/already change on 2026-11-01/)
    await expect(a.mutation(api.roles.undoLatest, { id: server.id })).rejects.toThrow(/Confirm to go ahead/)
    await a.mutation(api.roles.undoLatest, { id: server.id, confirmAffected: true })
    const role = await a.query(api.roles.get, { id: server.id })
    expect(role.versions).toHaveLength(1)
    expect(role.versions[0]).toMatchObject({ effectiveFrom: '2026-01-01', effectiveTo: null, tipPoolGroup: 'server' })
  })
})

describe('Convex backend: pay period locks', () => {
  it('locks results as paid and blocks shift and settings changes inside the period', async () => {
    const { t, a, server, mary, cierra, shift } = await setup()
    const s1 = await shift(mary.id, server.id, '2026-10-26', 4, 115)
    await shift(cierra.id, server.id, '2026-10-26', 6, 45)
    const period = await a.mutation(api.payPeriods.create, { startDate: '2026-10-19', endDate: '2026-11-01' })
    await expect(a.mutation(api.payPeriods.create, { startDate: '2026-11-01', endDate: '2026-11-14' })).rejects.toThrow(/overlaps/)
    await a.mutation(api.payPeriods.lock, { id: period.id })

    await expect(a.mutation(api.shifts.update, { id: s1.id, employeeId: mary.id, roleId: server.id, date: '2026-10-26', hours: 1 })).rejects.toThrow(/is locked/)
    await expect(shift(mary.id, server.id, '2026-10-27', 1, 1)).rejects.toThrow(/is locked/)
    await expect(a.mutation(api.shifts.remove, { id: s1.id })).rejects.toThrow(/is locked/)
    await expect(a.mutation(api.roles.changeSettings, { id: server.id, effectiveFrom: '2026-10-30', settings: serverSettings(null), confirmAffected: true })).rejects.toThrow(/locked through 2026-11-01/)

    const report = await a.query(api.reports.get, { startDate: '2026-10-26', endDate: '2026-10-26' })
    expect(report.shiftResults.every(r => r.lockedPeriodId === period.id)).toBe(true)
    expect(report.drift).toEqual([])

    // A direct database edit after locking shows up as drift; the report keeps the as-paid number.
    const paid = report.shiftResults.find(r => r.id === s1.id)!.payrollTips
    await t.run(async ctx => ctx.db.patch(s1.id as never, { creditTips: 500 }))
    const drifted = await a.query(api.reports.get, { startDate: '2026-10-26', endDate: '2026-10-26' })
    expect(drifted.shiftResults.find(r => r.id === s1.id)!.payrollTips).toBeCloseTo(paid, 9)
    expect(drifted.drift.map(d => d.shiftId).sort()).toEqual(report.shiftResults.map(r => r.id).sort())

    await expect(a.mutation(api.payPeriods.unlock, { id: period.id })).rejects.toThrow(/Say why/)
    await a.mutation(api.payPeriods.unlock, { id: period.id, reason: 'test' })
    const list = await a.query(api.payPeriods.list, {})
    expect(list.periods[0]).toMatchObject({ lockedAt: null })
    expect(list.suggestion).toEqual({ startDate: '2026-11-02', endDate: '2026-11-15' })
  })
})

describe('Convex backend: deletes and the change log', () => {
  it('refuses to delete a role or employee with shifts, and logs every change', async () => {
    const { a, server, mary, shift } = await setup()
    await shift(mary.id, server.id, '2026-10-26', 4, 115)
    await expect(a.mutation(api.roles.remove, { id: server.id })).rejects.toThrow(/Archive it instead/)
    await expect(a.mutation(api.employees.remove, { id: mary.id })).rejects.toThrow(/Mark them inactive/)
    await a.mutation(api.roles.update, { id: server.id, active: false })
    await expect(shift(mary.id, server.id, '2026-10-27', 4, 1)).rejects.toThrow(/archived/)
    const log = await a.query(api.audit.list, {})
    expect(log.entries.map(e => e.action)).toEqual(expect.arrayContaining(['role.create', 'employee.create', 'shift.create', 'role.update']))
    expect(log.entries.find(e => e.action === 'shift.create')).toMatchObject({ actorName: 'Mary' })
    const roleLog = await a.query(api.audit.list, { entityType: 'role', entityId: server.id })
    expect(roleLog.entries.map(e => e.action)).toEqual(['role.update', 'role.create'])
  })
})

describe('Convex backend: import from Postgres', () => {
  it('refuses every call without the migration token', async () => {
    const t = convexTest(schema, modules)
    delete process.env.MIGRATION_TOKEN
    await expect(t.mutation(api.etl.importRows, { token: '', table: 'roles', rows: [] })).rejects.toThrow(/disabled/)
    process.env.MIGRATION_TOKEN = TOKEN
    await expect(t.query(api.etl.idMap, { token: 'wrong', table: 'roles' })).rejects.toThrow(/disabled/)
  })

  it('inserts once, skips identical re-runs, refuses conflicts, and keeps old IDs working', async () => {
    process.env.MIGRATION_TOKEN = TOKEN
    const t = convexTest(schema, modules)
    const role = { legacyId: 'pg-role', name: 'server', active: true, createdAt: 1, updatedAt: 1 }
    const employee = { legacyId: 'pg-emp', name: 'Mary', active: true, defaultRoleId: 'pg-role', createdAt: 1, updatedAt: 1 }
    const version = { legacyId: 'pg-v1', roleId: 'pg-role', effectiveFrom: '2025-03-24', effectiveTo: null, ...serverSettings('server'), note: null, createdAt: 1, createdBy: 'backfill' }
    const shiftRow = { legacyId: 'pg-shift', employeeId: 'pg-emp', roleId: 'pg-role', date: '2026-10-26', hours: 4, cashTips: 0, creditTips: 115, liquorSales: 138, createdAt: 1, updatedAt: 1 }
    for (const [table, rows] of [['roles', [role]], ['employees', [employee]], ['roleVersions', [version]], ['shifts', [shiftRow]]] as const) {
      expect(await t.mutation(api.etl.importRows, { token: TOKEN, table, rows: [...rows] })).toEqual({ inserted: 1, skipped: 0 })
      expect(await t.mutation(api.etl.importRows, { token: TOKEN, table, rows: [...rows] })).toEqual({ inserted: 0, skipped: 1 })
    }
    await expect(t.mutation(api.etl.importRows, { token: TOKEN, table: 'shifts', rows: [{ ...shiftRow, creditTips: 999 }] })).rejects.toThrow(/different values/)
    const a = t.withIdentity(admin)
    expect(await a.query(api.shifts.get, { id: 'pg-shift' })).toMatchObject({ creditTips: 115, employee: { name: 'Mary' } })
    expect(await a.query(api.employees.get, { id: 'pg-emp' })).toMatchObject({ name: 'Mary', defaultRole: { name: 'server' } })
  })
})
