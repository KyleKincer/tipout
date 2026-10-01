import { createHash } from "node:crypto";

/** Pure validation/planning. No clients, credentials, writes, or row-value logs. */
export const TABLES = ["roles", "employees", "roleConfigs", "shifts"] as const;
export type Table = (typeof TABLES)[number];
export type Row = Record<string, unknown>;
export type Tables = Record<Table, Row[]>;
export const MAX_ROWS = 100_000;
export const SPECS = {
  roles: { model: "Role", strings: ["id", "name"], nullableStrings: [], booleans: [], decimals: ["basePayRate"], dates: ["createdAt", "updatedAt"], nullableDates: [] },
  employees: { model: "Employee", strings: ["id", "name"], nullableStrings: ["defaultRoleId"], booleans: ["active"], decimals: [], dates: ["createdAt", "updatedAt"], nullableDates: [] },
  roleConfigs: { model: "RoleConfig", strings: ["id", "roleId", "tipoutType"], nullableStrings: ["distributionGroup", "tipPoolGroup"], booleans: ["receivesTipout", "paysTipout"], decimals: ["percentageRate"], dates: ["effectiveFrom", "createdAt", "updatedAt"], nullableDates: ["effectiveTo"] },
  shifts: { model: "Shift", strings: ["id", "employeeId", "roleId"], nullableStrings: [], booleans: [], decimals: ["hours", "cashTips", "creditTips", "liquorSales"], dates: ["date", "createdAt", "updatedAt"], nullableDates: [] },
} satisfies Record<Table, { model: string; strings: string[]; nullableStrings: string[]; booleans: string[]; decimals: string[]; dates: string[]; nullableDates: string[] }>;

export class BackfillError extends Error {}
export function requireSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BackfillError(message);
}
export function fieldsFor(table: Table): string[] {
  const s = SPECS[table];
  return [...s.strings, ...s.nullableStrings, ...s.booleans, ...s.decimals, ...s.dates, ...s.nullableDates].sort();
}
export function emptyTables(): Tables {
  return { roles: [], employees: [], roleConfigs: [], shifts: [] };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Row;
    return `{${Object.keys(row).filter(k => row[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(row[k])}`).join(",")}}`;
  }
  const result = JSON.stringify(value);
  requireSafe(result !== undefined, "Unsupported value in archive");
  return result;
}
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// Decimal arithmetic is exact, including PostgreSQL numeric(65,30). Number()
// alone would silently round large coefficients and underflow tiny values.
export function decimalParts(value: unknown): { coefficient: bigint; scale: number } {
  requireSafe(typeof value === "string" && value.length <= 256, "Invalid decimal text");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  requireSafe(match, "Invalid decimal text");
  const exponent = Number(match[4] ?? 0);
  requireSafe(Number.isInteger(exponent) && Math.abs(exponent) <= 400, "Decimal exponent exceeds safety limit");
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] ?? ""}`);
  let scale = (match[3]?.length ?? 0) - exponent;
  if (scale < 0) { coefficient *= BigInt(10) ** BigInt(-scale); scale = 0; }
  while (scale > 0 && coefficient % BigInt(10) === BigInt(0)) { coefficient /= BigInt(10); scale--; }
  return { coefficient, scale };
}
function decimalText(coefficient: bigint, scale: number): string {
  const negative = coefficient < BigInt(0);
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const text = `${negative ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
export function sumDecimals(values: string[]): string {
  const parts = values.map(decimalParts);
  const scale = parts.reduce((max, p) => Math.max(max, p.scale), 0);
  const sum = parts.reduce((total, p) => total + p.coefficient * BigInt(10) ** BigInt(scale - p.scale), BigInt(0));
  return decimalText(sum, scale);
}
export function decimalToNumber(value: unknown): number {
  const source = decimalParts(value);
  const number = Number(value);
  requireSafe(Number.isFinite(number), "Non-finite decimal conversion");
  const target = decimalParts(number.toString());
  requireSafe(source.coefficient === target.coefficient && source.scale === target.scale,
    "Decimal cannot round-trip through Convex number without loss; retain archive and resolve representation before importing");
  return number === 0 ? 0 : number;
}
export function dateToMs(value: unknown): number {
  requireSafe(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), "Invalid millisecond UTC timestamp");
  const ms = Date.parse(value);
  requireSafe(Number.isSafeInteger(ms) && new Date(ms).toISOString() === value, "Invalid or unrepresentable timestamp");
  return ms;
}

export interface SourceIdentity { host: string; port: string; database: string; schema: string; principal: string }
export function sourceIdentity(databaseUrl: string): SourceIdentity {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new BackfillError("Invalid source database URL"); }
  requireSafe(["postgres:", "postgresql:"].includes(url.protocol), "Source must be PostgreSQL");
  let database: string;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new BackfillError("Invalid source database name"); }
  const schema = url.searchParams.get("schema") ?? "public";
  let principal: string;
  try { principal = decodeURIComponent(url.username); } catch { throw new BackfillError("Invalid source database principal"); }
  // Shared Supabase pooler hosts use the username to select the project. Omitting
  // it can give two different databases the same fingerprint. Never retain the
  // password or URL query secrets; the username stays only in the private archive.
  requireSafe(url.hostname && database && schema && principal, "Source identity requires an explicit database principal");
  return { host: url.hostname.toLowerCase(), port: url.port || "5432", database, schema, principal };
}
export function targetIdentity(rawUrl: string): string {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new BackfillError("Invalid target URL"); }
  requireSafe(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
    "Target must be an explicit HTTPS deployment origin without credentials, path, or query");
  return url.origin;
}
export interface Snapshot {
  version: 1;
  source: SourceIdentity;
  sourceFingerprint: string;
  capturedAt: string;
  postgresSnapshot: string;
  tables: Tables;
  checksum: string;
}
export function sealSnapshot(data: Omit<Snapshot, "checksum">): Snapshot {
  return { ...data, checksum: sha256(canonical(data)) };
}
export function validateSnapshot(value: unknown): Snapshot {
  requireSafe(value !== null && typeof value === "object", "Invalid snapshot envelope");
  const snapshot = value as Snapshot;
  requireSafe(canonical(Object.keys(snapshot).sort()) === canonical(["version", "source", "sourceFingerprint", "capturedAt", "postgresSnapshot", "tables", "checksum"].sort()), "Unexpected snapshot envelope fields");
  const { checksum, ...data } = snapshot;
  requireSafe(snapshot.version === 1 && checksum === sha256(canonical(data)), "Snapshot checksum or version mismatch");
  requireSafe(snapshot.source && canonical(Object.keys(snapshot.source).sort()) === canonical(["host", "port", "database", "schema", "principal"].sort()) && Object.values(snapshot.source).every(v => typeof v === "string" && v.length > 0), "Invalid source identity");
  requireSafe(snapshot.sourceFingerprint === sha256(canonical(snapshot.source)), "Source fingerprint mismatch");
  dateToMs(snapshot.capturedAt);
  requireSafe(typeof snapshot.postgresSnapshot === "string" && snapshot.postgresSnapshot.length > 0, "Missing PostgreSQL snapshot identity");
  normalizeSource(snapshot.tables);
  return snapshot;
}

/** Preserve all scalar fields; normalize only storage names and null/undefined. */
export function normalizeSource(raw: Tables): Tables {
  requireSafe(raw && canonical(Object.keys(raw).sort()) === canonical([...TABLES].sort()), "Snapshot tables do not match the four expected entities");
  const output = emptyTables();
  let total = 0;
  for (const table of TABLES) {
    requireSafe(Array.isArray(raw[table]), "Invalid snapshot table");
    total += raw[table].length;
    requireSafe(total <= MAX_ROWS, "Snapshot exceeds supported 100,000-row in-memory safety limit");
    const seen = new Set<string>();
    const s = SPECS[table];
    for (const row of raw[table]) {
      requireSafe(row && canonical(Object.keys(row).sort()) === canonical(fieldsFor(table)), `Unexpected or missing scalar fields in ${table}`);
      for (const field of s.strings) requireSafe(typeof row[field] === "string", `Invalid string in ${table}.${field}`);
      for (const field of s.nullableStrings) requireSafe(row[field] === null || typeof row[field] === "string", `Invalid nullable string in ${table}.${field}`);
      for (const field of s.booleans) requireSafe(typeof row[field] === "boolean", `Invalid boolean in ${table}.${field}`);
      requireSafe(typeof row.id === "string" && row.id.length > 0 && !seen.has(row.id), `Empty or duplicate legacy identity in ${table}`);
      seen.add(row.id);
      const doc: Row = { ...row, legacyId: row.id };
      delete doc.id;
      for (const field of s.decimals) doc[field] = decimalToNumber(row[field]);
      for (const field of s.dates) doc[field] = dateToMs(row[field]);
      for (const field of s.nullableDates) doc[field] = row[field] === null ? null : dateToMs(row[field]);
      requireSafe((doc.updatedAt as number) >= (doc.createdAt as number), `Reversed audit timestamps in ${table}`);
      if (table === "roleConfigs") {
        requireSafe(["", "bar", "host", "sa"].includes(doc.tipoutType as string), "Unsupported tipoutType; values are never trimmed, lowercased, or silently remapped");
        requireSafe(doc.effectiveTo === null || (doc.effectiveTo as number) >= (doc.effectiveFrom as number), "Reversed effective-date interval");
      }
      for (const field of ["defaultRoleId", "roleId", "employeeId"]) {
        if (field in doc) { doc[field.replace(/Id$/, "LegacyId")] = doc[field]; delete doc[field]; }
      }
      output[table].push(doc);
    }
    output[table].sort((a, b) => String(a.legacyId).localeCompare(String(b.legacyId), "en"));
  }
  const roles = new Set(output.roles.map(r => r.legacyId));
  const employees = new Set(output.employees.map(r => r.legacyId));
  for (const row of output.employees) requireSafe(row.defaultRoleLegacyId === null || roles.has(row.defaultRoleLegacyId), "Employee references missing source role");
  for (const row of [...output.roleConfigs, ...output.shifts]) requireSafe(roles.has(row.roleLegacyId), "Source references missing role");
  for (const row of output.shifts) requireSafe(employees.has(row.employeeLegacyId), "Source shift references missing employee");
  const configs = new Set<string>();
  for (const row of output.roleConfigs) {
    const key = canonical([row.roleLegacyId, row.tipoutType, row.effectiveFrom]);
    requireSafe(!configs.has(key), "Duplicate source RoleConfig compound identity"); configs.add(key);
  }
  return output;
}

/** Convert target foreign keys back to legacy IDs, refusing unmapped/extra data. */
export function normalizeTarget(raw: Tables): Tables {
  const output = emptyTables();
  const nativeIds = new Set<string>();
  for (const table of TABLES) for (const row of raw[table]) {
    requireSafe(typeof row._id === "string" && !nativeIds.has(row._id), "Duplicate or invalid target native identity");
    nativeIds.add(row._id);
  }
  const roleIds = new Map(raw.roles.map(r => [r._id, r.legacyId]));
  const employeeIds = new Map(raw.employees.map(r => [r._id, r.legacyId]));
  for (const table of TABLES) {
    const seen = new Set<string>();
    for (const row of raw[table]) {
      requireSafe(typeof row.legacyId === "string" && row.legacyId.length > 0, `Unmapped target row in ${table}; mixed/native target data requires a separate reviewed merge`);
      requireSafe(!seen.has(row.legacyId), `Duplicate target legacy identity in ${table}`); seen.add(row.legacyId);
      const { _id, _creationTime, ...doc } = row;
      requireSafe(typeof _id === "string" && typeof _creationTime === "number", `Invalid target system identity in ${table}`);
      for (const [field, mapping] of [["defaultRoleId", roleIds], ["roleId", roleIds], ["employeeId", employeeIds]] as const) {
        const optional = table === "employees" && field === "defaultRoleId";
        if (field in doc || optional) {
          const linked = doc[field] == null && optional ? null : mapping.get(doc[field]);
          requireSafe(linked === null || typeof linked === "string", `Missing or unmapped target relationship in ${table}`);
          doc[field.replace(/Id$/, "LegacyId")] = linked; delete doc[field];
        }
      }
      if (table === "roleConfigs") for (const field of ["effectiveTo", "distributionGroup", "tipPoolGroup"]) doc[field] ??= null;
      output[table].push(doc);
    }
    output[table].sort((a, b) => String(a.legacyId).localeCompare(String(b.legacyId), "en"));
  }
  return output;
}

export interface TablePlan { expected: number; actual: number; insert: number; unchanged: number; conflicts: number; extras: number; expectedHash: string; actualHash: string }
export interface Plan { tables: Record<Table, TablePlan>; insert: number; conflicts: number; extras: number; complete: boolean; aggregateExpected: Record<string, string>; aggregateActual: Record<string, string>; aggregatesMatch: boolean }
export function aggregates(tables: Tables): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const table of TABLES) for (const field of SPECS[table].decimals) {
    const values = tables[table].map(row => {
      requireSafe(typeof row[field] === "number" && Number.isFinite(row[field]), `Invalid target number in ${table}.${field}`);
      return String(row[field]);
    });
    totals[`${table}.${field}`] = sumDecimals(values);
  }
  return totals;
}
export function reconcile(expected: Tables, actual: Tables): Plan {
  const tables = {} as Record<Table, TablePlan>;
  let insert = 0, conflicts = 0, extras = 0;
  for (const table of TABLES) {
    const target = new Map(actual[table].map(r => [r.legacyId, r]));
    const source = new Map(expected[table].map(r => [r.legacyId, r]));
    let missing = 0, changed = 0, unchanged = 0;
    for (const row of expected[table]) {
      const existing = target.get(row.legacyId);
      if (!existing) missing++;
      else if (canonical(existing) !== canonical(row)) changed++;
      else unchanged++;
    }
    const extra = actual[table].filter(r => !source.has(r.legacyId)).length;
    tables[table] = { expected: source.size, actual: target.size, insert: missing, unchanged, conflicts: changed, extras: extra, expectedHash: sha256(canonical(expected[table])), actualHash: sha256(canonical(actual[table])) };
    insert += missing; conflicts += changed; extras += extra;
  }
  const aggregateExpected = aggregates(expected), aggregateActual = aggregates(actual);
  const aggregatesMatch = canonical(aggregateExpected) === canonical(aggregateActual);
  return { tables, insert, conflicts, extras, complete: !insert && !conflicts && !extras && aggregatesMatch, aggregateExpected, aggregateActual, aggregatesMatch };
}

export interface Checkpoint { version: 1; snapshotChecksum: string; targetUrl: string; confirmed: string[]; pending: string | null }
export const rowKey = (table: Table, row: Row): string => `${table}:${sha256(String(row.legacyId))}`;
export function assertCheckpoint(checkpoint: Checkpoint, snapshot: Snapshot, targetUrl: string, actual: Tables): void {
  requireSafe(checkpoint.version === 1 && checkpoint.snapshotChecksum === snapshot.checksum && checkpoint.targetUrl === targetUrl && Array.isArray(checkpoint.confirmed) && checkpoint.confirmed.every(k => typeof k === "string") && (checkpoint.pending === null || typeof checkpoint.pending === "string"), "Checkpoint does not match snapshot and target");
  const present = new Set(TABLES.flatMap(t => actual[t].map(r => rowKey(t, r))));
  requireSafe(checkpoint.confirmed.every(key => present.has(key)), "Previously observed target row was deleted; stop for review");
  requireSafe(checkpoint.pending === null || present.has(checkpoint.pending), "Prior write outcome is uncertain and row is absent; stop for review instead of recreating a possibly deleted row");
}
