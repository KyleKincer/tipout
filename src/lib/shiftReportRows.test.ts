import { calculateDailyReport } from './reportCalculations'
import { filterShiftReportResults } from './shiftReportRows'
import type { Shift, RoleConfig } from '@/types/reports'

const config = (type: 'bar' | 'host' | 'sa', options: Partial<RoleConfig> = {}): RoleConfig => ({
  id: type, tipoutType: type, percentageRate: 20, effectiveFrom: '2025-01-01',
  effectiveTo: null, paysTipout: true, receivesTipout: false, ...options,
})
const barConfig = config('bar', { paysTipout: false, receivesTipout: true, distributionGroup: 'bar' })
const shift = (id: string, employeeId: string, role: string, options: Partial<Shift> = {}): Shift => ({
  id, employee: { id: employeeId, name: employeeId }, date: '2026-09-29T00:00:00.000Z',
  hours: 1, cashTips: 0, creditTips: 0, liquorSales: 0,
  role: { name: role, basePayRate: 0, configs: [role === 'bar' ? barConfig : config('bar')] },
  ...options,
})

describe('report-aligned shift rows', () => {
  it('shows the same received, paid, and payroll amounts as Reports', () => {
    const source = [
      shift('bar', 'bartender', 'bar', { hours: 6.86, creditTips: 153.20 }),
      shift('server', 'server', 'server', { hours: 5.97, creditTips: 274.60, liquorSales: 304 }),
    ]
    const original = JSON.stringify(source)
    const result = calculateDailyReport(source)
    expect(JSON.stringify(source)).toBe(original)
    const [bar, server] = result.shiftResults
    expect(bar.barTipout).toBe(60.80)
    expect(bar.payrollTips).toBeCloseTo(214)
    expect(server.barTipout).toBe(-60.80)
    expect(server.payrollTips).toBeCloseTo(213.80)
    expect(bar.originalCreditTips).toBe(153.20)
    expect(bar.totalTipsPerHour).toBe(result.employeeSummaries[0].totalTipsPerHour)
  })

  it('keeps hidden contributors when filtering by employee and role', () => {
    const { shiftResults } = calculateDailyReport([
      shift('bar', 'bartender', 'bar'), shift('server', 'server', 'server', { liquorSales: 304 }),
    ])
    expect(filterShiftReportResults(shiftResults, { employeeId: 'bartender' })[0].barTipout).toBe(60.80)
    expect(filterShiftReportResults(shiftResults, { role: 'bar' })[0].barTipout).toBe(60.80)
    expect(filterShiftReportResults(shiftResults, { employeeId: 'server' })[0].barTipout).toBe(-60.80)
    expect(shiftResults).toHaveLength(2)
  })

  it('allocates multiple shifts for one employee by their original shift hours', () => {
    const { shiftResults, employeeSummaries } = calculateDailyReport([
      shift('early', 'bartender', 'bar', { hours: 2 }),
      shift('late', 'bartender', 'bar', { hours: 6 }),
      shift('server', 'server', 'server', { liquorSales: 100 }),
    ])
    expect(shiftResults.map(s => s.id)).toEqual(['early', 'late', 'server'])
    expect(shiftResults[0].barTipout).toBe(5)
    expect(shiftResults[1].barTipout).toBe(15)
    expect(employeeSummaries.find(s => s.employeeId === 'bartender')?.totalBarTipout).toBe(20)
  })

  it('does not duplicate a whole employee summary across different roles', () => {
    const { shiftResults } = calculateDailyReport([
      shift('bar', 'both', 'bar'), shift('server', 'both', 'server', { liquorSales: 100 }),
    ])
    expect(shiftResults.map(s => s.barTipout)).toEqual([20, -20])
    expect(filterShiftReportResults(shiftResults, { employeeId: 'both', role: 'bar' })).toHaveLength(1)
  })

  it('keeps distributions separate by calendar day', () => {
    const tomorrow = '2026-09-30T00:00:00.000Z'
    const { shiftResults } = calculateDailyReport([
      shift('bar1', 'bar1', 'bar'), shift('server1', 'server1', 'server', { liquorSales: 100 }),
      shift('bar2', 'bar2', 'bar', { date: tomorrow }),
      shift('server2', 'server2', 'server', { date: tomorrow, liquorSales: 200 }),
    ])
    expect(shiftResults.find(s => s.id === 'bar1')?.barTipout).toBe(20)
    expect(shiftResults.find(s => s.id === 'bar2')?.barTipout).toBe(40)
    expect(filterShiftReportResults(shiftResults, {})[0].date).toBe(tomorrow)
  })

  it('retains pooled credit shares and host deductions exactly once', () => {
    const pooledBar = { name: 'bar', basePayRate: 0, configs: [
      { ...barConfig, tipPoolGroup: 'bar-pool' }, config('host', { percentageRate: 10, tipPoolGroup: 'bar-pool' }),
    ] }
    const { shiftResults, employeeSummaries } = calculateDailyReport([
      shift('bar1', 'bar1', 'bar', { hours: 1, creditTips: 100, role: pooledBar }),
      shift('bar2', 'bar2', 'bar', { hours: 3, role: pooledBar }),
      shift('server', 'server', 'server', { creditTips: 100, liquorSales: 100 }),
      shift('host', 'host', 'host', { role: { name: 'host', basePayRate: 0, configs: [
        config('host', { paysTipout: false, receivesTipout: true, distributionGroup: 'host' }),
      ] } }),
    ])
    expect(shiftResults[0].creditTips).toBe(22.5)
    expect(shiftResults[1].creditTips).toBe(67.5)
    expect(shiftResults[0].payrollTips).toBe(27.5)
    expect(shiftResults[1].payrollTips).toBe(82.5)
    expect(shiftResults[3].hostTipout).toBe(10)
    expect(shiftResults.reduce((sum, s) => sum + s.payrollTips, 0)).toBe(200)
    expect(employeeSummaries.reduce((sum, s) => sum + s.totalPayrollTips, 0)).toBe(200)
  })

  it('keeps full precision for report aggregation instead of reallocating displayed pennies', () => {
    const { shiftResults, employeeSummaries } = calculateDailyReport([
      ...['a', 'b', 'c'].map(id => shift(id, 'bartender', 'bar')),
      shift('server', 'server', 'server', { liquorSales: 5 }),
    ])
    expect(shiftResults.slice(0, 3).map(s => s.barTipout)).toEqual([0.33, 0.33, 0.33])
    expect(shiftResults.slice(0, 3).reduce((sum, s) => sum + s.receivedBarTipout, 0)).toBeCloseTo(1)
    expect(employeeSummaries.find(s => s.employeeId === 'bartender')?.totalBarTipout).toBe(1)
  })

  it('matches Reports rate rounding and handles zero hours without infinity', () => {
    const baseRole = { name: 'bar', basePayRate: 1.005, configs: [barConfig] }
    const result = calculateDailyReport([shift('bar', 'bartender', 'bar', { hours: 3, creditTips: 1, role: baseRole })])
    const report = result.employeeSummaries[0]
    expect(result.shiftResults[0].totalTipsPerHour).toBe(report.totalTipsPerHour)
    const zero = calculateDailyReport([shift('zero', 'zero', 'bar', { hours: 0 })]).shiftResults[0]
    expect(zero.totalTipsPerHour).toBe(0)
    expect(zero.payrollTips).toBe(0)
    expect(Number.isFinite(zero.totalTipsPerHour)).toBe(true)
  })

  it('returns an empty shape and honors date-effective recipient configuration', () => {
    expect(calculateDailyReport([])).toEqual({ shiftResults: [], employeeSummaries: [] })
    const { shiftResults } = calculateDailyReport([
      shift('bar', 'bartender', 'bar', { role: { name: 'bar', basePayRate: 0, configs: [
        { ...barConfig, effectiveFrom: '2026-10-01' },
      ] } }),
      shift('server', 'server', 'server', { liquorSales: 304 }),
    ])
    expect(shiftResults.map(s => s.barTipout)).toEqual([0, 0])
  })
  it('keeps existing first-active configuration precedence at inclusive boundaries', () => {
    const closed = config('bar', { id: 'closed', percentageRate: 10, effectiveTo: '2026-09-29T00:00:00.000Z' })
    const current = config('bar', { id: 'current', percentageRate: 20, effectiveFrom: '2026-09-29T00:00:00.000Z' })
    const calculate = (configs: RoleConfig[]) => calculateDailyReport([
      shift('bar', 'bartender', 'bar'),
      shift('server', 'server', 'server', { liquorSales: 100, role: { name: 'server', basePayRate: 0, configs } }),
    ])
    const oldFirst = calculate([closed, current])
    expect(oldFirst.shiftResults.map(s => s.barTipout)).toEqual([10, -10])
    expect(oldFirst.employeeSummaries.map(s => s.totalBarTipout)).toEqual([10, -10])
    const currentFirst = calculate([current, closed])
    expect(currentFirst.shiftResults.map(s => s.barTipout)).toEqual([20, -20])
    expect(currentFirst.employeeSummaries.map(s => s.totalBarTipout)).toEqual([20, -20])
    // Preserve source ordering rather than silently choosing a new config policy.
    expect(oldFirst.shiftResults[1].paidBarTipout).toBe(10)
  })

  it('does not introduce row wage totals when legacy role-name aggregation is ambiguous', () => {
    const result = calculateDailyReport([
      shift('low', 'same', 'server', { creditTips: 5, role: { name: 'server', basePayRate: 10, configs: [] } }),
      shift('high', 'same', 'server', { creditTips: 7, role: { name: 'server', basePayRate: 20, configs: [] } }),
    ])
    // Keep existing Reports behavior, but expose only exact per-shift TIP allocations.
    expect(result.employeeSummaries[0].payrollTotal).toBe(52)
    expect(result.shiftResults.map(s => s.payrollTips)).toEqual([5, 7])
    for (const row of result.shiftResults) {
      expect(row).not.toHaveProperty('payrollTotal')
      expect(row).not.toHaveProperty('totalDollarsPerHour')
    }
  })

  it('keeps large report rows compact without historical configurations or wage metadata', () => {
    const historicalConfigs = Array.from({ length: 50 }, (_, i) => ({
      ...barConfig, id: `historical-${i}`, effectiveFrom: `20${String(10 + Math.floor(i / 12)).padStart(2, '0')}-01-01`,
    }))
    const source = Array.from({ length: 2000 }, (_, i) => shift(`bar-${i}`, 'bartender', 'bar', {
      role: { name: 'bar', basePayRate: 12, configs: historicalConfigs }, configs: historicalConfigs,
    }))
    const { shiftResults } = calculateDailyReport(source)
    expect(shiftResults).toHaveLength(2000)
    expect(shiftResults[0].role).toEqual({ name: 'bar' })
    expect(shiftResults[0]).not.toHaveProperty('configs')
    expect(Buffer.byteLength(JSON.stringify(shiftResults), 'utf8')).toBeLessThan(2 * 1024 * 1024)
  })
})
