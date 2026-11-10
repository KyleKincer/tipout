const calls: { kind: string; fn: string; args: unknown; token?: string }[] = []
let nextResult: unknown = {}
let nextError: unknown = null
let token: string | null = 'jwt'

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ userId: 'user_1', sessionClaims: {}, getToken: jest.fn(async () => token) })),
  currentUser: jest.fn(),
}))
jest.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    private token?: string
    setAuth(t: string) { this.token = t }
    async query(fn: unknown, args: unknown) { return this.run('query', fn, args) }
    async mutation(fn: unknown, args: unknown) { return this.run('mutation', fn, args) }
    private async run(kind: string, fn: unknown, args: unknown) {
      const { getFunctionName } = jest.requireActual('convex/server')
      calls.push({ kind, fn: getFunctionName(fn), args, token: this.token })
      if (nextError) throw nextError
      return nextResult
    }
  },
}))
jest.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: () => { throw new Error('Postgres must not be used in Convex mode') } }) }))

import { NextRequest } from 'next/server'
import { ConvexError } from 'convex/values'
import { GET as getReport } from './reports/route'
import { POST as postShift } from './shifts/route'
import { POST as postVersion, DELETE as undoVersion } from './roles/[id]/versions/route'
import { POST as lockPeriod } from './pay-periods/[id]/route'
import { PUT as putEmployee } from './employees/[id]/route'

const req = (path: string, method = 'GET', body?: unknown) =>
  new NextRequest(`https://example.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('API routes in Convex mode', () => {
  beforeAll(() => {
    process.env.DATA_BACKEND = 'convex'
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud'
  })
  afterAll(() => { delete process.env.DATA_BACKEND })
  beforeEach(() => { calls.length = 0; nextResult = {}; nextError = null; token = 'jwt' })

  it('sends reports to Convex as the signed-in user', async () => {
    nextResult = { shiftResults: [] }
    const response = await getReport(req('/api/reports?startDate=2026-10-26&endDate=2026-10-27'))
    expect(await response.json()).toEqual({ shiftResults: [] })
    expect(calls).toEqual([{ kind: 'query', fn: 'reports:get', args: { startDate: '2026-10-26', endDate: '2026-10-27' }, token: 'jwt' }])
  })

  it('keeps the status and message of Convex errors', async () => {
    nextError = new ConvexError({ status: 409, message: 'Payroll for 2026-10-19 to 2026-11-01 is locked' })
    const response = await lockPeriod(req('/api/pay-periods/p1', 'POST', { action: 'lock' }), ctx('p1'))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Payroll for 2026-10-19 to 2026-11-01 is locked' })
    expect(calls[0]).toMatchObject({ kind: 'mutation', fn: 'payPeriods:lock', args: { id: 'p1' } })
  })

  it('validates shift input before calling Convex', async () => {
    const bad = await postShift(req('/api/shifts', 'POST', { employeeId: 'e', roleId: 'r', date: '2026-10-26', hours: 0 }))
    expect(bad.status).toBe(400)
    expect(calls).toHaveLength(0)
    await postShift(req('/api/shifts', 'POST', { employeeId: 'e', roleId: 'r', date: '2026-10-26', hours: '5', creditTips: '45.5' }))
    expect(calls[0]).toMatchObject({ fn: 'shifts:create', args: { employeeId: 'e', roleId: 'r', date: '2026-10-26', hours: 5, creditTips: 45.5, cashTips: 0, liquorSales: 0 } })
  })

  it('routes settings previews, saves and undo to the right functions', async () => {
    const settings = { basePayRate: 3, tipPoolGroup: null, tipouts: [{ tipoutType: 'bar', percentageRate: 20, paysTipout: true, receivesTipout: false, distributionGroup: null, extra: 'dropped' }] }
    await postVersion(req('/api/roles/r1/versions', 'POST', { effectiveFrom: '2026-11-16', settings, dryRun: true }), ctx('r1'))
    await postVersion(req('/api/roles/r1/versions', 'POST', { effectiveFrom: '2026-11-16', settings, note: 'pooling off', confirmAffected: true }), ctx('r1'))
    await undoVersion(req('/api/roles/r1/versions?confirm=1', 'DELETE'), ctx('r1'))
    expect(calls.map(c => c.fn)).toEqual(['roles:planChange', 'roles:changeSettings', 'roles:undoLatest'])
    expect(calls[1].args).toEqual({
      id: 'r1', effectiveFrom: '2026-11-16', note: 'pooling off', confirmAffected: true,
      settings: { basePayRate: 3, tipPoolGroup: null, tipouts: [{ tipoutType: 'bar', percentageRate: 20, paysTipout: true, receivesTipout: false, distributionGroup: null }] },
    })
    expect(calls[2].args).toEqual({ id: 'r1', confirmAffected: true })
  })

  it('passes only the employee fields that were sent', async () => {
    await putEmployee(req('/api/employees/e1', 'PUT', { name: 'Mary Cims', defaultRoleId: '' }), ctx('e1'))
    expect(calls[0].args).toEqual({ id: 'e1', name: 'Mary Cims', defaultRoleId: null })
  })

  it('explains a missing Clerk token template', async () => {
    token = null
    const response = await getReport(req('/api/reports?startDate=2026-10-26&endDate=2026-10-26'))
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('"convex" token template')
  })
})
