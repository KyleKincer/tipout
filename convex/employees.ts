import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { serializeEmployee } from "./lib/serialize";
import { requireAdmin } from "./lib/acl";
import { employeeValidator } from "./lib/validators";

export const list = query({
  args: {},
  returns: v.array(employeeValidator),
  handler: async (ctx) => {
    const employees = await ctx.db.query("employees").collect();
    employees.sort((a, b) => a.name.localeCompare(b.name));
    const results = [];
    for (const employee of employees) {
      const defaultRole = employee.defaultRoleId
        ? await ctx.db.get(employee.defaultRoleId)
        : null;
      results.push(serializeEmployee(employee, defaultRole));
    }
    return results;
  },
});

export const get = query({
  args: { id: v.id("employees") },
  returns: v.union(employeeValidator, v.null()),
  handler: async (ctx, { id }) => {
    const employee = await ctx.db.get(id);
    if (!employee) return null;
    const defaultRole = employee.defaultRoleId
      ? await ctx.db.get(employee.defaultRoleId)
      : null;
    return serializeEmployee(employee, defaultRole);
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: employeeValidator,
  handler: async (ctx, { name }) => {
    await requireAdmin(ctx);
    if (!name.trim()) throw new ConvexError("Name is required");
    const now = Date.now();
    const id = await ctx.db.insert("employees", {
      name,
      active: true,
      defaultRoleId: undefined,
      createdAt: now,
      updatedAt: now,
    });
    const doc = (await ctx.db.get(id))!;
    return serializeEmployee(doc, null);
  },
});

export const update = mutation({
  args: {
    id: v.id("employees"),
    name: v.optional(v.string()),
    active: v.optional(v.boolean()),
    defaultRoleId: v.optional(v.union(v.id("roles"), v.null())),
  },
  returns: employeeValidator,
  handler: async (ctx, { id, name, active, defaultRoleId }) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.get(id);
    if (!existing) throw new ConvexError("Employee not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) patch.name = name;
    if (active !== undefined) patch.active = active;
    if (defaultRoleId !== undefined)
      patch.defaultRoleId = defaultRoleId ?? undefined;
    await ctx.db.patch(id, patch);
    const updated = (await ctx.db.get(id))!;
    const defaultRole = updated.defaultRoleId
      ? await ctx.db.get(updated.defaultRoleId)
      : null;
    return serializeEmployee(updated, defaultRole);
  },
});

export const remove = mutation({
  args: { id: v.id("employees") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const referencingShift = await ctx.db
      .query("shifts")
      .withIndex("by_employee", (q) => q.eq("employeeId", id))
      .first();
    if (referencingShift) {
      throw new ConvexError(
        "Cannot delete employee with shifts — deactivate instead",
      );
    }
    await ctx.db.delete(id);
    return { success: true };
  },
});
