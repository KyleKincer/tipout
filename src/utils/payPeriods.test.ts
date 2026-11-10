import { calculateDailyReport, summarizeShiftResults } from './reportCalculations'
import { mergeWithLocked, validatePayPeriod, type LockedPeriod } from './payPeriods'
import { toEngineRole, type RoleSettings, type RoleVersion } from './roleVersions'
import type { Shift } from '../types/reports'

const settings = (pool: string | null, basePayRate = 3): RoleSettings => ({
  basePayRate, tipPoolGroup: pool,
  tipouts: [{ tipoutType: 'host', percentageRate: 10, paysTipout: true, receivesTipout: false, distributionGroup: null }],
})
const hostSettings: RoleSettings = {
  basePayRate: 10, tipPoolGroup: null,
  tipouts: [{ tipoutType: 'host', percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: 'hosts' }],
}
// Servers pool through Nov 15, then stop pooling and get a raise from Nov 16.
const serverVersions: RoleVersion[] = [
  { id: 'pooled', roleId: 'server', effectiveFrom: '2026-01-01', effectiveTo: '2026-11-16', ...settings('server') },
  { id: 'unpooled', roleId: 'server', effectiveFrom: '2026-11-16', effectiveTo: null, ...settings(null, 4) },
]
const hostVersion: RoleVersion = { id: 'host', roleId: 'host', effectiveFrom: '2026-01-01', effectiveTo: null, ...hostSettings }

const shift = (id: string, day: string, role: 'server' | 'host', hours: number, creditTips: number): Shift => {
  const version = role === 'host' ? hostVersion : serverVersions.find(v => v.effectiveFrom <= day && (!v.effectiveTo || day < v.effectiveTo))!
  return {
    id, date: `${day}T00:00:00.000Z`, employee: { id: id.split('-')[0], name: id.split('-')[0] },
    hours, cashTips: 0, creditTips, liquorSales: 0, role: toEngineRole(role, version, day),
  }
}

const shifts = [
  shift('amy-15', '2026-11-15', 'server', 4, 120),
  shift('bo-15', '2026-11-15', 'server', 6, 30),
  shift('cy-15', '2026-11-15', 'host', 5, 0),
  shift('amy-16', '2026-11-16', 'server', 4, 120),
  shift('bo-16', '2026-11-16', 'server', 6, 30),
  shift('cy-16', '2026-11-16', 'host', 5, 0),
]

describe('reports that cross a settings change', () => {
  it('pools on the night before the change and not the night after', () => {
    const { shiftResults, employeeSummaries } = calculateDailyReport(shifts)
    const r = Object.fromEntries(shiftResults.map(s => [s.id, s]))
    // Nov 15: $150 pooled, host takes $15, $135 split over 10 hours.
    expect(r['amy-15'].payrollTips).toBeCloseTo(54)
    expect(r['bo-15'].payrollTips).toBeCloseTo(81)
    // Nov 16: each keeps their own tips minus their own 10% host tipout.
    expect(r['amy-16'].payrollTips).toBeCloseTo(108)
    expect(r['bo-16'].payrollTips).toBeCloseTo(27)
    expect(r['cy-15'].receivedHostTipout).toBeCloseTo(15)
    expect(r['cy-16'].receivedHostTipout).toBeCloseTo(15)
    // Base pay uses each night's rate: 4h at $3 + 4h at $4.
    const amy = employeeSummaries.find(s => s.employeeId === 'amy')!
    expect(amy.totalBasePay).toBe(28)
    expect(amy.payrollTotal).toBe(28 + 162)
  })
})

describe('locked pay periods', () => {
  const live = calculateDailyReport(shifts).shiftResults
  const nov15 = live.filter(s => s.date.startsWith('2026-11-15'))
  const period: LockedPeriod = {
    id: 'p1', startDate: '2026-11-02', endDate: '2026-11-15', lockedAt: '2026-11-16T12:00:00.000Z', lockedBy: 'Kyle',
    snapshot: { format: 1, generatedAt: '', startDate: '2026-11-02', endDate: '2026-11-15', shiftResults: nov15, employeeSummaries: [], roleVersions: [] },
  }

  it('uses the as-paid numbers for locked days and live numbers after', () => {
    const changed = live.map(s => (s.id === 'amy-15' ? { ...s, payrollTips: 999 } : s))
    const merged = mergeWithLocked(changed, [period], { startDate: '2026-11-15', endDate: '2026-11-16' })
    const amy15 = merged.shiftResults.find(s => s.id === 'amy-15')!
    expect(amy15.payrollTips).toBeCloseTo(54)
    expect(amy15.lockedPeriodId).toBe('p1')
    expect(merged.shiftResults.find(s => s.id === 'amy-16')!.lockedPeriodId).toBeUndefined()
    expect(merged.drift).toEqual([expect.objectContaining({ shiftId: 'amy-15', paid: expect.closeTo(54), now: 999 })])
    expect(summarizeShiftResults(merged.shiftResults).find(s => s.employeeId === 'amy')!.totalPayrollTips).toBeCloseTo(162)
  })

  it('reports shifts added or removed after locking', () => {
    const extra = { ...live[0], id: 'new-15', employee: { id: 'new', name: 'new' } }
    const merged = mergeWithLocked([...live.filter(s => s.id !== 'bo-15'), extra], [period], { startDate: '2026-11-15', endDate: '2026-11-15' })
    expect(merged.drift.map(d => [d.shiftId, d.paid === null, d.now === null])).toEqual([['bo-15', false, true], ['new-15', true, false]])
    expect(merged.shiftResults.map(s => s.id)).not.toContain('new-15')
  })

  it('rejects overlapping or backwards pay periods', () => {
    const existing = [{ id: 'p1', startDate: '2026-11-02', endDate: '2026-11-15' }]
    expect(validatePayPeriod({ startDate: '2026-11-16', endDate: '2026-11-29' }, existing)).toEqual([])
    expect(validatePayPeriod({ startDate: '2026-11-15', endDate: '2026-11-29' }, existing)[0]).toContain('overlaps')
    expect(validatePayPeriod({ startDate: '2026-11-29', endDate: '2026-11-16' }, existing)[0]).toContain('on or after')
  })
})
