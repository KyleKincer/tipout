import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  employees: defineTable({
    name: v.string(),
    active: v.boolean(),
    defaultRoleId: v.optional(v.id("roles")),
    // Preserve original Postgres CUID for migration audit + resumable ETL.
    legacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_active", ["active"]),

  roles: defineTable({
    name: v.string(),
    basePayRate: v.number(),
    legacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_name", ["name"]),

  shifts: defineTable({
    employeeId: v.id("employees"),
    roleId: v.id("roles"),
    // Unix ms, UTC midnight — mirrors today's ISO-string-with-T00:00:00.000Z convention.
    date: v.number(),
    hours: v.number(),
    cashTips: v.number(),
    creditTips: v.number(),
    liquorSales: v.number(),
    legacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_date", ["date"])
    .index("by_employee", ["employeeId"])
    .index("by_role", ["roleId"])
    .index("by_date_employee", ["date", "employeeId"]),

  roleConfigs: defineTable({
    roleId: v.id("roles"),
    tipoutType: v.union(
      v.literal("bar"),
      v.literal("host"),
      v.literal("sa"),
    ),
    percentageRate: v.number(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    receivesTipout: v.boolean(),
    paysTipout: v.boolean(),
    distributionGroup: v.optional(v.string()),
    tipPoolGroup: v.optional(v.string()),
    legacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_role", ["roleId"])
    .index("by_role_type", ["roleId", "tipoutType"]),
});
