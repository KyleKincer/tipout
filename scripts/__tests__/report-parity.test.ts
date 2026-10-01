import { normalizeReport, reportDiff, type ReportResponse } from '../lib/report-parity';

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
