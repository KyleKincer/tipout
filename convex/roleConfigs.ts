import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { serializeRoleConfig } from "./lib/serialize";
import { requireAdmin } from "./lib/acl";
import { roleConfigValidator } from "./lib/validators";

export const listForRole = query({
  args: { roleId: v.id("roles") },
  returns: v.array(roleConfigValidator),
  handler: async (ctx, { roleId }) => {
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
 * Replaces ALL configs for a role with the given array.
 * Mirrors the current PUT /api/roles/[id]/config behaviour: delete-then-create.
 * We enforce the (roleId, tipoutType, effectiveFrom) uniqueness in-app here.
 */
export const replaceForRole = mutation({
  args: {
    roleId: v.id("roles"),
    configs: v.array(
      v.object({
        tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
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

    const role = await ctx.db.get(roleId);
    if (!role) throw new ConvexError("Role not found");

    const seen = new Set<string>();
    for (const cfg of configs) {
      const key = `${cfg.tipoutType}|${cfg.effectiveFrom}`;
      if (seen.has(key)) {
        throw new ConvexError(
          `Duplicate config for ${cfg.tipoutType} @ ${cfg.effectiveFrom}`,
        );
      }
      seen.add(key);
    }

    const existing = await ctx.db
      .query("roleConfigs")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    for (const c of existing) await ctx.db.delete(c._id);

    const now = Date.now();
    const created = [];
    for (const cfg of configs) {
      const id = await ctx.db.insert("roleConfigs", {
        roleId,
        tipoutType: cfg.tipoutType,
        percentageRate: cfg.percentageRate,
        effectiveFrom: Date.parse(cfg.effectiveFrom),
        effectiveTo: cfg.effectiveTo ? Date.parse(cfg.effectiveTo) : undefined,
        receivesTipout: cfg.receivesTipout,
        paysTipout: cfg.paysTipout,
        distributionGroup: cfg.distributionGroup ?? undefined,
        tipPoolGroup: cfg.tipPoolGroup ?? undefined,
        createdAt: now,
        updatedAt: now,
      });
      const doc = (await ctx.db.get(id))!;
      created.push(serializeRoleConfig(doc));
    }
    return created;
  },
});
