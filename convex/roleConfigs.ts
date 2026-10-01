import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { serializeRoleConfig } from "./lib/serialize";
import { requireAdmin, requireAuthenticated } from "./lib/acl";
import { roleConfigValidator } from "./lib/validators";

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

/**
 * Reconcile the advanced editor's complete configuration set atomically.
 * Preserve IDs, legacy IDs and timestamps for unchanged rows. Closed history is
 * retained even when an older client submits only the active configurations.
 */
export const replaceForRole = mutation({
  args: {
    roleId: v.id("roles"),
    configs: v.array(
      v.object({
        id: v.optional(v.id("roleConfigs")),
        tipoutType: v.union(v.literal(""), v.literal("bar"), v.literal("host"), v.literal("sa")),
        percentageRate: v.number(),
        effectiveFrom: v.string(),
        effectiveTo: v.union(v.string(), v.null()),
        receivesTipout: v.boolean(),
        paysTipout: v.boolean(),
        distributionGroup: v.optional(v.union(v.string(), v.null())),
        tipPoolGroup: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  returns: v.array(roleConfigValidator),
  handler: async (ctx, { roleId, configs }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(roleId))) throw new ConvexError("Role not found");
    const existing = await ctx.db
      .query("roleConfigs")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();
    // Validate the entire request before any write. Dates are compared as instants,
    // matching the old PostgreSQL uniqueness constraint, not as input strings.
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
          roleId,
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
    const now = Date.now();
    for (const { previous, values } of desired) {
      if (previous) {
        const changed = Object.entries(values).some(([key, value]) => previous[key as keyof typeof previous] !== value);
        if (changed) await ctx.db.patch(previous._id, { ...values, updatedAt: now });
      } else {
        await ctx.db.insert("roleConfigs", { ...values, createdAt: now, updatedAt: now });
      }
    }
    for (const row of existing) {
      if (!seenIds.has(row._id) && row.effectiveTo == null) await ctx.db.delete(row._id);
    }
    const result = await ctx.db.query("roleConfigs").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect();
    return result.map(serializeRoleConfig);
  },
});

/** Match legacy POST /roles/:id/configurations: close old rates, start a new one. */
export const setCurrent = mutation({
  args: {
    roleId: v.id("roles"),
    tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
    percentageRate: v.number(),
  },
  returns: roleConfigValidator,
  handler: async (ctx, { roleId, tipoutType, percentageRate }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(roleId))) throw new ConvexError("Role not found");
    const existing = await ctx.db.query("roleConfigs")
      .withIndex("by_role_type", (q) => q.eq("roleId", roleId).eq("tipoutType", tipoutType)).collect();
    const now = Date.now();
    // An exact-time duplicate would violate the legacy unique constraint.
    if (existing.some((c) => c.effectiveFrom === now)) throw new ConvexError("Configuration just changed; please retry");
    for (const row of existing) {
      if (row.effectiveTo == null) await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: now });
    }
    const id = await ctx.db.insert("roleConfigs", {
      roleId, tipoutType, percentageRate, effectiveFrom: now,
      receivesTipout: false, paysTipout: true, createdAt: now, updatedAt: now,
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
      if (row.effectiveTo == null) await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: now });
    }
    return { success: true };
  },
});
