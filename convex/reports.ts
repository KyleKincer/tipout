import { v } from "convex/values";
import { query } from "./_generated/server";
import { parseDateInput, parseEndOfDay } from "./lib/serialize";
import { reportResponseValidator } from "./lib/validators";
import type { Doc } from "./_generated/dataModel";
import {
  calculateOverallSummary,
  calculateEmployeeRoleSummariesDaily,
} from "../src/lib/reportCalculations";
import type { Shift as ReportShift } from "../src/types/reports";

export const get = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    employeeId: v.optional(v.id("employees")),
  },
  returns: reportResponseValidator,
  handler: async (ctx, { startDate, endDate, employeeId }) => {
    const start = parseDateInput(startDate);
    const end = parseEndOfDay(endDate);

    let shifts = (await ctx.db
      .query("shifts")
      .withIndex("by_date", (q) => q.gte("date", start).lte("date", end))
      .collect()) as Doc<"shifts">[];
    if (employeeId) shifts = shifts.filter((s) => s.employeeId === employeeId);
    shifts.sort((a, b) => a.date - b.date);

    // Pre-load referenced employees and roles (and their configs) in a minimum
    // number of queries. Convex has no joins so we load-then-join in memory.
    const employeeIds = Array.from(new Set(shifts.map((s) => s.employeeId)));
    const roleIds = Array.from(new Set(shifts.map((s) => s.roleId)));

    const employees = new Map<string, Doc<"employees">>();
    for (const id of employeeIds) {
      const doc = await ctx.db.get(id);
      if (doc) employees.set(id, doc);
    }

    const roles = new Map<string, Doc<"roles">>();
    for (const id of roleIds) {
      const doc = await ctx.db.get(id);
      if (doc) roles.set(id, doc);
    }

    // Load role configs per role once. We don't filter by effective-range here
    // because calculators do their own effective-range matching per shift date.
    // Matches today's behaviour: Prisma /api/reports includes `configs: true`.
    const configsByRole = new Map<string, Doc<"roleConfigs">[]>();
    for (const id of roleIds) {
      const configs = await ctx.db
        .query("roleConfigs")
        .withIndex("by_role", (q) => q.eq("roleId", id))
        .collect();
      configsByRole.set(id, configs);
    }

    // Project to the exact ReportShift shape the calculators expect.
    const reportShifts: ReportShift[] = shifts
      .filter((s) => employees.has(s.employeeId) && roles.has(s.roleId))
      .map((shift) => {
        const employee = employees.get(shift.employeeId)!;
        const role = roles.get(shift.roleId)!;
        const configs = configsByRole.get(shift.roleId) ?? [];
        return {
          id: shift._id,
          date: new Date(shift.date).toISOString(),
          hours: shift.hours,
          cashTips: shift.cashTips,
          creditTips: shift.creditTips,
          liquorSales: shift.liquorSales,
          employee: { id: employee._id, name: employee.name },
          role: {
            name: role.name,
            basePayRate: role.basePayRate,
            configs: configs.map((c) => ({
              id: c._id,
              tipoutType: c.tipoutType,
              percentageRate: c.percentageRate,
              effectiveFrom: new Date(c.effectiveFrom).toISOString(),
              effectiveTo: c.effectiveTo
                ? new Date(c.effectiveTo).toISOString()
                : null,
              receivesTipout: c.receivesTipout,
              paysTipout: c.paysTipout,
              distributionGroup: c.distributionGroup ?? undefined,
              tipPoolGroup: c.tipPoolGroup ?? undefined,
            })),
          },
        };
      });

    if (reportShifts.length === 0) {
      return { summary: null, employeeSummaries: [], roleConfigs: {} };
    }

    // Mirror /api/reports' roleConfigs map shape: { [roleName]: { barTipout, hostTipout, sa } }
    type RoleConfigEntry = { barTipout: number; hostTipout: number; sa: number };
    const roleConfigMap = new Map<string, RoleConfigEntry>();
    reportShifts.forEach((shift) => {
      if (!roleConfigMap.has(shift.role.name)) {
        roleConfigMap.set(shift.role.name, {
          barTipout:
            shift.role.configs.find((c) => c.tipoutType === "bar")
              ?.percentageRate ?? 0,
          hostTipout:
            shift.role.configs.find((c) => c.tipoutType === "host")
              ?.percentageRate ?? 0,
          sa:
            shift.role.configs.find((c) => c.tipoutType === "sa")
              ?.percentageRate ?? 0,
        });
      }
    });

    const summary = calculateOverallSummary(reportShifts);
    const employeeSummaries = calculateEmployeeRoleSummariesDaily(reportShifts);

    return {
      summary,
      employeeSummaries,
      roleConfigs: Object.fromEntries(roleConfigMap),
    };
  },
});
