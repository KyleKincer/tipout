import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// ETL helpers — resumable Postgres → Convex upserts keyed by `legacyId`.
// The public mutations (roles.create, employees.create, …) enforce admin
// auth; ETL runs with a service token from a script, so we use internal*
// functions that bypass client-exposed auth and can be driven by the
// deploy key from a Node script.

export const lookupRoleByLegacy = internalQuery({
  args: { legacyId: v.string() },
  returns: v.union(v.id("roles"), v.null()),
  handler: async (ctx, { legacyId }) => {
    const row = await ctx.db
      .query("roles")
      .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
      .first();
    return row ? row._id : null;
  },
});

export const lookupEmployeeByLegacy = internalQuery({
  args: { legacyId: v.string() },
  returns: v.union(v.id("employees"), v.null()),
  handler: async (ctx, { legacyId }) => {
    const row = await ctx.db
      .query("employees")
      .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
      .first();
    return row ? row._id : null;
  },
});

export const lookupShiftByLegacy = internalQuery({
  args: { legacyId: v.string() },
  returns: v.union(v.id("shifts"), v.null()),
  handler: async (ctx, { legacyId }) => {
    const row = await ctx.db
      .query("shifts")
      .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
      .first();
    return row ? row._id : null;
  },
});

export const lookupRoleConfigByLegacy = internalQuery({
  args: { legacyId: v.string() },
  returns: v.union(v.id("roleConfigs"), v.null()),
  handler: async (ctx, { legacyId }) => {
    const row = await ctx.db
      .query("roleConfigs")
      .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
      .first();
    return row ? row._id : null;
  },
});

export const upsertRole = internalMutation({
  args: {
    legacyId: v.string(),
    name: v.string(),
    basePayRate: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.id("roles"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        basePayRate: args.basePayRate,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("roles", args);
  },
});

export const upsertEmployee = internalMutation({
  args: {
    legacyId: v.string(),
    name: v.string(),
    active: v.boolean(),
    defaultRoleLegacyId: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.id("employees"),
  handler: async (ctx, args) => {
    let defaultRoleId: Id<"roles"> | undefined;
    if (args.defaultRoleLegacyId) {
      const role = await ctx.db
        .query("roles")
        .withIndex("by_legacy", (q) => q.eq("legacyId", args.defaultRoleLegacyId!))
        .first();
      if (!role) {
        throw new Error(
          `Employee ${args.legacyId} references unknown role ${args.defaultRoleLegacyId}`,
        );
      }
      defaultRoleId = role._id;
    }
    const existing = await ctx.db
      .query("employees")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.legacyId))
      .first();
    const patch = {
      name: args.name,
      active: args.active,
      defaultRoleId,
      updatedAt: args.updatedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("employees", {
      legacyId: args.legacyId,
      createdAt: args.createdAt,
      ...patch,
    });
  },
});

export const upsertRoleConfig = internalMutation({
  args: {
    legacyId: v.string(),
    roleLegacyId: v.string(),
    tipoutType: v.union(
      v.literal("bar"),
      v.literal("host"),
      v.literal("sa"),
    ),
    percentageRate: v.number(),
    effectiveFrom: v.number(),
    effectiveTo: v.union(v.number(), v.null()),
    receivesTipout: v.boolean(),
    paysTipout: v.boolean(),
    distributionGroup: v.union(v.string(), v.null()),
    tipPoolGroup: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.id("roleConfigs"),
  handler: async (ctx, args) => {
    const role = await ctx.db
      .query("roles")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.roleLegacyId))
      .first();
    if (!role) {
      throw new Error(
        `RoleConfig ${args.legacyId} references unknown role ${args.roleLegacyId}`,
      );
    }
    const doc: Omit<Doc<"roleConfigs">, "_id" | "_creationTime"> = {
      legacyId: args.legacyId,
      roleId: role._id,
      tipoutType: args.tipoutType,
      percentageRate: args.percentageRate,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo ?? undefined,
      receivesTipout: args.receivesTipout,
      paysTipout: args.paysTipout,
      distributionGroup: args.distributionGroup ?? undefined,
      tipPoolGroup: args.tipPoolGroup ?? undefined,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    };
    const existing = await ctx.db
      .query("roleConfigs")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (existing) {
      const { legacyId: _lid, createdAt: _ca, ...patch } = doc;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("roleConfigs", doc);
  },
});

export const upsertShift = internalMutation({
  args: {
    legacyId: v.string(),
    employeeLegacyId: v.string(),
    roleLegacyId: v.string(),
    date: v.number(),
    hours: v.number(),
    cashTips: v.number(),
    creditTips: v.number(),
    liquorSales: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.id("shifts"),
  handler: async (ctx, args) => {
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.employeeLegacyId))
      .first();
    if (!employee) {
      throw new Error(
        `Shift ${args.legacyId} references unknown employee ${args.employeeLegacyId}`,
      );
    }
    const role = await ctx.db
      .query("roles")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.roleLegacyId))
      .first();
    if (!role) {
      throw new Error(
        `Shift ${args.legacyId} references unknown role ${args.roleLegacyId}`,
      );
    }
    const doc: Omit<Doc<"shifts">, "_id" | "_creationTime"> = {
      legacyId: args.legacyId,
      employeeId: employee._id,
      roleId: role._id,
      date: args.date,
      hours: args.hours,
      cashTips: args.cashTips,
      creditTips: args.creditTips,
      liquorSales: args.liquorSales,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    };
    const existing = await ctx.db
      .query("shifts")
      .withIndex("by_legacy", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (existing) {
      const { legacyId: _lid, createdAt: _ca, ...patch } = doc;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("shifts", doc);
  },
});

export const countsByTable = internalQuery({
  args: {},
  returns: v.object({
    roles: v.number(),
    employees: v.number(),
    roleConfigs: v.number(),
    shifts: v.number(),
  }),
  handler: async (ctx) => {
    const [roles, employees, roleConfigs, shifts] = await Promise.all([
      ctx.db.query("roles").collect(),
      ctx.db.query("employees").collect(),
      ctx.db.query("roleConfigs").collect(),
      ctx.db.query("shifts").collect(),
    ]);
    return {
      roles: roles.length,
      employees: employees.length,
      roleConfigs: roleConfigs.length,
      shifts: shifts.length,
    };
  },
});
