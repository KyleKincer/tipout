import { v, ConvexError, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { serializeRoleConfig, serializeRoleWithConfigs } from "./lib/serialize";
import { requireAdmin, requireAuthenticated } from "./lib/acl";
import { roleConfigValidator, roleWithConfigsValidator } from "./lib/validators";
import type { Doc, Id } from "./_generated/dataModel";

export const listForRole = query({
  args: { roleId: v.id("roles") },
  returns: v.array(roleConfigValidator),
  handler: async (ctx, { roleId }) => {
    await requireAuthenticated(ctx);
    const configs = await ctx.db
      .query("roleConfigs")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    return configs.map(serializeRoleConfig);
  },
});

export const listCurrentForRole = query({
  args: { roleId: v.id("roles") },
  returns: v.array(roleConfigValidator),
  handler: async (ctx, { roleId }) => {
    await requireAuthenticated(ctx);
    const configs = await ctx.db
      .query("roleConfigs")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    const current = configs
      .filter((c) => c.effectiveTo == null)
      .sort((a, b) => b.effectiveFrom - a.effectiveFrom);
    return current.map(serializeRoleConfig);
  },
});

const configDraftValidator = v.object({
  id: v.optional(v.id("roleConfigs")),
  tipoutType: v.union(v.literal(""), v.literal("bar"), v.literal("host"), v.literal("sa")),
  percentageRate: v.number(),
  effectiveFrom: v.string(),
  effectiveTo: v.union(v.string(), v.null()),
  receivesTipout: v.boolean(),
  paysTipout: v.boolean(),
  distributionGroup: v.optional(v.union(v.string(), v.null())),
  tipPoolGroup: v.optional(v.union(v.string(), v.null())),
});

// Complete snapshot, captured at form hydration, not from later live-query updates.
const snapshotValidator = v.object({
  roleUpdatedAt: v.number(),
  configs: v.array(v.object({ id: v.id("roleConfigs"), updatedAt: v.number() })),
});
type Snapshot = Infer<typeof snapshotValidator>;
type ConfigDraft = Infer<typeof configDraftValidator>;
const conflictMessage = "This role changed while you were editing. Reload the page to review the latest changes before saving.";

function assertSnapshot(role: Doc<"roles">, existing: Doc<"roleConfigs">[], expected: Snapshot | null) {
  if (!expected || expected.roleUpdatedAt !== role.updatedAt || expected.configs.length !== existing.length) {
    throw new ConvexError(conflictMessage);
  }
  const versions = new Map(expected.configs.map((row) => [row.id, row.updatedAt]));
  if (versions.size !== expected.configs.length || existing.some((row) => versions.get(row._id) !== row.updatedAt)) {
    throw new ConvexError(conflictMessage);
  }
}

// Validate every draft before any write, including new-role creation.
function prepareConfigs(existing: Doc<"roleConfigs">[], configs: ConfigDraft[]) {
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  const desired = configs.map((cfg) => {
    const effectiveFrom = Date.parse(cfg.effectiveFrom);
    const effectiveTo = cfg.effectiveTo === null ? undefined : Date.parse(cfg.effectiveTo);
    if (!Number.isFinite(effectiveFrom) || (effectiveTo !== undefined && !Number.isFinite(effectiveTo))) {
      throw new ConvexError("Invalid configuration date");
    }
    const key = `${cfg.tipoutType}|${effectiveFrom}`;
    if (seenKeys.has(key)) throw new ConvexError(`Duplicate configuration for ${cfg.tipoutType}`);
    seenKeys.add(key);
    const previous = cfg.id
      ? existing.find((c) => c._id === cfg.id)
      : existing.find((c) => c.tipoutType === cfg.tipoutType && c.effectiveFrom === effectiveFrom);
    if (cfg.id && !previous) throw new ConvexError("Configuration does not belong to this role");
    if (previous) {
      if (seenIds.has(previous._id)) throw new ConvexError("Duplicate configuration ID");
      seenIds.add(previous._id);
    }
    return {
      previous,
      values: {
        tipoutType: cfg.tipoutType,
        percentageRate: cfg.percentageRate,
        effectiveFrom,
        effectiveTo,
        receivesTipout: cfg.receivesTipout,
        paysTipout: cfg.paysTipout,
        distributionGroup: cfg.distributionGroup ?? undefined,
        tipPoolGroup: cfg.tipPoolGroup ?? undefined,
      },
    };
  });
  for (const row of existing) {
    if (row.effectiveTo != null && !seenIds.has(row._id) && seenKeys.has(`${row.tipoutType}|${row.effectiveFrom}`)) {
      throw new ConvexError("Configuration conflicts with retained history");
    }
  }
  return { desired, seenIds };
}

async function applyConfigs(
  ctx: MutationCtx,
  roleId: Id<"roles">,
  existing: Doc<"roleConfigs">[],
  prepared: ReturnType<typeof prepareConfigs>,
) {
  const now = Date.now();
  for (const { previous, values } of prepared.desired) {
    if (previous) {
      const changed = Object.entries(values).some(([key, value]) => previous[key as keyof typeof previous] !== value);
      if (changed) await ctx.db.patch(previous._id, { ...values, updatedAt: Math.max(now, previous.updatedAt + 1) });
    } else {
      await ctx.db.insert("roleConfigs", { roleId, ...values, createdAt: now, updatedAt: now });
    }
  }
  for (const row of existing) {
    if (!prepared.seenIds.has(row._id) && row.effectiveTo == null) await ctx.db.delete(row._id);
  }
  return ctx.db.query("roleConfigs").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect();
}

/** Guarded config-only reconciliation. There is no unversioned replacement API. */
export const replaceForRole = mutation({
  args: {
    roleId: v.id("roles"),
    configs: v.array(configDraftValidator),
    expected: snapshotValidator,
  },
  returns: v.array(roleConfigValidator),
  handler: async (ctx, { roleId, configs, expected }) => {
    await requireAdmin(ctx);
    const role = await ctx.db.get(roleId);
    if (!role) throw new ConvexError("Role not found");
    const existing = await ctx.db.query("roleConfigs").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect();
    assertSnapshot(role, existing, expected);
    const prepared = prepareConfigs(existing, configs);
    return (await applyConfigs(ctx, roleId, existing, prepared)).map(serializeRoleConfig);
  },
});

/** One Convex transaction for advanced role fields and the complete config set. */
export const saveRoleWithConfigs = mutation({
  args: {
    roleId: v.optional(v.id("roles")),
    name: v.string(),
    basePayRate: v.number(),
    configs: v.array(configDraftValidator),
    expected: v.union(snapshotValidator, v.null()),
  },
  returns: roleWithConfigsValidator,
  handler: async (ctx, { roleId, name, basePayRate, configs, expected }) => {
    await requireAdmin(ctx);
    if (!name.trim()) throw new ConvexError("Name is required");
    const role = roleId ? await ctx.db.get(roleId) : null;
    if (roleId && !role) throw new ConvexError("Role not found");
    const existing = roleId
      ? await ctx.db.query("roleConfigs").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect()
      : [];
    if (role) assertSnapshot(role, existing, expected);
    else if (expected !== null) throw new ConvexError(conflictMessage);
    const prepared = prepareConfigs(existing, configs);
    // All concurrency and payload checks above are read-only. These writes commit
    // together or roll back together in the single Convex mutation transaction.
    const now = Date.now();
    const savedRoleId = roleId ?? await ctx.db.insert("roles", { name, basePayRate, createdAt: now, updatedAt: now });
    const savedConfigs = await applyConfigs(ctx, savedRoleId, existing, prepared);
    if (role && (role.name !== name || role.basePayRate !== basePayRate)) {
      await ctx.db.patch(role._id, { name, basePayRate, updatedAt: Math.max(now, role.updatedAt + 1) });
    }
    return serializeRoleWithConfigs((await ctx.db.get(savedRoleId))!, savedConfigs);
  },
});

/** Match legacy POST /roles/:id/configurations: close old rates, start a new one. */
export const setCurrent = mutation({
  args: {
    roleId: v.id("roles"),
    tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
    percentageRate: v.number(),
    receivesTipout: v.optional(v.boolean()),
    paysTipout: v.optional(v.boolean()),
    distributionGroup: v.optional(v.union(v.string(), v.null())),
  },
  returns: roleConfigValidator,
  handler: async (ctx, { roleId, tipoutType, percentageRate, receivesTipout, paysTipout, distributionGroup }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(roleId))) throw new ConvexError("Role not found");
    const existing = await ctx.db.query("roleConfigs")
      .withIndex("by_role_type", (q) => q.eq("roleId", roleId).eq("tipoutType", tipoutType)).collect();
    const now = Date.now();
    // An exact-time duplicate would violate the legacy unique constraint.
    if (existing.some((c) => c.effectiveFrom === now)) throw new ConvexError("Configuration just changed; please retry");
    for (const row of existing) {
      if (row.effectiveTo == null) await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: Math.max(now, row.updatedAt + 1) });
    }
    const id = await ctx.db.insert("roleConfigs", {
      roleId, tipoutType, percentageRate, effectiveFrom: now,
      receivesTipout: receivesTipout ?? false, paysTipout: paysTipout ?? true,
      distributionGroup: distributionGroup ?? undefined, createdAt: now, updatedAt: now,
    });
    return serializeRoleConfig((await ctx.db.get(id))!);
  },
});

/** Match legacy DELETE /roles/:id/configurations: expire, never erase past rates. */
export const endCurrent = mutation({
  args: {
    roleId: v.id("roles"),
    tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { roleId, tipoutType }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(roleId))) throw new ConvexError("Role not found");
    const existing = await ctx.db.query("roleConfigs")
      .withIndex("by_role_type", (q) => q.eq("roleId", roleId).eq("tipoutType", tipoutType)).collect();
    const now = Date.now();
    for (const row of existing) {
      if (row.effectiveTo == null) await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: Math.max(now, row.updatedAt + 1) });
    }
    return { success: true };
  },
});
