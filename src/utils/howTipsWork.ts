import { parseISO, isAfter, isBefore } from 'date-fns'
import { calculateDailyReport } from './reportCalculations'
import type { RoleConfig, Shift, TipoutType } from '@/types/reports'

export type RateRole = { name: string; basePayRate?: number; configs: RoleConfig[]; tipPoolGroup?: string | null }

export type RoleRateSummary = {
  name: string
  pays: { type: TipoutType; rate: number }[]
  receives: TipoutType[]
  poolGroup: string | null
}

const isActiveOn = (config: RoleConfig, date: Date) =>
  !isAfter(parseISO(config.effectiveFrom), date) &&
  (!config.effectiveTo || !isBefore(parseISO(config.effectiveTo), date))

/** First date-active config per tipout type, in stored order (the same rule payroll uses). */
function activeConfigsByType(role: RateRole, date: Date) {
  const byType = new Map<TipoutType, RoleConfig>()
  for (const config of role.configs) {
    if (!byType.has(config.tipoutType) && isActiveOn(config, date)) byType.set(config.tipoutType, config)
  }
  return byType
}

/** Payroll puts a role in a pool if any date-active config names a pool group. */
function activePoolGroup(role: RateRole, date: Date) {
  if (role.tipPoolGroup !== undefined) return role.tipPoolGroup || null
  return role.configs.find(c => c.tipPoolGroup && isActiveOn(c, date))?.tipPoolGroup ?? null
}

/** What each role pays, receives and pools with on the given date, as payroll applies it. */
export function summarizeRoleRates(roles: RateRole[], date: Date): RoleRateSummary[] {
  return roles
    .map(role => {
      const active = [...activeConfigsByType(role, date).values()]
      return {
        name: role.name,
        pays: active
          .filter(c => !c.receivesTipout && c.paysTipout !== false && c.percentageRate > 0)
          .map(c => ({ type: c.tipoutType, rate: c.percentageRate })),
        receives: active.filter(c => c.receivesTipout).map(c => c.tipoutType),
        poolGroup: activePoolGroup(role, date),
      }
    })
    .filter(r => r.pays.length > 0 || r.receives.length > 0 || r.poolGroup)
}

export type ExampleServer = {
  label: string
  hours: number
  creditTips: number
  liquorSales: number
  poolShare: number
  paidBar: number
  paidHost: number
  /** Own credit tips minus own host/SA tipout: what they'd keep before bar tipout without a pool. */
  ownNet: number
  payrollTips: number
}

export type ExampleNight = {
  serverRole: string
  pooled: boolean
  rates: { bar: number; host: number }
  servers: ExampleServer[]
  pool: { creditTips: number; hostPaid: number; left: number; hours: number; perHour: number } | null
  bartenderReceived: number
  hostReceived: number
}

const pickRole = (summaries: RoleRateSummary[], preferred: string, test: (r: RoleRateSummary) => boolean) =>
  summaries.find(r => r.name === preferred && test(r)) ?? summaries.find(test)

/**
 * A made-up night (two servers, a bartender and a host) run through the real payroll
 * calculation with today's role settings, so the example always matches the app.
 */
export function buildExampleNight(roles: RateRole[], date: Date): ExampleNight | null {
  const summaries = summarizeRoleRates(roles, date)
  const pays = (r: RoleRateSummary, t: TipoutType) => r.pays.some(p => p.type === t)
  const server = pickRole(summaries, 'server', r => pays(r, 'bar') && r.receives.length === 0)
  const bar = pickRole(summaries, 'bar', r => r.receives.includes('bar'))
  const host = pickRole(summaries, 'host', r => r.receives.includes('host'))
  if (!server || !bar || !host) return null

  const roleByName = new Map(roles.map(r => [r.name, r]))
  const day = date.toISOString().slice(0, 10) + 'T12:00:00.000Z'
  const shift = (id: string, roleName: string, hours: number, creditTips: number, liquorSales: number): Shift => {
    const role = roleByName.get(roleName)!
    return {
      id, date: day, employee: { id, name: id }, hours, cashTips: 0, creditTips, liquorSales,
      role: { name: role.name, basePayRate: role.basePayRate ?? 0, configs: role.configs, ...(role.tipPoolGroup !== undefined ? { tipPoolGroup: role.tipPoolGroup } : {}) },
    }
  }
  const inputs = [
    shift('server A', server.name, 4, 120, 100),
    shift('server B', server.name, 6, 60, 50),
    shift('bartender', bar.name, 6, 90, 0),
    shift('host', host.name, 5, 0, 0),
  ]
  const results = new Map(calculateDailyReport(inputs).shiftResults.map(r => [r.id, r]))

  const servers = inputs.slice(0, 2).map(s => {
    const r = results.get(s.id)!
    return {
      label: s.id, hours: s.hours, creditTips: s.creditTips, liquorSales: s.liquorSales,
      poolShare: r.creditTips, paidBar: r.paidBarTipout, paidHost: r.paidHostTipout,
      ownNet: s.creditTips - r.paidHostTipout - r.paidSaTipout, payrollTips: r.payrollTips,
    }
  })
  const pooled = !!server.poolGroup
  const hostPaid = servers.reduce((sum, s) => sum + s.paidHost, 0)
  const creditTips = servers.reduce((sum, s) => sum + s.creditTips, 0)
  const hours = servers.reduce((sum, s) => sum + s.hours, 0)
  const rate = (t: TipoutType) => server.pays.find(p => p.type === t)?.rate ?? 0

  return {
    serverRole: server.name,
    pooled,
    rates: { bar: rate('bar'), host: rate('host') },
    servers,
    pool: pooled ? { creditTips, hostPaid, left: creditTips - hostPaid, hours, perHour: (creditTips - hostPaid) / hours } : null,
    bartenderReceived: results.get('bartender')!.receivedBarTipout,
    hostReceived: results.get('host')!.receivedHostTipout,
  }
}
