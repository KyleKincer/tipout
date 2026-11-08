import { buildExampleNight, summarizeRoleRates, type RateRole } from './howTipsWork'
import type { RoleConfig } from '@/types/reports'

const cfg = (tipoutType: RoleConfig['tipoutType'], options: Partial<RoleConfig> = {}): RoleConfig => ({
  id: `${tipoutType}-${options.effectiveFrom ?? 'x'}`, tipoutType, percentageRate: 0,
  effectiveFrom: '2025-03-24T00:00:00.000Z', effectiveTo: null, paysTipout: true, receivesTipout: false, ...options,
})

// Mirrors the live setup: servers pool, pay bar on liquor and host/SA on tips; an old bar rate has ended.
const roles = (pooled = true): RateRole[] => {
  const serverPool = pooled ? 'server' : undefined
  return [
    { name: 'bar', configs: [
      cfg('bar', { paysTipout: false, receivesTipout: true, distributionGroup: 'bartenders', tipPoolGroup: 'bar' }),
      cfg('host', { percentageRate: 7, tipPoolGroup: 'bar' }),
      cfg('sa', { percentageRate: 4, tipPoolGroup: 'bar' }),
    ] },
    { name: 'host', configs: [cfg('host', { paysTipout: false, receivesTipout: true, distributionGroup: 'hosts' })] },
    { name: 'server', configs: [
      cfg('bar', { percentageRate: 25, effectiveTo: '2025-05-06T00:00:00.000Z', tipPoolGroup: serverPool }),
      cfg('bar', { percentageRate: 20, effectiveFrom: '2025-05-06T00:00:00.000Z' }),
      cfg('host', { percentageRate: 7, tipPoolGroup: serverPool }),
      cfg('sa', { percentageRate: 4, tipPoolGroup: serverPool }),
    ] },
    { name: 'server assistant', configs: [cfg('sa', { paysTipout: false, receivesTipout: true, distributionGroup: 'sa' })] },
  ]
}
const today = new Date('2026-11-08T12:00:00.000Z')

describe('how tips work', () => {
  it('summarizes the rates payroll applies today, skipping ended configs', () => {
    const server = summarizeRoleRates(roles(), today).find(r => r.name === 'server')!
    expect(server.pays).toEqual([
      { type: 'bar', rate: 20 }, { type: 'host', rate: 7 }, { type: 'sa', rate: 4 },
    ])
    expect(server.poolGroup).toBe('server')
    const host = summarizeRoleRates(roles(), today).find(r => r.name === 'host')!
    expect(host).toEqual({ name: 'host', pays: [], receives: ['host'], poolGroup: null })
  })

  it('runs the example night through the real payroll calculation', () => {
    const night = buildExampleNight(roles(), today)!
    expect(night.pooled).toBe(true)
    expect(night.rates).toEqual({ bar: 20, host: 7 })
    expect(night.pool).toMatchObject({ creditTips: 180, hours: 10 })
    expect(night.pool!.hostPaid).toBeCloseTo(12.6)
    expect(night.pool!.perHour).toBeCloseTo(16.74)
    const [a, b] = night.servers
    expect(a.poolShare).toBeCloseTo(66.96)
    expect(a.paidBar).toBeCloseTo(20)
    expect(a.payrollTips).toBeCloseTo(46.96)
    expect(a.ownNet - a.poolShare).toBeCloseTo(44.64)
    expect(b.payrollTips).toBeCloseTo(90.44)
    expect(night.bartenderReceived).toBeCloseTo(30)
    expect(night.hostReceived).toBeCloseTo(12.6 + 6.3)
  })

  it('describes unpooled servers when the server role has no pool group', () => {
    const night = buildExampleNight(roles(false), today)!
    expect(night.pooled).toBe(false)
    expect(night.pool).toBeNull()
    expect(night.servers[0].poolShare).toBe(120)
    expect(night.servers[0].payrollTips).toBeCloseTo(120 - 8.4 - 20)
  })

  it('has no example when a needed role is missing', () => {
    expect(buildExampleNight(roles().filter(r => r.name !== 'host'), today)).toBeNull()
  })
})
