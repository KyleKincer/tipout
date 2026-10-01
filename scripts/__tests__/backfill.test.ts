import { mkdtemp, readFile, chmod, stat, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  TABLES, SPECS, assertCheckpoint, canonical, dateToMs, decimalToNumber, emptyTables,
  fieldsFor, normalizeSource, normalizeTarget, reconcile, rowKey, sealSnapshot,
  sha256, sourceIdentity, sumDecimals, targetIdentity, validateSnapshot,
} from "../lib/backfill";
import type { Checkpoint, Row, Snapshot, Tables } from "../lib/backfill";
import { exportSource, selectSourceSql, validateSourceColumns } from "../lib/backfill-source";
import { hashFile, readPrivateJson, verifyBackup, writePrivateJson } from "../lib/backfill-files";

const time = "2025-01-12T14:27:18.123Z";
const later = "2025-01-13T15:28:19.234Z";
const source = { host: "source.example.test", port: "5432", database: "tipout", schema: "public" };
function fixture(): Snapshot {
  return sealSnapshot({ version: 1, source, sourceFingerprint: sha256(canonical(source)), capturedAt: later, postgresSnapshot: "1:2:", tables: {
    roles: [{ id: "role-1", name: "Server", basePayRate: "15.250000000000000000000000000000", createdAt: time, updatedAt: later }],
    employees: [{ id: "employee-1", name: "PRIVATE PERSON", active: false, defaultRoleId: "role-1", createdAt: time, updatedAt: later }],
    roleConfigs: [{ id: "config-1", roleId: "role-1", tipoutType: "", percentageRate: "0.075000000000000000000000000000", effectiveFrom: time, effectiveTo: later, receivesTipout: true, paysTipout: false, distributionGroup: "", tipPoolGroup: "Pool-A", createdAt: time, updatedAt: later }],
    shifts: [{ id: "shift-1", employeeId: "employee-1", roleId: "role-1", date: time, hours: "7.75", cashTips: "0.10", creditTips: "-2.30", liquorSales: "110.00", createdAt: time, updatedAt: later }],
  } });
}
function targetFor(expected: Tables): Tables {
  const result = emptyTables();
  for (const table of TABLES) for (const row of expected[table]) {
    const doc: Row = { _id: `native-${row.legacyId}`, _creationTime: 123, ...row };
    for (const field of ["defaultRoleLegacyId", "roleLegacyId", "employeeLegacyId"]) {
      if (field in doc) { if (doc[field] !== null) doc[field.replace("LegacyId", "Id")] = `native-${doc[field]}`; delete doc[field]; }
    }
    for (const field of ["effectiveTo", "distributionGroup", "tipPoolGroup"]) if (doc[field] === null) delete doc[field];
    result[table].push(doc);
  }
  return result;
}
const columns = () => TABLES.flatMap(table => fieldsFor(table).map(column_name => ({
  table_name: SPECS[table].model,
  column_name,
  data_type: ([...SPECS[table].dates, ...SPECS[table].nullableDates] as string[]).includes(column_name) ? "timestamp without time zone"
    : (SPECS[table].decimals as string[]).includes(column_name) ? "numeric"
    : (SPECS[table].booleans as string[]).includes(column_name) ? "boolean" : "text",
  datetime_precision: 3,
})));

describe("backfill validation and reconciliation", () => {
  test("preserves all four entities, raw decimals, exact dates, FK identity, inactive flags, empty types and groups", () => {
    const snapshot = fixture();
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
    const rows = normalizeSource(snapshot.tables);
    expect(rows.roles[0].basePayRate).toBe(15.25);
    expect(snapshot.tables.roles[0].basePayRate).toBe("15.250000000000000000000000000000");
    expect(rows.shifts[0].date).toBe(Date.parse(time));
    expect(rows.employees[0]).toMatchObject({ active: false, defaultRoleLegacyId: "role-1", createdAt: Date.parse(time), updatedAt: Date.parse(later) });
    expect(rows.roleConfigs[0]).toMatchObject({ tipoutType: "", distributionGroup: "", tipPoolGroup: "Pool-A", receivesTipout: true, paysTipout: false, effectiveTo: Date.parse(later) });
    expect(normalizeTarget(targetFor(rows))).toEqual(rows);
    expect(reconcile(rows, normalizeTarget(targetFor(rows)))).toMatchObject({ complete: true, insert: 0, conflicts: 0, extras: 0, aggregatesMatch: true });
  });
  test.each(["BAR", " bar", "bar ", "invalid", "SA"])("does not normalize role type %p", type => {
    const snapshot = fixture(); snapshot.tables.roleConfigs[0].tipoutType = type;
    expect(() => normalizeSource(snapshot.tables)).toThrow(/never trimmed/);
  });
  test("allows all exact legacy types and nullable fields", () => {
    for (const type of ["", "bar", "host", "sa"]) {
      const snapshot = fixture(); snapshot.tables.roleConfigs[0].tipoutType = type;
      snapshot.tables.roleConfigs[0].effectiveTo = null;
      snapshot.tables.roleConfigs[0].distributionGroup = null;
      snapshot.tables.roleConfigs[0].tipPoolGroup = null;
      snapshot.tables.employees[0].defaultRoleId = null;
      const rows = normalizeSource(snapshot.tables);
      expect(normalizeTarget(targetFor(rows))).toEqual(rows);
    }
  });
  test("rejects corrupt archives, source fingerprints, extra columns, missing fields, duplicate IDs and missing relationships", () => {
    const bad = fixture(); bad.tables.roles[0].name = "changed";
    expect(() => validateSnapshot(bad)).toThrow(/checksum/);
    const drift = fixture(); drift.tables.shifts[0].oldTipout = "8.5";
    expect(() => normalizeSource(drift.tables)).toThrow(/fields/);
    const missing = fixture(); delete missing.tables.roles[0].name;
    expect(() => normalizeSource(missing.tables)).toThrow(/fields/);
    const dup = fixture(); dup.tables.roles.push({ ...dup.tables.roles[0] });
    expect(() => normalizeSource(dup.tables)).toThrow(/duplicate/);
    const fk = fixture(); fk.tables.shifts[0].employeeId = "missing";
    expect(() => normalizeSource(fk.tables)).toThrow(/missing employee/);
    const foreign = fixture(); foreign.tables.employees[0].defaultRoleId = "";
    expect(() => normalizeSource(foreign.tables)).toThrow(/missing source role/);
    const reversed = fixture(); reversed.tables.roles[0].updatedAt = "2024-01-01T00:00:00.000Z";
    expect(() => normalizeSource(reversed.tables)).toThrow(/Reversed/);
  });
  test("detects exact conflicts despite equal counts/aggregates, extras/deletions, native rows, duplicate legacy IDs and broken FKs", () => {
    const expected = normalizeSource(fixture().tables);
    const changed = targetFor(expected); changed.employees[0].name = "renamed";
    const conflict = reconcile(expected, normalizeTarget(changed));
    expect(conflict.conflicts).toBe(1); expect(conflict.aggregatesMatch).toBe(true); expect(conflict.complete).toBe(false);
    const shifted = targetFor(expected); shifted.shifts[0].legacyId = "another-shift";
    expect(reconcile(expected, normalizeTarget(shifted))).toMatchObject({ insert: 1, extras: 1, complete: false });
    const newer = targetFor(expected); newer.shifts[0].updatedAt = Date.parse(later) + 1;
    expect(reconcile(expected, normalizeTarget(newer)).conflicts).toBe(1);
    const native = targetFor(expected); delete native.roles[0].legacyId;
    expect(() => normalizeTarget(native)).toThrow(/Unmapped/);
    const dup = targetFor(expected); dup.shifts.push({ ...dup.shifts[0] });
    expect(() => normalizeTarget(dup)).toThrow(/Duplicate/);
    const nativeDup = targetFor(expected); nativeDup.shifts.push({ ...nativeDup.shifts[0], legacyId: "different-legacy" });
    expect(() => normalizeTarget(nativeDup)).toThrow(/native identity/);
    const broken = targetFor(expected); broken.shifts[0].roleId = "wrong-native-role";
    expect(() => normalizeTarget(broken)).toThrow(/relationship/);
  });
  test("enforces RoleConfig compound uniqueness and valid effective ranges", () => {
    const dup = fixture(); dup.tables.roleConfigs.push({ ...dup.tables.roleConfigs[0], id: "config-2" });
    expect(() => normalizeSource(dup.tables)).toThrow(/compound/);
    const bad = fixture(); bad.tables.roleConfigs[0].effectiveTo = "2020-01-01T00:00:00.000Z";
    expect(() => normalizeSource(bad.tables)).toThrow(/effective-date/);
  });
  test("no lossy numeric coercion, NaN, infinities, null-defaulting, or underflow", () => {
    for (const value of ["9007199254740993", "0.123456789012345678901", "1e-400", "NaN", "Infinity", null, ""]) expect(() => decimalToNumber(value)).toThrow();
    expect(decimalToNumber("0.100000000000000000000000000000")).toBe(0.1);
    expect(decimalToNumber("-0.000")).toBe(0);
    expect(decimalToNumber("1e20")).toBe(1e20);
    expect(sumDecimals(["0.1", "0.2", "-0.05"])).toBe("0.25");
    expect(sumDecimals(["999999999999999999999999.999999", "0.000001"])).toBe("1000000000000000000000000");
  });
  test("rejects timestamp truncation, timezone/date-only interpretation and impossible dates", () => {
    for (const date of ["2025-01-01", "2025-01-01T00:00:00.1234Z", "2025-02-30T00:00:00.000Z", "2025-01-01T00:00:00.000+01:00", null]) expect(() => dateToMs(date)).toThrow();
  });
  test("identity hashes exclude secrets and identities reject dangerous target forms", () => {
    expect(sourceIdentity("postgresql://username:TOP_SECRET@Db.EXAMPLE:5432/tipout?schema=public&password=SECRET")).toEqual({ ...source, host: "db.example" });
    for (const url of ["http://deployment.convex.cloud", "https://user:pass@deployment.convex.cloud", "https://deployment.convex.cloud/path", "https://deployment.convex.cloud?key=secret"]) expect(() => targetIdentity(url)).toThrow();
    expect(targetIdentity("https://deployment.convex.cloud/")).toBe("https://deployment.convex.cloud");
  });
  test("checkpoint refuses source/target drift, deleted observed rows and absent uncertain writes", () => {
    const snapshot = fixture(), actual = normalizeSource(snapshot.tables), url = "https://target.convex.cloud";
    const checkpoint: Checkpoint = { version: 1, snapshotChecksum: snapshot.checksum, targetUrl: url, confirmed: [rowKey("roles", actual.roles[0])], pending: null };
    expect(() => assertCheckpoint(checkpoint, snapshot, url, actual)).not.toThrow();
    expect(() => assertCheckpoint(checkpoint, snapshot, "https://other.convex.cloud", actual)).toThrow(/match/);
    expect(() => assertCheckpoint(checkpoint, snapshot, url, emptyTables())).toThrow(/deleted/);
    expect(() => assertCheckpoint({ ...checkpoint, confirmed: [], pending: checkpoint.confirmed[0] }, snapshot, url, emptyTables())).toThrow(/uncertain/);
    expect(() => assertCheckpoint({ ...checkpoint, confirmed: [], pending: checkpoint.confirmed[0] }, snapshot, url, actual)).not.toThrow();
  });
});

describe("read-only source export", () => {
  test("schema drift and sub-millisecond timestamps fail instead of dropping columns", () => {
    expect(() => validateSourceColumns(columns())).not.toThrow();
    expect(() => validateSourceColumns([...columns(), { table_name: "Shift", column_name: "barTipout", data_type: "numeric", datetime_precision: null }])).toThrow(/drift/);
    expect(() => validateSourceColumns([...columns(), { table_name: "RoleConfiguration", column_name: "id", data_type: "text", datetime_precision: null }])).toThrow(/Older/);
    expect(() => validateSourceColumns(columns().map(c => c.column_name === "date" ? { ...c, datetime_precision: 6 } : c))).toThrow(/precision/);
    expect(selectSourceSql("shifts", 'a"b')).toContain('FROM "a""b"."Shift"');
    expect(selectSourceSql("shifts", "public")).toContain('"cashTips"::text AS "cashTips"');
  });
  test("all four tables are exported inside one explicitly read-only repeatable-read transaction", async () => {
    const snapshot = fixture(), calls: string[] = [];
    const tx = {
      $executeRawUnsafe: jest.fn(async (sql: string) => { calls.push(sql); return 0; }),
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("current_database")) return [{ database: source.database, schema: source.schema, readOnly: "on", isolation: "repeatable read", capturedAt: later, postgresSnapshot: "1:2:" }];
        if (sql.includes("information_schema")) return columns();
        const table = TABLES.find(t => sql.includes(`"${SPECS[t].model}"`))!;
        if (sql.includes("count(*)")) return [{ count: String(snapshot.tables[table].length) }];
        return snapshot.tables[table];
      }),
    };
    const transaction = jest.fn(async (callback: (arg: typeof tx) => Promise<Snapshot>) => callback(tx));
    const result = await exportSource({ $transaction: transaction } as unknown as PrismaClient, source);
    expect(result).toEqual(snapshot);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 300000 });
    expect(calls[0]).toBe("SET TRANSACTION READ ONLY");
    expect(calls.some(sql => /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/.test(sql))).toBe(false);
  });
});

describe("protected files and backups", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "tipout-backfill-test-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  test("archives are exclusive, owner-only, checksummed and not written under checkout", async () => {
    const file = path.join(directory, "snapshot.json");
    await writePrivateJson(file, fixture());
    expect((await stat(file)).mode & 0o077).toBe(0);
    expect(validateSnapshot((await readPrivateJson(file)).data)).toEqual(fixture());
    await expect(writePrivateJson(file, {})).rejects.toThrow();
    await expect(writePrivateJson(path.join(process.cwd(), "test-private-artifact.json"), {})).rejects.toThrow(/outside/);
    await chmod(file, 0o644);
    await expect(readPrivateJson(file)).rejects.toThrow(/owner-only/);
  });
  test("backup gates require real nonempty files with exact independently supplied hashes", async () => {
    const file = path.join(directory, "backup.bin"); await writeFile(file, "test-only-backup");
    const digest = await hashFile(file);
    expect(await verifyBackup(file, digest)).toBe(digest);
    await expect(verifyBackup(file, "a".repeat(64))).rejects.toThrow(/mismatch/);
    await expect(verifyBackup(undefined, undefined)).rejects.toThrow(/requires/);
    await writeFile(file, ""); await expect(hashFile(file)).rejects.toThrow(/non-empty/);
  });
  test("checkpoint updates are atomic replacements of protected files", async () => {
    const file = path.join(directory, "checkpoint.json"); await writePrivateJson(file, { pending: "first" });
    await writePrivateJson(file, { pending: null }, true);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ pending: null });
  });
});
