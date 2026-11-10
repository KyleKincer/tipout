/**
 * End-to-end check of dated settings and pay period locks through the real API routes and a real
 * database. Only sign-in is faked. Runs only when INTEGRATION_DATABASE_URL points at a local copy:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres:local@localhost:54329/postgres npx jest history.integration
 *
 * It changes data, so point it at a throwaway copy (after the migration and backfill).
 */
const url = process.env.INTEGRATION_DATABASE_URL
const run = url && /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? describe : describe.skip
if (url) process.env.DATABASE_URL = url

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ userId: 'test-admin', sessionClaims: { metadata: { roles: ['admin'] } } })),
  currentUser: jest.fn(async () => ({ fullName: 'Integration Test' })),
}))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateDailyReport } from '@/utils/reportCalculations'
import type { Shift, TipoutType } from '@/types/reports'
import { GET as getReport } from './reports/route'
import { POST as postVersion } from './roles/[id]/versions/route'
import { DELETE as deleteRole } from './roles/[id]/route'
import { POST as postShift } from './shifts/route'
import { PUT as putShift } from './shifts/[id]/route'
import { DELETE as deleteEmployee } from './employees/[id]/route'
import { POST as postPeriod } from './pay-periods/route'
import { POST as lockPeriod } from './pay-periods/[id]/route'

const req = (path: string, method = 'GET', body?: unknown) =>
  new NextRequest(`https://example.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const report = async (start: string, end: string) => (await getReport(req(`/api/reports?startDate=${start}&endDate=${end}`))).json()
const total = (rows: { payrollTips: number }[]) => Number(rows.reduce((s, r) => s + r.payrollTips, 0).toFixed(2))

run('dated settings and locks against a real database', () => {
  jest.setTimeout(60000)
  afterAll(() => prisma.$disconnect())

  it('reproduces every past result the legacy settings gave', async () => {
    const configs = await prisma.$queryRaw<{ roleId: string; tipoutType: string; percentageRate: number; effectiveFrom: Date; effectiveTo: Date | null; paysTipout: boolean; receivesTipout: boolean; distributionGroup: string | null; tipPoolGroup: string | null }[]>`
      SELECT "roleId", "tipoutType", "percentageRate"::float8 AS "percentageRate", "effectiveFrom", "effectiveTo", "paysTipout", "receivesTipout", "distributionGroup", "tipPoolGroup" FROM "RoleConfig" ORDER BY ctid`
    const rows = await prisma.shift.findMany({ include: { employee: true, role: true }, orderBy: { date: 'asc' } })
    const legacy: Shift[] = rows.map(s => ({
      id: s.id, date: s.date.toISOString(), employee: { id: s.employee.id, name: s.employee.name },
      hours: Number(s.hours), cashTips: Number(s.cashTips), creditTips: Number(s.creditTips), liquorSales: Number(s.liquorSales),
      role: { name: s.role.name, basePayRate: Number(s.role.basePayRate), configs: configs.filter(c => c.roleId === s.roleId).map((c, i) => ({
        id: String(i), tipoutType: c.tipoutType as TipoutType, percentageRate: c.percentageRate, effectiveFrom: c.effectiveFrom.toISOString(),
        effectiveTo: c.effectiveTo?.toISOString() ?? null, paysTipout: c.paysTipout, receivesTipout: c.receivesTipout,
        distributionGroup: c.distributionGroup ?? undefined, tipPoolGroup: c.tipPoolGroup ?? undefined,
      })) },
    }))
    const expected = new Map(calculateDailyReport(legacy).shiftResults.map(r => [r.id, r.payrollTips]))
    const first = rows[0].date.toISOString().slice(0, 10)
    const last = rows[rows.length - 1].date.toISOString().slice(0, 10)
    const data = await report(first, last)
    expect(data.shiftResults).toHaveLength(rows.length)
    for (const r of data.shiftResults) expect(r.payrollTips).toBeCloseTo(expected.get(r.id)!, 9)
  })

  it('turns server pooling off from a date without changing earlier nights', async () => {
    const server = await prisma.role.findFirstOrThrow({ where: { name: 'server' } })
    const before = await report('2026-10-26', '2026-10-26')
    const current = await prisma.roleVersion.findFirstOrThrow({ where: { roleId: server.id, effectiveTo: null }, include: { tipouts: true } })
    const settings = {
      basePayRate: Number(current.basePayRate), tipPoolGroup: null,
      tipouts: current.tipouts.map(t => ({ ...t, percentageRate: Number(t.percentageRate) })),
    }
    const response = await postVersion(req(`/api/roles/${server.id}/versions`, 'POST', { effectiveFrom: '2026-11-16', settings, note: 'restaurant ended server pooling' }), ctx(server.id))
    expect(await response.json()).toMatchObject({ ok: true, kind: 'create', changes: ['stops pooling tips (was the server pool)'] })

    const after = await report('2026-10-26', '2026-10-26')
    expect(after.shiftResults.map((r: { payrollTips: number }) => r.payrollTips)).toEqual(before.shiftResults.map((r: { payrollTips: number }) => r.payrollTips))

    // Two servers on Nov 16 now keep their own tips.
    const [a, b] = await prisma.employee.findMany({ where: { name: { in: ['maddy', 'Mary Cims'] } } })
    for (const [e, tips] of [[a, 115], [b, 45]] as const) {
      const res = await postShift(req('/api/shifts', 'POST', { employeeId: e.id, roleId: server.id, date: '2026-11-16', hours: 5, creditTips: tips, liquorSales: 0 }))
      expect(res.status).toBe(200)
    }
    const nov16 = await report('2026-11-16', '2026-11-16')
    expect(nov16.shiftResults.map((r: { tipPoolGroup: string | null }) => r.tipPoolGroup)).toEqual([null, null])
    expect(nov16.shiftResults.map((r: { payrollTips: number }) => r.payrollTips).sort((x: number, y: number) => x - y)).toEqual([45, 115])
    const range = await report('2026-11-10', '2026-11-20')
    expect(range.rules.find((r: { roleName: string }) => r.roleName === 'server').versions).toHaveLength(2)
  })

  it('locks a pay period so its shifts and settings cannot change', async () => {
    const created = await (await postPeriod(req('/api/pay-periods', 'POST', { startDate: '2026-10-19', endDate: '2026-11-01' }))).json()
    const locked = await lockPeriod(req(`/api/pay-periods/${created.id}`, 'POST', { action: 'lock' }), ctx(created.id))
    expect(locked.status).toBe(200)

    const shift = await prisma.shift.findFirstOrThrow({ where: { date: new Date('2026-10-26T00:00:00.000Z') }, include: { role: true } })
    const edit = await putShift(req(`/api/shifts/${shift.id}`, 'PUT', {
      employeeId: shift.employeeId, roleId: shift.roleId, date: '2026-10-26', hours: 1, creditTips: 0, liquorSales: 0,
    }), ctx(shift.id))
    expect(edit.status).toBe(409)
    const add = await postShift(req('/api/shifts', 'POST', { employeeId: shift.employeeId, roleId: shift.roleId, date: '2026-10-27', hours: 1 }))
    expect(add.status).toBe(409)

    const role = await prisma.roleVersion.findFirstOrThrow({ where: { roleId: shift.roleId, effectiveTo: null }, include: { tipouts: true } })
    const change = await postVersion(req(`/api/roles/${shift.roleId}/versions`, 'POST', {
      effectiveFrom: '2026-10-30', settings: { basePayRate: 99, tipPoolGroup: null, tipouts: [] },
    }), ctx(shift.roleId))
    expect(change.status).toBe(409)
    expect(role).toBeTruthy()

    const data = await report('2026-10-26', '2026-10-26')
    expect(data.shiftResults.every((r: { lockedPeriodId?: string }) => r.lockedPeriodId === created.id)).toBe(true)
    expect(data.drift).toEqual([])

    const unlock = await lockPeriod(req(`/api/pay-periods/${created.id}`, 'POST', { action: 'unlock' }), ctx(created.id))
    expect(unlock.status).toBe(400) // a reason is required
    const unlocked = await lockPeriod(req(`/api/pay-periods/${created.id}`, 'POST', { action: 'unlock', reason: 'test' }), ctx(created.id))
    expect(unlocked.status).toBe(200)
    expect(total((await report('2026-10-26', '2026-10-26')).shiftResults)).toBe(total(data.shiftResults))
  })

  it('asks before a backdated change recalculates shifts already entered', async () => {
    const host = await prisma.role.findFirstOrThrow({ where: { name: 'host' } })
    const current = await prisma.roleVersion.findFirstOrThrow({ where: { roleId: host.id, effectiveTo: null }, include: { tipouts: true } })
    const settings = { basePayRate: 11, tipPoolGroup: null, tipouts: current.tipouts.map(t => ({ ...t, percentageRate: Number(t.percentageRate) })) }
    const body = { effectiveFrom: '2026-10-20', settings }
    const preview = await (await postVersion(req(`/api/roles/${host.id}/versions`, 'POST', { ...body, dryRun: true }), ctx(host.id))).json()
    expect(preview.affects.shifts).toBeGreaterThan(0)
    const refused = await postVersion(req(`/api/roles/${host.id}/versions`, 'POST', body), ctx(host.id))
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain('Confirm to go ahead')
    expect(await prisma.roleVersion.count({ where: { roleId: host.id } })).toBe(2)
    const saved = await postVersion(req(`/api/roles/${host.id}/versions`, 'POST', { ...body, confirmAffected: true }), ctx(host.id))
    expect(saved.status).toBe(200)
    const oct19 = (await report('2026-10-19', '2026-10-24')).employeeSummaries.filter((s: { roleName: string }) => s.roleName === 'host')
    expect(oct19.length).toBeGreaterThan(0)
  })

  it('refuses to delete a role or employee that has shifts, leaving settings intact', async () => {
    const server = await prisma.role.findFirstOrThrow({ where: { name: 'server' } })
    const versions = await prisma.roleVersion.count({ where: { roleId: server.id } })
    const configs = await prisma.roleConfig.count({ where: { roleId: server.id } })
    expect((await deleteRole(req(`/api/roles/${server.id}`, 'DELETE'), ctx(server.id))).status).toBe(409)
    expect(await prisma.roleVersion.count({ where: { roleId: server.id } })).toBe(versions)
    expect(await prisma.roleConfig.count({ where: { roleId: server.id } })).toBe(configs)
    const employee = await prisma.employee.findFirstOrThrow({ where: { name: 'maddy' } })
    expect((await deleteEmployee(req(`/api/employees/${employee.id}`, 'DELETE'), ctx(employee.id))).status).toBe(409)
  })

  it('logs every change', async () => {
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map(a => a.action)
    expect(actions).toEqual(expect.arrayContaining(['backfill', 'settings.change', 'shift.create', 'payPeriod.create', 'payPeriod.lock', 'payPeriod.unlock']))
  })
})
