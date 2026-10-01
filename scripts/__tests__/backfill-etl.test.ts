jest.mock("../../convex/_generated/server", () => ({
  internalMutation: (definition: unknown) => definition,
  internalQuery: (definition: unknown) => definition,
}));
import * as etl from "../../convex/etl";
import type { Row, Table } from "../lib/backfill";

const gate = { sourceFingerprint: "a".repeat(64), snapshotChecksum: "b".repeat(64), targetUrl: "https://target.convex.cloud" };
const createdAt = 1736692038123, updatedAt = createdAt + 5000;
const role = { migration: gate, legacyId: "r", name: "Server", basePayRate: 15.25, createdAt, updatedAt };
const employee = { migration: gate, legacyId: "e", name: "PRIVATE PERSON", active: false, defaultRoleLegacyId: "r", createdAt, updatedAt };
const config = { migration: gate, legacyId: "c", roleLegacyId: "r", tipoutType: "", percentageRate: 0.075, effectiveFrom: createdAt, effectiveTo: null, receivesTipout: true, paysTipout: false, distributionGroup: "", tipPoolGroup: "pool", createdAt, updatedAt };
const shift = { migration: gate, legacyId: "s", employeeLegacyId: "e", roleLegacyId: "r", date: createdAt, hours: 7.75, cashTips: 0.1, creditTips: 200, liquorSales: 1000, createdAt, updatedAt };

function fakeContext() {
  const rows: Record<Table, Row[]> = { roles: [], employees: [], roleConfigs: [], shifts: [] };
  const insert = jest.fn(async (table: Table, doc: Row) => {
    const id = `${table}:${rows[table].length}`;
    rows[table].push({ ...Object.fromEntries(Object.entries(doc).filter(([,v]) => v !== undefined)), _id: id, _creationTime: 1 });
    return id;
  });
  const patch = jest.fn(() => { throw new Error("FORBIDDEN patch"); });
  const remove = jest.fn(() => { throw new Error("FORBIDDEN delete"); });
  return { rows, db: { insert, patch, delete: remove, query(table: Table) {
    const predicates: Array<(row: Row) => boolean> = [];
    const index = { eq(field: string, value: unknown) { predicates.push(row => row[field] === value); return index; } };
    const query = {
      withIndex(_name: string, callback: (i: typeof index) => unknown) { callback(index); return query; },
      filter(callback: (q: { field(field: string): string; eq(field: string, value: unknown): (row: Row) => boolean }) => (row: Row) => boolean) {
        predicates.push(callback({ field: field => field, eq: (field, value) => row => row[field] === value })); return query;
      },
      async take(count: number) { return rows[table].filter(row => predicates.every(predicate => predicate(row))).slice(0, count); },
    };
    return query;
  } } };
}
const invoke = (fn: unknown, ctx: unknown, args: unknown): Promise<unknown> =>
  (fn as { handler(ctx: unknown, args: unknown): Promise<unknown> }).handler(ctx, args);

let env: NodeJS.ProcessEnv;
beforeEach(() => {
  env = { ...process.env };
  Object.assign(process.env, { TIPOUT_ETL_ENABLED: "true", TIPOUT_ETL_SOURCE_FINGERPRINT: gate.sourceFingerprint, TIPOUT_ETL_SNAPSHOT_SHA256: gate.snapshotChecksum, CONVEX_CLOUD_URL: gate.targetUrl });
});
afterEach(() => { process.env = env; });

test("four entities insert once, exact reruns skip, preserve raw timestamps/FKs/pool-only configuration", async () => {
  const ctx = fakeContext();
  for (let pass = 0; pass < 2; pass++) {
    await invoke(etl.upsertRole, ctx, role); await invoke(etl.upsertEmployee, ctx, employee);
    await invoke(etl.upsertRoleConfig, ctx, config); await invoke(etl.upsertShift, ctx, shift);
  }
  expect(ctx.db.insert).toHaveBeenCalledTimes(4);
  expect(ctx.rows.employees[0]).toMatchObject({ defaultRoleId: "roles:0", active: false, createdAt, updatedAt });
  expect(ctx.rows.roleConfigs[0]).toMatchObject({ tipoutType: "", distributionGroup: "", tipPoolGroup: "pool", receivesTipout: true, paysTipout: false });
  expect(ctx.rows.shifts[0]).toMatchObject({ employeeId: "employees:0", roleId: "roles:0", date: createdAt, createdAt, updatedAt });
  expect(ctx.db.patch).not.toHaveBeenCalled(); expect(ctx.db.delete).not.toHaveBeenCalled();
});

test.each(["disabled", "target", "source", "snapshot"])("server-side %s gate refuses every write", async scenario => {
  const ctx = fakeContext();
  if (scenario === "disabled") delete process.env.TIPOUT_ETL_ENABLED;
  if (scenario === "target") process.env.CONVEX_CLOUD_URL = "https://other.convex.cloud";
  if (scenario === "source") process.env.TIPOUT_ETL_SOURCE_FINGERPRINT = "c".repeat(64);
  if (scenario === "snapshot") process.env.TIPOUT_ETL_SNAPSHOT_SHA256 = "d".repeat(64);
  for (const [fn, data] of [[etl.upsertRole, role], [etl.upsertEmployee, employee], [etl.upsertRoleConfig, config], [etl.upsertShift, shift]]) {
    await expect(invoke(fn, ctx, data)).rejects.toThrow(/gate/);
  }
  expect(ctx.db.insert).not.toHaveBeenCalled(); expect(ctx.db.patch).not.toHaveBeenCalled(); expect(ctx.db.delete).not.toHaveBeenCalled();
});

test("every changed row, including createdAt or newer target updatedAt, stops without overwriting", async () => {
  const ctx = fakeContext();
  const rows = [[etl.upsertRole, role], [etl.upsertEmployee, employee], [etl.upsertRoleConfig, config], [etl.upsertShift, shift]] as const;
  for (const [fn, data] of rows) await invoke(fn, ctx, data);
  for (const [fn, data] of rows) {
    await expect(invoke(fn, ctx, { ...data, updatedAt: updatedAt - 1 })).rejects.toThrow(/conflicts/);
    await expect(invoke(fn, ctx, { ...data, createdAt: createdAt - 1 })).rejects.toThrow(/conflicts/);
  }
  await expect(invoke(etl.upsertEmployee, ctx, { ...employee, name: "Different" })).rejects.toThrow(/conflicts/);
  await expect(invoke(etl.upsertRoleConfig, ctx, { ...config, tipPoolGroup: null })).rejects.toThrow(/conflicts/);
  expect(ctx.db.insert).toHaveBeenCalledTimes(4); expect(ctx.db.patch).not.toHaveBeenCalled(); expect(ctx.db.delete).not.toHaveBeenCalled();
});

test("missing relationships, duplicate legacy IDs and config compound collisions fail closed", async () => {
  const ctx = fakeContext();
  await expect(invoke(etl.upsertEmployee, ctx, employee)).rejects.toThrow(/Missing target role/);
  await expect(invoke(etl.upsertShift, ctx, shift)).rejects.toThrow(/Missing target employee/);
  await invoke(etl.upsertRole, ctx, role); await invoke(etl.upsertRoleConfig, ctx, config);
  await expect(invoke(etl.upsertRoleConfig, ctx, { ...config, legacyId: "different" })).rejects.toThrow(/compound/);
  ctx.rows.roles.push({ ...ctx.rows.roles[0], _id: "roles:duplicate" });
  await expect(invoke(etl.upsertRole, ctx, role)).rejects.toThrow(/Duplicate/);
  await expect(invoke(etl.upsertEmployee, ctx, employee)).rejects.toThrow(/Duplicate/);
  expect(ctx.db.patch).not.toHaveBeenCalled(); expect(ctx.db.delete).not.toHaveBeenCalled();
});

test("invalid timestamps/non-finite numeric values do not reach storage", async () => {
  const ctx = fakeContext();
  await expect(invoke(etl.upsertRole, ctx, { ...role, basePayRate: Infinity })).rejects.toThrow(/Non-finite/);
  await expect(invoke(etl.upsertRole, ctx, { ...role, createdAt: 1.5 })).rejects.toThrow(/timestamp/);
  await expect(invoke(etl.upsertRole, ctx, { ...role, updatedAt: createdAt - 1 })).rejects.toThrow(/Reversed/);
  expect(ctx.db.insert).not.toHaveBeenCalled();
});
