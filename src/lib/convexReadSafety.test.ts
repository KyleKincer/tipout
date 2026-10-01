import type { QueryCtx } from '../../convex/_generated/server'

// Exercise the real handlers without a deployed database or payroll fixtures.
jest.mock('../../convex/_generated/server', () => ({
  query: (definition: unknown) => definition,
  mutation: (definition: unknown) => definition,
}))

import * as employees from '../../convex/employees'
import * as roles from '../../convex/roles'
import * as roleConfigs from '../../convex/roleConfigs'
import * as shifts from '../../convex/shifts'
import * as tipPoolGroups from '../../convex/tipPoolGroups'
import * as reports from '../../convex/reports'

type Handler = { handler: (ctx: QueryCtx, args: Record<string, unknown>) => Promise<unknown> }

describe('Convex payroll read safety', () => {
  it.each([
    ['employees.list', employees.list], ['employees.get', employees.get],
    ['roles.list', roles.list], ['roles.get', roles.get],
    ['roleConfigs.listForRole', roleConfigs.listForRole],
    ['roleConfigs.listCurrentForRole', roleConfigs.listCurrentForRole],
    ['shifts.list', shifts.list], ['shifts.get', shifts.get],
    ['tipPoolGroups.list', tipPoolGroups.list], ['reports.get', reports.get],
  ])('%s rejects anonymous callers before accessing any rows', async (_name, query) => {
    const dbQuery = jest.fn()
    const dbGet = jest.fn()
    const ctx = {
      auth: { getUserIdentity: async () => null },
      db: { query: dbQuery, get: dbGet },
    } as unknown as QueryCtx
    await expect((query as unknown as Handler).handler(ctx, {})).rejects.toThrow('Not authenticated')
    expect(dbQuery).not.toHaveBeenCalled()
    expect(dbGet).not.toHaveBeenCalled()
  })

  it('calculates full-day incoming tipouts even when an employee filter is supplied', async () => {
    const date = Date.parse('2026-09-29T00:00:00.000Z')
    const common = { createdAt: date, updatedAt: date, _creationTime: date }
    const employeeRows = [
      { ...common, _id: 'bartender', name: 'Bartender', active: true },
      { ...common, _id: 'server', name: 'Server', active: true },
    ]
    const roleRows = [
      { ...common, _id: 'bar-role', name: 'bar', basePayRate: 0 },
      { ...common, _id: 'server-role', name: 'server', basePayRate: 0 },
    ]
    const shiftRows = [
      { ...common, _id: 'bar-shift', employeeId: 'bartender', roleId: 'bar-role', date, hours: 6.86, cashTips: 0, creditTips: 153.2, liquorSales: 0 },
      { ...common, _id: 'server-shift', employeeId: 'server', roleId: 'server-role', date, hours: 5.97, cashTips: 0, creditTips: 274.6, liquorSales: 304 },
    ]
    const configs = [
      { ...common, _id: 'bar-config', roleId: 'bar-role', tipoutType: 'bar', percentageRate: 0, effectiveFrom: date - 86400000, paysTipout: false, receivesTipout: true, distributionGroup: 'bartenders' },
      { ...common, _id: 'server-config', roleId: 'server-role', tipoutType: 'bar', percentageRate: 20, effectiveFrom: date - 86400000, paysTipout: true, receivesTipout: false },
    ]
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'clerk-user' }) },
      db: {
        get: async (id: string) => [...employeeRows, ...roleRows].find(row => row._id === id),
        query: (table: string) => ({
          withIndex: (_index: string, filter: (q: unknown) => unknown) => {
            let roleId: string | undefined
            const builder = {
              eq: (_field: string, value: string) => { roleId = value; return builder },
              gte: () => builder, lte: () => builder,
            }
            filter(builder)
            return { collect: async () => table === 'shifts' ? shiftRows : configs.filter(row => row.roleId === roleId) }
          },
        }),
      },
    } as unknown as QueryCtx
    const args = { startDate: '2026-09-29', endDate: '2026-09-29' }
    const handler = reports.get as unknown as Handler
    const all = await handler.handler(ctx, args)
    const selected = await handler.handler(ctx, { ...args, employeeId: 'bartender' })
    expect(selected).toEqual(all)
    const result = selected as { employeeSummaries: Array<{ employeeId: string; totalBarTipout: number; totalPayrollTips: number }> }
    const bar = result.employeeSummaries.find(row => row.employeeId === 'bartender')!
    expect(bar.totalBarTipout).toBe(60.8)
    expect(bar.totalPayrollTips).toBe(214)
  })
})

it('preserves an epoch-zero config end timestamp rather than converting it to null', async () => {
  const { serializeRoleConfig } = await import('../../convex/lib/serialize')
  const serialized = serializeRoleConfig({
    _id: 'config', _creationTime: 0, roleId: 'role', tipoutType: 'bar', percentageRate: 10,
    effectiveFrom: -86400000, effectiveTo: 0, paysTipout: true, receivesTipout: false,
    createdAt: -86400000, updatedAt: 0,
  } as unknown as Parameters<typeof serializeRoleConfig>[0])
  expect(serialized.effectiveTo).toBe('1970-01-01T00:00:00.000Z')
})
