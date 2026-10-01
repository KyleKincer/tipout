import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Administrative, insert-only backfill functions. The old upsert names remain,
// but differing rows are NEVER patched. Disable TIPOUT_ETL_ENABLED after use.
const migrationGate = v.object({
  sourceFingerprint: v.string(), snapshotChecksum: v.string(), targetUrl: v.string(),
});
type Gate = { sourceFingerprint: string; snapshotChecksum: string; targetUrl: string };
type Table = "roles" | "employees" | "roleConfigs" | "shifts";
function assertGate(gate: Gate) {
  if (process.env.TIPOUT_ETL_ENABLED !== "true" ||
      !/^[a-f0-9]{64}$/.test(gate.sourceFingerprint) ||
      !/^[a-f0-9]{64}$/.test(gate.snapshotChecksum) ||
      gate.sourceFingerprint !== process.env.TIPOUT_ETL_SOURCE_FINGERPRINT ||
      gate.snapshotChecksum !== process.env.TIPOUT_ETL_SNAPSHOT_SHA256 ||
      gate.targetUrl !== process.env.CONVEX_CLOUD_URL?.replace(/\/$/, "")) {
    throw new Error("Backfill disabled or source/snapshot/target gate mismatch");
  }
}
function assertValues(doc: Record<string, unknown>) {
  if (typeof doc.legacyId !== "string" || doc.legacyId.length === 0) throw new Error("Missing legacy identity");
  for (const [field, value] of Object.entries(doc)) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite backfill number");
    if (["date", "createdAt", "updatedAt", "effectiveFrom", "effectiveTo"].includes(field) && value !== undefined && value !== null &&
        (typeof value !== "number" || !Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()))) {
      throw new Error("Invalid backfill timestamp");
    }
  }
  if ((doc.updatedAt as number) < (doc.createdAt as number)) throw new Error("Reversed audit timestamps");
}
async function lookup(ctx: QueryCtx | MutationCtx, table: Table, legacyId: string) {
  const rows = await ctx.db.query(table).withIndex("by_legacy", q => q.eq("legacyId", legacyId)).take(2);
  if (rows.length > 1) throw new Error("Duplicate target legacy identity; stopped without overwriting");
  return rows[0] ?? null;
}
function assertIdentical(existing: Record<string, unknown>, wanted: Record<string, unknown>) {
  const keys = new Set([...Object.keys(existing), ...Object.keys(wanted)]);
  for (const key of keys) {
    if (key === "_id" || key === "_creationTime") continue;
    if (existing[key] !== wanted[key]) throw new Error("Target row conflicts with snapshot; stopped without overwriting");
  }
}
async function roleId(ctx: MutationCtx, legacyId: string): Promise<Id<"roles">> {
  const row = await lookup(ctx, "roles", legacyId);
  if (!row) throw new Error("Missing target role relationship");
  return row._id as Id<"roles">;
}

export const identity = internalQuery({
  args: {},
  handler: async () => ({
    protocolVersion: 1,
    deploymentUrl: process.env.CONVEX_CLOUD_URL ?? null,
    enabled: process.env.TIPOUT_ETL_ENABLED === "true",
    sourceFingerprint: process.env.TIPOUT_ETL_SOURCE_FINGERPRINT ?? null,
    snapshotChecksum: process.env.TIPOUT_ETL_SNAPSHOT_SHA256 ?? null,
  }),
});

// Every page is transactionally consistent; a series of pages is NOT one
// snapshot. The runner requires a maintenance freeze for apply, compares two
// full reads, checks each write, and reconciles afterwards. No global lock is
// claimed. Pages include native IDs for stable relationship/parity mapping.
export const auditPage = internalQuery({
  args: {
    table: v.union(v.literal("roles"), v.literal("employees"), v.literal("roleConfigs"), v.literal("shifts")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 500) throw new Error("Audit page size must be 1–500");
    return await ctx.db.query(args.table).paginate(args.paginationOpts);
  },
});

export const upsertRole = internalMutation({
  args: { migration: migrationGate, legacyId: v.string(), name: v.string(), basePayRate: v.number(), createdAt: v.number(), updatedAt: v.number() },
  returns: v.id("roles"),
  handler: async (ctx, { migration, ...doc }) => {
    assertGate(migration); assertValues(doc);
    const existing = await lookup(ctx, "roles", doc.legacyId);
    if (existing) { assertIdentical(existing, doc); return existing._id as Id<"roles">; }
    return await ctx.db.insert("roles", doc);
  },
});

export const upsertEmployee = internalMutation({
  args: { migration: migrationGate, legacyId: v.string(), name: v.string(), active: v.boolean(), defaultRoleLegacyId: v.union(v.string(), v.null()), createdAt: v.number(), updatedAt: v.number() },
  returns: v.id("employees"),
  handler: async (ctx, { migration, defaultRoleLegacyId, ...fields }) => {
    assertGate(migration); assertValues(fields);
    const doc = { ...fields, defaultRoleId: defaultRoleLegacyId === null ? undefined : await roleId(ctx, defaultRoleLegacyId) };
    const existing = await lookup(ctx, "employees", doc.legacyId);
    if (existing) { assertIdentical(existing, doc); return existing._id as Id<"employees">; }
    return await ctx.db.insert("employees", doc);
  },
});

export const upsertRoleConfig = internalMutation({
  args: {
    migration: migrationGate, legacyId: v.string(), roleLegacyId: v.string(),
    tipoutType: v.union(v.literal(""), v.literal("bar"), v.literal("host"), v.literal("sa")),
    percentageRate: v.number(), effectiveFrom: v.number(), effectiveTo: v.union(v.number(), v.null()),
    receivesTipout: v.boolean(), paysTipout: v.boolean(), distributionGroup: v.union(v.string(), v.null()), tipPoolGroup: v.union(v.string(), v.null()), createdAt: v.number(), updatedAt: v.number(),
  },
  returns: v.id("roleConfigs"),
  handler: async (ctx, { migration, roleLegacyId, effectiveTo, distributionGroup, tipPoolGroup, ...fields }) => {
    assertGate(migration); assertValues({ ...fields, effectiveTo });
    if (effectiveTo !== null && effectiveTo < fields.effectiveFrom) throw new Error("Reversed effective interval");
    const doc: Omit<Doc<"roleConfigs">, "_id" | "_creationTime"> = {
      ...fields, roleId: await roleId(ctx, roleLegacyId), effectiveTo: effectiveTo ?? undefined,
      distributionGroup: distributionGroup ?? undefined, tipPoolGroup: tipPoolGroup ?? undefined,
    };
    const collisions = await ctx.db.query("roleConfigs")
      .withIndex("by_role_type", q => q.eq("roleId", doc.roleId).eq("tipoutType", doc.tipoutType))
      .filter(q => q.eq(q.field("effectiveFrom"), doc.effectiveFrom)).take(2);
    if (collisions.some(row => row.legacyId !== doc.legacyId) || collisions.length > 1) throw new Error("Target RoleConfig compound identity collision");
    const existing = await lookup(ctx, "roleConfigs", doc.legacyId!);
    if (existing) { assertIdentical(existing, doc); return existing._id as Id<"roleConfigs">; }
    return await ctx.db.insert("roleConfigs", doc);
  },
});

export const upsertShift = internalMutation({
  args: {
    migration: migrationGate, legacyId: v.string(), employeeLegacyId: v.string(), roleLegacyId: v.string(), date: v.number(),
    hours: v.number(), cashTips: v.number(), creditTips: v.number(), liquorSales: v.number(), createdAt: v.number(), updatedAt: v.number(),
  },
  returns: v.id("shifts"),
  handler: async (ctx, { migration, employeeLegacyId, roleLegacyId, ...fields }) => {
    assertGate(migration); assertValues(fields);
    const employee = await lookup(ctx, "employees", employeeLegacyId);
    if (!employee) throw new Error("Missing target employee relationship");
    const doc = { ...fields, employeeId: employee._id as Id<"employees">, roleId: await roleId(ctx, roleLegacyId) };
    const existing = await lookup(ctx, "shifts", doc.legacyId);
    if (existing) { assertIdentical(existing, doc); return existing._id as Id<"shifts">; }
    return await ctx.db.insert("shifts", doc);
  },
});
