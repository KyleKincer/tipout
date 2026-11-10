import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Same model as the Postgres app after dated settings:
 * - role settings live in dated versions that never overlap ([effectiveFrom, effectiveTo), latest open-ended)
 * - pay periods can be locked, saving results as paid
 * - every change is written to the audit log in the same transaction
 *
 * Calendar dates are 'YYYY-MM-DD' strings so nothing depends on time zones.
 * legacyId keeps the Postgres ID for imported rows, so old links and the parity check still work.
 */
export const tipoutValidator = v.object({
  tipoutType: v.union(v.literal('bar'), v.literal('host'), v.literal('sa')),
  percentageRate: v.number(),
  paysTipout: v.boolean(),
  receivesTipout: v.boolean(),
  distributionGroup: v.union(v.string(), v.null()),
})

export default defineSchema({
  employees: defineTable({
    name: v.string(),
    active: v.boolean(),
    defaultRoleId: v.union(v.id('roles'), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    legacyId: v.optional(v.string()),
  })
    .index('by_legacy', ['legacyId'])
    .index('by_name', ['name'])
    .index('by_default_role', ['defaultRoleId']),

  roles: defineTable({
    name: v.string(),
    /** Archived roles keep their history but can't be picked for new shifts. */
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    legacyId: v.optional(v.string()),
  })
    .index('by_legacy', ['legacyId'])
    .index('by_name', ['name']),

  roleVersions: defineTable({
    roleId: v.id('roles'),
    effectiveFrom: v.string(),
    /** First day it no longer applies; null for the latest, open-ended version. */
    effectiveTo: v.union(v.string(), v.null()),
    basePayRate: v.number(),
    /** Roles with the same pool name on the same night share their tips by hours. */
    tipPoolGroup: v.union(v.string(), v.null()),
    tipouts: v.array(tipoutValidator),
    note: v.union(v.string(), v.null()),
    createdAt: v.number(),
    createdBy: v.union(v.string(), v.null()),
    legacyId: v.optional(v.string()),
  })
    .index('by_role_from', ['roleId', 'effectiveFrom'])
    .index('by_legacy', ['legacyId']),

  shifts: defineTable({
    employeeId: v.id('employees'),
    roleId: v.id('roles'),
    date: v.string(),
    hours: v.number(),
    cashTips: v.number(),
    creditTips: v.number(),
    liquorSales: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    legacyId: v.optional(v.string()),
  })
    .index('by_date', ['date'])
    .index('by_employee_date', ['employeeId', 'date'])
    .index('by_role_date', ['roleId', 'date'])
    .index('by_legacy', ['legacyId']),

  payPeriods: defineTable({
    startDate: v.string(),
    /** Last day of the period (inclusive). */
    endDate: v.string(),
    lockedAt: v.union(v.number(), v.null()),
    lockedBy: v.union(v.string(), v.null()),
    /** Results as paid, saved at lock time (PayPeriodSnapshot). */
    snapshot: v.union(v.any(), v.null()),
    createdAt: v.number(),
    createdBy: v.union(v.string(), v.null()),
    legacyId: v.optional(v.string()),
  })
    .index('by_start', ['startDate'])
    .index('by_legacy', ['legacyId']),

  auditLog: defineTable({
    at: v.number(),
    actorId: v.union(v.string(), v.null()),
    actorName: v.union(v.string(), v.null()),
    action: v.string(),
    entityType: v.string(),
    entityId: v.union(v.string(), v.null()),
    summary: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    legacyId: v.optional(v.string()),
  })
    .index('by_at', ['at'])
    .index('by_entity', ['entityType', 'entityId', 'at'])
    .index('by_legacy', ['legacyId']),
})
