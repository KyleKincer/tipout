import { normalizeReport, reportDiff, type ReportResponse } from '../lib/report-parity';
import { calculateDailyReport } from '../../src/lib/reportCalculations';

const report: ReportResponse = {
  summary: { totalHours: 8 }, roleConfigs: {},
  employeeSummaries: [
    { employeeId: 'legacy-b', employeeName: 'Same name', roleName: 'bar', totalPayrollTips: 9 },
    { employeeId: 'legacy-a', employeeName: 'Same name', roleName: 'bar', totalPayrollTips: 8 },
  ],
};

test('matches people by source identity even when names collide', () => {
  const target = { ...report, employeeSummaries: [
    { ...report.employeeSummaries[1], employeeId: 'convex-a' },
    { ...report.employeeSummaries[0], employeeId: 'convex-b' },
  ] };
  const ids = new Map([['convex-a', 'legacy-a'], ['convex-b', 'legacy-b']]);
  expect(reportDiff(normalizeReport(report), normalizeReport(target, ids))).toEqual([]);
  target.employeeSummaries[0].employeeId = 'convex-b';
  expect(reportDiff(normalizeReport(report), normalizeReport(target, ids)).length).toBeGreaterThan(0);
});

test('fails on unmapped identities', () => {
  expect(() => normalizeReport(report, new Map())).toThrow('unmapped');
});

test('never tolerates half-cent or penny discrepancies', () => {
  expect(reportDiff({ value: 10 }, { value: 10.005 })).toEqual(['value: numeric mismatch']);
  expect(reportDiff({ value: 10 }, { value: 10.01 })).toEqual(['value: numeric mismatch']);
  expect(reportDiff({ value: 10 }, { value: 10 + 1e-12 })).toEqual([]);
});

test('does not expose names or amounts in discrepancy output', () => {
  expect(reportDiff({ employeeName: 'Private Name', amount: 17 }, { employeeName: 'Other Name', amount: 19 }))
    .toEqual(['employeeName: value/type mismatch', 'amount: numeric mismatch']);
});

test('reconciles per-shift allocations by native/source shift and employee IDs', () => {
  const source = calculateDailyReport([{
    id: 'legacy-shift', employee: { id: 'legacy-employee', name: 'Shared label' },
    date: '2026-10-01T00:00:00.000Z', hours: 3, cashTips: 0, creditTips: 1, liquorSales: 0,
    role: { name: 'bar', basePayRate: 4, configs: [{
      id: 'legacy-config', tipoutType: 'bar', percentageRate: 0, effectiveFrom: '2025-01-01', effectiveTo: null,
    }] },
  }]);
  const baseline: ReportResponse = { ...source, summary: null, roleConfigs: {}, employeeSummaries: [] };
  const target: ReportResponse = { ...baseline, shiftResults: baseline.shiftResults!.map(shift => ({
    ...shift, id: 'native-shift', employee: { ...shift.employee, id: 'native-employee' },
  })) };
  const employees = new Map([['native-employee', 'legacy-employee']]);
  const shifts = new Map([['native-shift', 'legacy-shift']]);
  expect(reportDiff(normalizeReport(baseline), normalizeReport(target, employees, shifts))).toEqual([]);
  expect(() => normalizeReport(target, employees, new Map())).toThrow('unmapped shift');
  target.shiftResults![0].payrollTips += 0.01;
  expect(reportDiff(normalizeReport(baseline), normalizeReport(target, employees, shifts)))
    .toContain('shiftResults[0].payrollTips: numeric mismatch');
});
