import { calculateTipouts } from './tipoutCalculations'
import { calculateDailyReport } from './reportCalculations'
import type { Shift } from '@/types/reports'

describe('report-aligned shift and report tipouts', () => {
  it('shows signed net tipouts and payroll consistently in both views', () => {
    const common = { date: '2026-09-29T00:00:00.000Z', cashTips: 0, configs: [] }
    const bar: Shift = {
      ...common,
      id: 'bar-shift', employee: { id: 'bartender', name: 'Bartender' },
      hours: 6.86, creditTips: 153.20, liquorSales: 0,
      role: { name: 'bar', basePayRate: 0, configs: [{
        id: 'bar-config', tipoutType: 'bar', percentageRate: 0,
        effectiveFrom: '2025-01-01', effectiveTo: null,
        paysTipout: false, receivesTipout: true, distributionGroup: 'bartenders',
      }] },
    }
    const server: Shift = {
      ...common,
      id: 'server-shift', employee: { id: 'server', name: 'Server' },
      hours: 5.97, creditTips: 274.60, liquorSales: 304,
      role: { name: 'server', basePayRate: 0, configs: [{
        id: 'server-config', tipoutType: 'bar', percentageRate: 20,
        effectiveFrom: '2025-01-01', effectiveTo: null,
        paysTipout: true, receivesTipout: false,
      }] },
    }

    expect(calculateTipouts(bar, false, false, true).barTipout).toBe(0)
    expect(calculateTipouts(server, false, false, true).barTipout).toBeCloseTo(60.80)

    const { employeeSummaries: summaries, shiftResults } = calculateDailyReport([bar, server])
    expect(shiftResults[0].barTipout).toBe(60.80)
    expect(shiftResults[1].barTipout).toBe(-60.80)
    expect(shiftResults[0].payrollTips).toBeCloseTo(214)
    expect(shiftResults[1].payrollTips).toBeCloseTo(213.80)
    const barSummary = summaries.find(summary => summary.employeeId === 'bartender')!
    const serverSummary = summaries.find(summary => summary.employeeId === 'server')!
    expect(barSummary.totalBarTipout).toBeCloseTo(60.80)
    expect(barSummary.totalPayrollTips).toBeCloseTo(214)
    expect(serverSummary.totalBarTipout).toBeCloseTo(-60.80)
    expect(serverSummary.totalPayrollTips).toBeCloseTo(213.80)
    expect(barSummary.totalPayrollTips! + serverSummary.totalPayrollTips!).toBeCloseTo(427.80)
  })
})
