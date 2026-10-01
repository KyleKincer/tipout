/** Legacy JSON identities are CUID/UUIDs for imported rows, native IDs for new rows. */
export type LegacyTable = 'employees' | 'roles' | 'shifts' | 'roleConfigs';
export type IdReference = { table: LegacyTable; id: string };
export type ResolvedReference = { table: LegacyTable; input: string; id: string | null; publicId: string | null };
export type JsonRecord = Record<string, unknown>;

const relationTables: Record<string, LegacyTable> = {
  shiftResults: 'shifts', employee: 'employees', defaultRole: 'roles', role: 'roles', configs: 'roleConfigs',
};
const foreignKeyTables: Record<string, LegacyTable> = {
  employeeId: 'employees', roleId: 'roles', defaultRoleId: 'roles',
};
export const referenceKey = ({ table, id }: IdReference) => `${table}:${id}`;

/** No string-wide replacement: names, groups, and role-config map keys are data. */
function visit(value: unknown, table: LegacyTable | undefined, id: (ref: IdReference) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => visit(item, table, id));
  if (!value || typeof value !== 'object') return value;
  const out: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'legacyId') continue; // Native UI metadata was not in the legacy contract.
    const idTable = key === 'id' ? table : foreignKeyTables[key];
    if (idTable && typeof child === 'string') out[key] = id({ table: idTable, id: child });
    else out[key] = visit(child, relationTables[key], id);
  }
  return out;
}

export function collectIdReferences(value: unknown, table?: LegacyTable): IdReference[] {
  const refs = new Map<string, IdReference>();
  visit(value, table, (ref) => { refs.set(referenceKey(ref), ref); return ref.id; });
  return [...refs.values()];
}

export function serializeLegacyIds(value: unknown, mappings: ResolvedReference[], table?: LegacyTable): unknown {
  const ids = new Map(mappings.map((ref) => [referenceKey({ table: ref.table, id: ref.input }), ref.publicId]));
  return visit(value, table, (ref) => {
    const mapped = ids.get(referenceKey(ref));
    // Missing referenced rows indicate a race or broken relation. Never silently
    // mix native and legacy identities in a nominally successful response.
    if (!mapped) throw new Error('Unresolved response identity');
    return mapped;
  });
}

export function currentRole(value: unknown): JsonRecord {
  const role = value as JsonRecord;
  return { ...role, configs: (role.configs as JsonRecord[]).filter((cfg) => cfg.effectiveTo == null) };
}

export function roleList(value: unknown): JsonRecord[] {
  return (value as JsonRecord[]).map((role) => ({
    id: role.id, name: role.name, basePayRate: role.basePayRate,
    configs: (role.configs as JsonRecord[]).map((cfg) => ({
      id: cfg.id, tipoutType: cfg.tipoutType, percentageRate: cfg.percentageRate,
      effectiveFrom: cfg.effectiveFrom, effectiveTo: cfg.effectiveTo, paysTipout: cfg.paysTipout,
    })),
  }));
}

/** Raw Prisma Decimal.toJSON returned strings on these endpoints only. */
export function rawConfigs(value: unknown): JsonRecord[] {
  return (value as JsonRecord[]).map((cfg) => ({ ...cfg, percentageRate: String(cfg.percentageRate) }));
}
export function rawEmployee(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rawEmployee);
  const employee = value as JsonRecord;
  if (!employee.defaultRole) return employee;
  const role = employee.defaultRole as JsonRecord;
  return { ...employee, defaultRole: { ...role, basePayRate: String(role.basePayRate) } };
}
