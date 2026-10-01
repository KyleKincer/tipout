import type { QueryCtx } from '../../convex/_generated/server';

jest.mock('../../convex/_generated/server', () => ({ query: (definition: unknown) => definition }));
import { get } from '../../convex/reports';
import { calculateDailyReport } from './reportCalculations';

type Result = ReturnType<typeof calculateDailyReport> & { summary: unknown };
type Handler = { handler: (ctx: QueryCtx, args: { startDate: string; endDate: string; employeeId?: string }) => Promise<Result> };

function fixture(authenticated = true, empty = false) {
  const date = Date.parse('2026-09-29T00:00:00.000Z');
  const employees = [{ _id: 'employeeBar', name: 'Bartender' }, { _id: 'employeeServer', name: 'Server' }];
  const roles = [{ _id: 'roleBar', name: 'bar', basePayRate: 5 }, { _id: 'roleServer', name: 'server', basePayRate: 3 }];
  const configs = [
    { _id: 'configBar', roleId: 'roleBar', tipoutType: 'bar', percentageRate: 0, effectiveFrom: 0, receivesTipout: true, paysTipout: false, distributionGroup: 'bartenders' },
    { _id: 'configServer', roleId: 'roleServer', tipoutType: 'bar', percentageRate: 20, effectiveFrom: 0, receivesTipout: false, paysTipout: true },
  ];
  const shifts = empty ? [] : [
    { _id: 'shiftBar', employeeId: 'employeeBar', roleId: 'roleBar', date, hours: 6.86, cashTips: 0, creditTips: 153.20, liquorSales: 0 },
    { _id: 'shiftServer', employeeId: 'employeeServer', roleId: 'roleServer', date, hours: 5.97, cashTips: 0, creditTips: 274.60, liquorSales: 304 },
  ];
  const collect = jest.fn();
  const ctx = {
    auth: { getUserIdentity: async () => authenticated ? { subject: 'staff' } : null },
    db: {
      get: async (id: string) => [...employees, ...roles].find(row => row._id === id) ?? null,
      query: (table: string) => ({ withIndex: (_name: string, apply: (q: unknown) => unknown) => {
        let roleId = '';
        const q = { eq: (_field: string, id: string) => { roleId = id; return q; }, gte: () => q, lte: () => q };
        apply(q);
        return { collect: async () => { collect(table); return table === 'shifts' ? shifts : configs.filter(config => config.roleId === roleId); } };
      } }),
    },
  } as unknown as QueryCtx;
  return { ctx, collect };
}
const args = { startDate: '2026-09-29', endDate: '2026-09-29' };

test('report returns per-shift native identity and signed payroll values from the same daily calculation', async () => {
  const { ctx } = fixture();
  const report = await (get as unknown as Handler).handler(ctx, { ...args, employeeId: 'employeeBar' });
  expect(report.shiftResults).toHaveLength(2); // Employee display filters cannot hide the contributor.
  const bar = report.shiftResults.find(row => row.id === 'shiftBar')!;
  const server = report.shiftResults.find(row => row.id === 'shiftServer')!;
  expect(bar.barTipout).toBe(60.8);
  expect(server.barTipout).toBe(-60.8);
  expect(bar.payrollTips).toBeCloseTo(214);
  expect(server.payrollTips).toBeCloseTo(213.8);
  for (const shift of report.shiftResults) {
    const summary = report.employeeSummaries.find(row => row.employeeId === shift.employee.id)!;
    expect(shift.barTipout).toBe(summary.totalBarTipout);
    expect(Number(shift.payrollTips.toFixed(2))).toBe(summary.totalPayrollTips);
  }
});

test('empty report includes an empty shiftResults collection', async () => {
  const { ctx } = fixture(true, true);
  expect(await (get as unknown as Handler).handler(ctx, args)).toEqual({ summary: null, employeeSummaries: [], shiftResults: [], roleConfigs: {} });
});

test('anonymous callers cannot obtain individual payroll allocations', async () => {
  const { ctx, collect } = fixture(false);
  await expect((get as unknown as Handler).handler(ctx, args)).rejects.toThrow('Not authenticated');
  expect(collect).not.toHaveBeenCalled();
});
