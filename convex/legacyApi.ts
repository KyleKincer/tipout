/** Read-only helpers for authenticated, same-origin legacy REST adapters. */
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin, requireAuthenticated } from "./lib/acl";
import { resolveLegacyDoc } from "./lib/legacyIds";
import { serializeRoleConfig } from "./lib/serialize";
import { roleConfigValidator } from "./lib/validators";

const tableValidator = v.union(v.literal("employees"), v.literal("roles"), v.literal("shifts"), v.literal("roleConfigs"));

export const checkAccess = query({
  args: { admin: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { admin }) => {
    if (admin) await requireAdmin(ctx);
    else await requireAuthenticated(ctx);
    return null;
  },
});

export const resolveIds = query({
  args: { refs: v.array(v.object({ table: tableValidator, id: v.string() })) },
  returns: v.array(v.object({ table: tableValidator, input: v.string(), id: v.union(v.string(), v.null()), publicId: v.union(v.string(), v.null()) })),
  handler: async (ctx, { refs }) => {
    await requireAuthenticated(ctx);
    if (refs.length > 256) throw new ConvexError("Too many identity references");
    return Promise.all(refs.map(async ({ table, id }) => {
      const doc = await resolveLegacyDoc(ctx, table, id);
      return { table, input: id, id: doc?._id ?? null, publicId: doc ? (doc.legacyId ?? doc._id) : null };
    }));
  },
});

/** Legacy list/create include configs overlapping the requested DAY/RANGE,
 * whereas a single shift GET/PUT includes configs active at its exact instant. */
export const configsForRoles = query({
  args: { roleIds: v.array(v.id("roles")), start: v.number(), end: v.number() },
  returns: v.array(v.object({ roleId: v.id("roles"), configs: v.array(roleConfigValidator) })),
  handler: async (ctx, { roleIds, start, end }) => {
    await requireAuthenticated(ctx);
    if (roleIds.length > 256) throw new ConvexError("Too many role references");
    return Promise.all(roleIds.map(async (roleId) => {
      const configs = await ctx.db.query("roleConfigs").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect();
      return { roleId, configs: configs.filter((c) => c.effectiveTo == null || (c.effectiveFrom <= end && c.effectiveTo >= start)).map(serializeRoleConfig) };
    }));
  },
});
