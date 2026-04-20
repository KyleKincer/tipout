import { v } from "convex/values";

export const roleBareValidator = v.object({
  id: v.id("roles"),
  name: v.string(),
  basePayRate: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const roleConfigValidator = v.object({
  id: v.id("roleConfigs"),
  roleId: v.id("roles"),
  tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
  percentageRate: v.number(),
  effectiveFrom: v.string(),
  effectiveTo: v.union(v.string(), v.null()),
  receivesTipout: v.boolean(),
  paysTipout: v.boolean(),
  distributionGroup: v.union(v.string(), v.null()),
  tipPoolGroup: v.union(v.string(), v.null()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const roleWithConfigsValidator = v.object({
  id: v.id("roles"),
  name: v.string(),
  basePayRate: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
  configs: v.array(roleConfigValidator),
});

export const employeeValidator = v.object({
  id: v.id("employees"),
  name: v.string(),
  active: v.boolean(),
  defaultRoleId: v.union(v.id("roles"), v.null()),
  createdAt: v.string(),
  updatedAt: v.string(),
  defaultRole: v.union(roleBareValidator, v.null()),
});

export const reportSummaryValidator = v.object({
  totalShifts: v.number(),
  totalHours: v.number(),
  totalCashTips: v.number(),
  totalCreditTips: v.number(),
  totalLiquorSales: v.number(),
  totalBarTipoutPaid: v.number(),
  totalHostTipoutPaid: v.number(),
  totalSaTipoutPaid: v.number(),
  barTipsPerHour: v.number(),
  serverTipsPerHour: v.number(),
  barCashTipsPerHour: v.number(),
  barCreditTipsPerHour: v.number(),
  serverCashTipsPerHour: v.number(),
  serverCreditTipsPerHour: v.number(),
});

export const employeeRoleSummaryValidator = v.object({
  employeeId: v.string(),
  employeeName: v.string(),
  roleName: v.string(),
  totalHours: v.number(),
  totalCashTips: v.number(),
  totalCreditTips: v.number(),
  totalGrossCreditTips: v.number(),
  totalBarTipout: v.number(),
  totalHostTipout: v.number(),
  totalSaTipout: v.number(),
  cashTipsPerHour: v.number(),
  creditTipsPerHour: v.number(),
  totalTipsPerHour: v.number(),
  basePayRate: v.number(),
  totalPayrollTips: v.number(),
  totalLiquorSales: v.number(),
  payrollTotal: v.number(),
  tipPoolGroup: v.optional(v.union(v.string(), v.null())),
});

export const reportResponseValidator = v.object({
  summary: v.union(reportSummaryValidator, v.null()),
  employeeSummaries: v.array(employeeRoleSummaryValidator),
  roleConfigs: v.record(
    v.string(),
    v.object({
      barTipout: v.number(),
      hostTipout: v.number(),
      sa: v.number(),
    }),
  ),
});

export const shiftValidator = v.object({
  id: v.id("shifts"),
  employeeId: v.id("employees"),
  roleId: v.id("roles"),
  date: v.string(),
  hours: v.number(),
  cashTips: v.number(),
  creditTips: v.number(),
  liquorSales: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
  employee: v.object({
    id: v.id("employees"),
    name: v.string(),
    active: v.boolean(),
    defaultRoleId: v.union(v.id("roles"), v.null()),
    createdAt: v.string(),
    updatedAt: v.string(),
  }),
  role: roleWithConfigsValidator,
});
