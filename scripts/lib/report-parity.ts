export type ReportResponse = {
  summary: Record<string, number> | null;
  employeeSummaries: Array<Record<string, string | number | null | undefined>>;
  roleConfigs: Record<string, { barTipout: number; hostTipout: number; sa: number }>;
};

// Names are labels, never an identity key: two employees may share a name.
export function normalizeReport(
  report: ReportResponse,
  employeeIds?: ReadonlyMap<string, string>,
): ReportResponse {
  const summaries: ReportResponse["employeeSummaries"] = report.employeeSummaries.map((row) => {
    const id = String(row.employeeId);
    const legacyId = employeeIds ? employeeIds.get(id) : id;
    if (!legacyId) throw new Error('Report contains an unmapped employee identity');
    return { ...row, employeeId: legacyId };
  });
  summaries.sort((a, b) => {
    const first = JSON.stringify([a.employeeId, a.roleName]);
    const second = JSON.stringify([b.employeeId, b.roleName]);
    return first.localeCompare(second);
  });
  return { ...report, employeeSummaries: summaries };
}

// Deliberately report paths only, never payroll amounts or employee names.
export function reportDiff(a: unknown, b: unknown, path = '', diffs: string[] = []): string[] {
  if (Object.is(a, b)) return diffs;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9) diffs.push(`${path}: numeric mismatch`);
    return diffs;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    diffs.push(`${path}: value/type mismatch`);
    return diffs;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push(`${path}: array/object mismatch`);
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}: length mismatch`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) reportDiff(a[i], b[i], `${path}[${i}]`, diffs);
    return diffs;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    reportDiff(left[key], right[key], path ? `${path}.${key}` : key, diffs);
  }
  return diffs;
}
