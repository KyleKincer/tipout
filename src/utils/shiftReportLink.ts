type ShiftReportFilters = {
  startDate: string
  endDate: string
  employeeId?: string
}

// Reports calculates all daily shifts before filtering to an employee, so incoming
// tipouts remain available even when the Shifts view is filtered to one person.
export function getShiftReportHref(filters: ShiftReportFilters, isDateRange: boolean): string {
  const params = new URLSearchParams({
    startDate: filters.startDate,
    endDate: isDateRange ? filters.endDate : filters.startDate,
  })

  if (filters.employeeId) params.set('employeeId', filters.employeeId)

  return `/reports?${params.toString()}`
}
