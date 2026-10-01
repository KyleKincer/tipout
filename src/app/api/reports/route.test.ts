jest.mock('@/lib/prisma', () => ({
  prisma: { shift: { findMany: jest.fn() }, roleConfig: { findMany: jest.fn() } },
}), { virtual: true })
jest.mock('@/utils/reportCalculations', () => jest.requireActual('../../../utils/reportCalculations'), { virtual: true })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GET } from './route'

const dbConfig = (receives: boolean) => ({
  id: receives ? 'bar-config' : 'server-config', tipoutType: 'bar', percentageRate: receives ? 0 : 20,
  effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: null,
  receivesTipout: receives, paysTipout: !receives, distributionGroup: receives ? 'bar' : null, tipPoolGroup: null,
})

describe('report data shared by Shifts and Reports', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.roleConfig.findMany as jest.Mock).mockResolvedValue([])
  })

  it('returns per-shift allocations from the complete date range, even with display filters', async () => {
    ;(prisma.shift.findMany as jest.Mock).mockResolvedValue([
      { id: 'bar-shift', date: new Date('2026-09-29T00:00:00.000Z'), hours: 6.86, cashTips: 0, creditTips: 153.20, liquorSales: 0,
        employee: { id: 'bar', name: 'Bartender' }, role: { id: 'bar-role', name: 'bar', basePayRate: 0, configs: [dbConfig(true)] } },
      { id: 'server-shift', date: new Date('2026-09-29T00:00:00.000Z'), hours: 5.97, cashTips: 0, creditTips: 274.60, liquorSales: 304,
        employee: { id: 'server', name: 'Server' }, role: { id: 'server-role', name: 'server', basePayRate: 0, configs: [dbConfig(false)] } },
    ])
    const response = await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-30&employeeId=bar&role=bar'))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(prisma.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: { gte: new Date('2026-09-29T00:00:00.000Z'), lte: new Date('2026-09-30T23:59:59.999Z') } },
    }))
    expect(data.shiftResults).toHaveLength(2)
    expect(data.shiftResults.find((s: { id: string }) => s.id === 'bar-shift')).toMatchObject({ barTipout: 60.8, payrollTips: 214 })
    expect(data.employeeSummaries.find((s: { employeeId: string }) => s.employeeId === 'bar')).toMatchObject({ totalBarTipout: 60.8, totalPayrollTips: 214 })
  })

  it('returns an empty shiftResults array for a day without shifts', async () => {
    ;(prisma.shift.findMany as jest.Mock).mockResolvedValue([])
    const response = await GET(new NextRequest('https://example.com/api/reports?startDate=2026-09-29&endDate=2026-09-29'))
    expect(await response.json()).toEqual({ summary: null, employeeSummaries: [], shiftResults: [], roleConfigs: {} })
  })
})
