import { v, ConvexError } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { parseDateInput, parseEndOfDay, serializeShift } from "./lib/serialize";
import { requireAdmin } from "./lib/acl";
import { shiftValidator } from "./lib/validators";
import type { Doc } from "./_generated/dataModel";

// Load a shift + dependent employee/role/configs from the DB.
async function hydrateShift(
  ctx: QueryCtx | MutationCtx,
  shift: Doc<"shifts">,
): Promise<ReturnType<typeof serializeShift>> {
  const employee = (await ctx.db.get(shift.employeeId)) as Doc<"employees">;
  const role = (await ctx.db.get(shift.roleId)) as Doc<"roles">;
  // Load ALL configs for the role, then filter in-memory to those active on the shift date.
  // Prisma today returns configs where effectiveTo is null OR the range overlaps.
  const allConfigs = await ctx.db
    .query("roleConfigs")
    .withIndex("by_role", (q) => q.eq("roleId", shift.roleId))
    .collect();
  const date = shift.date;
  const configs = allConfigs.filter((c) => {
    if (c.effectiveTo == null) return true;
    return c.effectiveFrom <= date && c.effectiveTo >= date;
  });
  return serializeShift(shift, employee, role, configs);
}

export const list = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    employeeId: v.optional(v.id("employees")),
    role: v.optional(v.string()),
  },
  returns: v.array(shiftValidator),
  handler: async (ctx, { startDate, endDate, employeeId, role }) => {
    let shifts: Doc<"shifts">[];
    if (startDate && endDate) {
      const start = parseDateInput(startDate);
      const end = parseEndOfDay(endDate);
      shifts = await ctx.db
        .query("shifts")
        .withIndex("by_date", (q) => q.gte("date", start).lte("date", end))
        .collect();
    } else if (startDate) {
      const start = parseDateInput(startDate);
      const end = parseEndOfDay(startDate);
      shifts = await ctx.db
        .query("shifts")
        .withIndex("by_date", (q) => q.gte("date", start).lte("date", end))
        .collect();
    } else if (employeeId) {
      shifts = await ctx.db
        .query("shifts")
        .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
        .collect();
    } else {
      shifts = await ctx.db.query("shifts").collect();
    }

    if (employeeId && (startDate || endDate)) {
      shifts = shifts.filter((s) => s.employeeId === employeeId);
    }
    if (role) {
      // Role filter is by role name (legacy API contract). We need to look up roles by name.
      const allRoles = await ctx.db.query("roles").collect();
      const roleIds = new Set(
        allRoles.filter((r) => r.name === role).map((r) => r._id),
      );
      shifts = shifts.filter((s) => roleIds.has(s.roleId));
    }

    shifts.sort((a, b) => b.date - a.date);

    const results = [];
    for (const shift of shifts) results.push(await hydrateShift(ctx, shift));
    return results;
  },
});

export const get = query({
  args: { id: v.id("shifts") },
  returns: v.union(shiftValidator, v.null()),
  handler: async (ctx, { id }) => {
    const shift = await ctx.db.get(id);
    if (!shift) return null;
    return hydrateShift(ctx, shift);
  },
});

export const create = mutation({
  args: {
    employeeId: v.id("employees"),
    roleId: v.id("roles"),
    date: v.string(),
    hours: v.number(),
    cashTips: v.optional(v.number()),
    creditTips: v.optional(v.number()),
    liquorSales: v.optional(v.number()),
  },
  returns: shiftValidator,
  handler: async (
    ctx,
    { employeeId, roleId, date, hours, cashTips, creditTips, liquorSales },
  ) => {
    await requireAdmin(ctx);
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");
    const role = await ctx.db.get(roleId);
    if (!role) throw new ConvexError("Role not found");
    const now = Date.now();
    const id = await ctx.db.insert("shifts", {
      employeeId,
      roleId,
      date: parseDateInput(date),
      hours,
      cashTips: cashTips ?? 0,
      creditTips: creditTips ?? 0,
      liquorSales: liquorSales ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    const doc = (await ctx.db.get(id))!;
    return hydrateShift(ctx, doc);
  },
});

export const update = mutation({
  args: {
    id: v.id("shifts"),
    employeeId: v.id("employees"),
    roleId: v.id("roles"),
    date: v.string(),
    hours: v.number(),
    cashTips: v.optional(v.number()),
    creditTips: v.optional(v.number()),
    liquorSales: v.optional(v.number()),
  },
  returns: shiftValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Shift not found");
    await ctx.db.patch(args.id, {
      employeeId: args.employeeId,
      roleId: args.roleId,
      date: parseDateInput(args.date),
      hours: args.hours,
      cashTips: args.cashTips ?? 0,
      creditTips: args.creditTips ?? 0,
      liquorSales: args.liquorSales ?? 0,
      updatedAt: Date.now(),
    });
    const doc = (await ctx.db.get(args.id))!;
    return hydrateShift(ctx, doc);
  },
});

export const remove = mutation({
  args: { id: v.id("shifts") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
    return { success: true };
  },
});
