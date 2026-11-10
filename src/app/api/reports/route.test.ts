jest.mock('@/lib/prisma', () => ({
  prisma: {
    shift: { findMany: jest.fn() },
    role: { findMany: jest.fn() },
    roleVersion: { findMany: jest.fn() },
    payPeriod: { findMany: jest.fn() },
  },
}))
jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn(), currentUser: jest.fn() }))

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { GET } from './route'

const day = (d: string) => new Date(`${d}T00:00:00.000Z`)
const roles = [{ id: 'bar-role', name: 'bar' }, { id: 'server-role', name: 'server' }]
const versions = [
  { id: 'bar-v1', roleId: 'bar-role', effectiveFrom: day('2025-01-01'), effectiveTo: null, basePayRate: 9.75, tipPoolGroup: null, note: null, createdAt: new Date(), createdBy: null,
    tipouts: [{ tipoutType: 'bar', percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: 'bar' }] },
  { id: 'server-v1', roleId: 'server-role', effectiveFrom: day('2025-01-01'), effectiveTo: day('2026-09-30'), basePayRate: 3, tipPoolGroup: null, note: null, createdAt: new Date(), createdBy: null,
    tipouts: [{ tipoutType: 'bar', percentageRate: 20, paysTipout: true, receivesTipout: false, distributionGroup: null }] },
  { id: 'server-v2', roleId: 'server-role', effectiveFrom: day('2026-09-30'), effectiveTo: null, basePayRate: 3, tipPoolGroup: null, note: null, createdAt: new Date(), createdBy: null,
    tipouts: [{ tipoutType: 'bar', percentageRate: 10, paysTipout: true, receivesTipout: false, distributionGroup: null }] },
]
const shiftRow = (id: string, date: string, roleId: string, hours: number, creditTips: number, liquorSales: number) => ({
  id, date: day(date), hours, cashTips: 0, creditTips, liquorSales, employeeId: id.split('-')[0], roleId,
  employee: { id: id.split('-')[0], name: id.split('-')[0] }, role: roles.find(r => r.id === roleId),
})

describe('report data shared by Shifts and Reports', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as unknown as jest.Mock).mockResolvedValue({ userId: 'u1', sessionClaims: {} })
    ;(prisma.role.findMany as jest.Mock).mockResolvedValue(roles)
    ;(prisma.roleVersion.findMany as jest.Mock).mockResolvedValue(versions)
    ;(prisma.payPeriod.findMany as jest.Mock).mockResolvedValue([])
  })

  it('requires a signed-in user', async () => {
    ;(auth as unknown as jest.Mock).mockResolvedValue({ userId: null })
    const response = await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-29'))
    expect(response.status).toBe(401)
    expect(prisma.shift.findMany).not.toHaveBeenCalled()
  })

  it('uses the settings for each shift date across a change, and lists the rules', async () => {
    ;(prisma.shift.findMany as jest.Mock).mockResolvedValue([
      shiftRow('bar-29', '2026-09-29', 'bar-role', 6, 100, 0),
      shiftRow('server-29', '2026-09-29', 'server-role', 6, 200, 300),
      shiftRow('bar-30', '2026-09-30', 'bar-role', 6, 100, 0),
      shiftRow('server-30', '2026-09-30', 'server-role', 6, 200, 300),
    ])
    const response = await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-30'))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(prisma.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: { gte: day('2026-09-29'), lt: day('2026-10-01') } },
    }))
    const byId = Object.fromEntries(data.shiftResults.map((s: { id: string }) => [s.id, s]))
    expect(byId['server-29'].paidBarTipout).toBeCloseTo(60)
    expect(byId['server-30'].paidBarTipout).toBeCloseTo(30)
    expect(byId['bar-30'].payrollTips).toBeCloseTo(130)
    const server = data.rules.find((r: { roleName: string }) => r.roleName === 'server')
    expect(server.versions.map((v: { id: string }) => v.id)).toEqual(['server-v1', 'server-v2'])
    expect(server.versions[1].changes).toEqual(['bar tipout 20% → 10%'])
    expect(data.roleConfigs.server.barTipout).toBe(10)
  })

  it('returns the as-paid numbers for a locked pay period', async () => {
    ;(prisma.shift.findMany as jest.Mock).mockResolvedValue([shiftRow('server-29', '2026-09-29', 'server-role', 6, 200, 0)])
    const paid = { id: 'server-29', date: '2026-09-29T00:00:00.000Z', employee: { id: 'server', name: 'server' }, role: { name: 'server' },
      basePayRate: 3, versionId: 'server-v1', hours: 6, cashTips: 0, creditTips: 180, liquorSales: 0, originalCashTips: 0, originalCreditTips: 180,
      tipPoolGroup: null, paidBarTipout: 0, paidHostTipout: 0, paidSaTipout: 0, receivedBarTipout: 0, receivedHostTipout: 0, receivedSaTipout: 0,
      payrollTips: 180, barTipout: 0, hostTipout: 0, saTipout: 0, totalTipsPerHour: 30 }
    ;(prisma.payPeriod.findMany as jest.Mock).mockResolvedValue([{
      id: 'p1', startDate: day('2026-09-21'), endDate: day('2026-09-29'), lockedAt: new Date('2026-09-30T12:00:00Z'), lockedBy: 'Kyle',
      snapshot: { format: 1, shiftResults: [paid], employeeSummaries: [], roleVersions: [] },
    }])
    const data = await (await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-29'))).json()
    expect(data.shiftResults).toEqual([expect.objectContaining({ id: 'server-29', payrollTips: 180, lockedPeriodId: 'p1' })])
    expect(data.drift).toEqual([expect.objectContaining({ shiftId: 'server-29', paid: 180, now: 200 })])
    expect(data.lockedPeriods).toEqual([expect.objectContaining({ id: 'p1', lockedBy: 'Kyle' })])
  })

  it('returns empty results for a day without shifts', async () => {
    ;(prisma.shift.findMany as jest.Mock).mockResolvedValue([])
    const data = await (await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-29'))).json()
    expect(data).toMatchObject({ summary: null, employeeSummaries: [], shiftResults: [], roleConfigs: {}, drift: [] })
  })

  it('rejects bad dates', async () => {
    const response = await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-30&endDate=2026-09-29'))
    expect(response.status).toBe(400)
  })
})
