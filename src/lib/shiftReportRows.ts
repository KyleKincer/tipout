import type { ShiftReportResult } from './reportCalculations'

type DisplayFilters = { employeeId?: string; role?: string }

// Filter AFTER the shared report has allocated every contribution for each day.
export function filterShiftReportResults(shifts: ShiftReportResult[], filters: DisplayFilters) {
  return shifts.filter(shift =>
    (!filters.employeeId || shift.employee.id === filters.employeeId) &&
    (!filters.role || shift.role.name === filters.role)
  ).sort((a, b) => b.date.localeCompare(a.date))
}
