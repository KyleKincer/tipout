import { v, ConvexError } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { serializeRoleBare, serializeRoleConfig, serializeRoleWithConfigs } from "./lib/serialize";
import { requireAdmin } from "./lib/acl";
import { roleWithConfigsValidator } from "./lib/validators";
import type { Doc, Id } from "./_generated/dataModel";

async function getActiveConfigs(
  ctx: QueryCtx,
  roleId: Id<"roles">,
): Promise<Doc<"roleConfigs">[]> {
  const configs = await ctx.db
    .query("roleConfigs")
    .withIndex("by_role", (q) => q.eq("roleId", roleId))
    .collect();
  return configs.filter((c) => c.effectiveTo == null);
}

export const list = query({
  args: {},
  returns: v.array(roleWithConfigsValidator),
  handler: async (ctx) => {
    const roles = await ctx.db.query("roles").collect();
    roles.sort((a, b) => a.name.localeCompare(b.name));
    const results = [];
    for (const role of roles) {
      const configs = await getActiveConfigs(ctx, role._id);
      results.push({
        ...serializeRoleBare(role),
        configs: configs.map(serializeRoleConfig),
      });
    }
    return results;
  },
});

export const get = query({
  args: { id: v.id("roles") },
  returns: v.union(roleWithConfigsValidator, v.null()),
  handler: async (ctx, { id }) => {
    const role = await ctx.db.get(id);
    if (!role) return null;
    const configs = await getActiveConfigs(ctx, id);
    return serializeRoleWithConfigs(role, configs);
  },
});

export const create = mutation({
  args: { name: v.string(), basePayRate: v.number() },
  returns: roleWithConfigsValidator,
  handler: async (ctx, { name, basePayRate }) => {
    await requireAdmin(ctx);
    if (!name.trim()) throw new ConvexError("Name is required");
    const now = Date.now();
    const id = await ctx.db.insert("roles", {
      name,
      basePayRate,
      createdAt: now,
      updatedAt: now,
    });
    const doc = (await ctx.db.get(id))!;
    return serializeRoleWithConfigs(doc, []);
  },
});

export const update = mutation({
  args: {
    id: v.id("roles"),
    name: v.optional(v.string()),
    basePayRate: v.optional(v.number()),
  },
  returns: roleWithConfigsValidator,
  handler: async (ctx, { id, name, basePayRate }) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.get(id);
    if (!existing) throw new ConvexError("Role not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) patch.name = name;
    if (basePayRate !== undefined) patch.basePayRate = basePayRate;
    await ctx.db.patch(id, patch);
    const updated = (await ctx.db.get(id))!;
    const configs = await getActiveConfigs(ctx, id);
    return serializeRoleWithConfigs(updated, configs);
  },
});

export const remove = mutation({
  args: { id: v.id("roles") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const referencingShift = await ctx.db
      .query("shifts")
      .withIndex("by_role", (q) => q.eq("roleId", id))
      .first();
    if (referencingShift) {
      throw new ConvexError(
        "Cannot delete role with shifts — remove shifts first",
      );
    }
    const configs = await ctx.db
      .query("roleConfigs")
      .withIndex("by_role", (q) => q.eq("roleId", id))
      .collect();
    for (const c of configs) await ctx.db.delete(c._id);
    await ctx.db.delete(id);
    return { success: true };
  },
});
