export function shouldApplyEmployeeDefault(
  previousEmployeeId: string | undefined,
  employeeId: string | undefined,
  employeesLoaded: boolean,
): boolean {
  return employeesLoaded && previousEmployeeId !== employeeId;
}

export function getShiftEditorState<Shift, DayShift>(
  shift: Shift | null | undefined,
  dayShifts: DayShift[] | undefined,
): { status: 'not-found' } | { status: 'loading' } | { status: 'ready'; shift: Shift; dayShifts: DayShift[] } {
  if (shift === null) return { status: 'not-found' };
  if (shift === undefined || dayShifts === undefined) return { status: 'loading' };
  return { status: 'ready', shift, dayShifts };
}
