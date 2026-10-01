type EmployeeIdentity = { id: string; legacyId?: string };

export function resolveEmployeeFilterId(employees: readonly EmployeeIdentity[] | undefined, id: string): string {
  if (!id || !employees) return id;
  if (employees.some(employee => employee.id === id)) return id;
  const matches = new Set(employees.filter(employee => employee.legacyId === id).map(employee => employee.id));
  return matches.size === 1 ? Array.from(matches)[0] : id;
}
