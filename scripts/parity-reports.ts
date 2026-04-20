#!/usr/bin/env -S npx tsx
/**
 * Parity harness for reports.
 *
 * We can't call the deployed /api/reports without a live Clerk session cookie,
 * so instead we reproduce the exact shape that `/api/reports` built: load
 * shifts from the live Postgres via Prisma, run the shared calculator
 * (`src/lib/reportCalculations.ts`), and compare to `api.reports.get` from
 * Convex (which also uses the same calculator). Identical calculator on both
 * sides means any diff is a data-migration bug, which is exactly what we want
 * to catch before cutover.
 *
 * Usage:
 *   DATABASE_URL="<postgres-url>" \
 *   CONVEX_URL="https://<deployment>.convex.cloud" \
 *   CONVEX_DEPLOY_KEY="<deploy-key>" \
 *   START_DATE="2025-01-01" END_DATE="2025-12-31" \
 *   npx tsx scripts/parity-reports.ts
 */
import { PrismaClient } from "@prisma/client";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  calculateOverallSummary,
  calculateEmployeeRoleSummariesDaily,
} from "@/lib/reportCalculations";
import type { Shift as ReportShift, TipoutType } from "@/types/reports";

function narrowTipoutType(t: string): TipoutType {
  if (t === "bar" || t === "host" || t === "sa") return t;
  throw new Error(`Unknown tipoutType: ${t}`);
}

const DATABASE_URL = process.env.DATABASE_URL;
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;
const START_DATE = process.env.START_DATE;
const END_DATE = process.env.END_DATE;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!CONVEX_URL) throw new Error("CONVEX_URL is required");
if (!CONVEX_DEPLOY_KEY) throw new Error("CONVEX_DEPLOY_KEY is required");
if (!START_DATE) throw new Error("START_DATE is required (YYYY-MM-DD)");
if (!END_DATE) throw new Error("END_DATE is required (YYYY-MM-DD)");

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const convex = new ConvexHttpClient(CONVEX_URL);
(convex as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(
  CONVEX_DEPLOY_KEY,
);

type ReportResponse = {
  summary: Record<string, number> | null;
  employeeSummaries: Array<Record<string, string | number | null | undefined>>;
  roleConfigs: Record<string, { barTipout: number; hostTipout: number; sa: number }>;
};

async function computeOldFromPostgres(): Promise<ReportResponse> {
  const startDateTime = new Date(START_DATE! + "T00:00:00.000Z");
  const endDateTime = new Date(END_DATE! + "T23:59:59.999Z");

  const shifts = await prisma.shift.findMany({
    where: { date: { gte: startDateTime, lte: endDateTime } },
    include: {
      employee: { select: { id: true, name: true } },
      role: { include: { configs: true } },
    },
    orderBy: { date: "asc" },
  });

  const reportShifts: ReportShift[] = shifts
    .filter((s) => !!s.employee && !!s.role)
    .map((s) => ({
      id: s.id,
      date: s.date.toISOString(),
      hours: Number(s.hours),
      cashTips: Number(s.cashTips),
      creditTips: Number(s.creditTips),
      liquorSales: Number(s.liquorSales),
      employee: { id: s.employee!.id, name: s.employee!.name },
      role: {
        id: s.role!.id,
        name: s.role!.name,
        basePayRate: Number(s.role!.basePayRate),
        configs: (s.role!.configs || []).map((c) => ({
          id: c.id,
          tipoutType: narrowTipoutType(c.tipoutType),
          percentageRate: Number(c.percentageRate),
          effectiveFrom: c.effectiveFrom.toISOString(),
          effectiveTo: c.effectiveTo ? c.effectiveTo.toISOString() : null,
          receivesTipout: c.receivesTipout ?? false,
          paysTipout: c.paysTipout ?? true,
          distributionGroup: c.distributionGroup ?? undefined,
          tipPoolGroup: c.tipPoolGroup ?? undefined,
        })),
      },
    }));

  if (reportShifts.length === 0) {
    return { summary: null, employeeSummaries: [], roleConfigs: {} };
  }

  const roleConfigMap = new Map<
    string,
    { barTipout: number; hostTipout: number; sa: number }
  >();
  for (const shift of reportShifts) {
    if (!roleConfigMap.has(shift.role.name)) {
      roleConfigMap.set(shift.role.name, {
        barTipout:
          shift.role.configs.find((c) => c.tipoutType === "bar")
            ?.percentageRate || 0,
        hostTipout:
          shift.role.configs.find((c) => c.tipoutType === "host")
            ?.percentageRate || 0,
        sa:
          shift.role.configs.find((c) => c.tipoutType === "sa")
            ?.percentageRate || 0,
      });
    }
  }
  const roleConfigs = Object.fromEntries(roleConfigMap);

  const summary = calculateOverallSummary(reportShifts);
  const employeeSummaries = calculateEmployeeRoleSummariesDaily(reportShifts);

  return {
    summary: summary as unknown as Record<string, number>,
    employeeSummaries: employeeSummaries as unknown as ReportResponse["employeeSummaries"],
    roleConfigs,
  };
}

async function fetchNew(): Promise<ReportResponse> {
  return convex.query(anyApi.reports.get, {
    startDate: START_DATE,
    endDate: END_DATE,
  }) as Promise<ReportResponse>;
}

// Normalize IDs out of comparison — Prisma CUIDs vs Convex Ids don't line up.
// Key employee summaries by (employeeName, roleName) and drop id fields.
function normalize(r: ReportResponse): ReportResponse {
  const sorted = [...r.employeeSummaries].sort((a, b) => {
    const an = `${a.employeeName ?? ""}|${a.roleName ?? ""}`;
    const bn = `${b.employeeName ?? ""}|${b.roleName ?? ""}`;
    return an.localeCompare(bn);
  });
  return {
    summary: r.summary,
    employeeSummaries: sorted.map((s) => {
      const { employeeId: _eid, ...rest } = s;
      return rest;
    }),
    roleConfigs: r.roleConfigs,
  };
}

function nearEqual(a: unknown, b: unknown, epsilon = 0.005): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= epsilon;
  }
  return Object.is(a, b);
}

function deepDiff(
  a: unknown,
  b: unknown,
  path: string = "",
  diffs: string[] = [],
): string[] {
  if (a === b) return diffs;
  if (typeof a !== typeof b) {
    diffs.push(`${path}: type ${typeof a} vs ${typeof b}`);
    return diffs;
  }
  if (a === null || b === null) {
    if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return diffs;
  }
  if (typeof a !== "object") {
    if (!nearEqual(a, b)) {
      diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
    return diffs;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push(`${path}: array vs object`);
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: length ${a.length} vs ${b.length}`);
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], `${path}[${i}]`, diffs);
    return diffs;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) deepDiff(ao[k], bo[k], path ? `${path}.${k}` : k, diffs);
  return diffs;
}

async function main() {
  console.log(`Comparing reports: ${START_DATE} → ${END_DATE}`);
  const [oldR, newR] = await Promise.all([computeOldFromPostgres(), fetchNew()]);
  console.log(
    `  old: ${oldR.employeeSummaries.length} summaries, ${Object.keys(oldR.roleConfigs).length} roles`,
  );
  console.log(
    `  new: ${newR.employeeSummaries.length} summaries, ${Object.keys(newR.roleConfigs).length} roles`,
  );
  const diffs = deepDiff(normalize(oldR), normalize(newR));
  if (diffs.length === 0) {
    console.log("PARITY OK — no diffs.");
    return;
  }
  console.error(`PARITY FAIL — ${diffs.length} diffs:`);
  for (const d of diffs.slice(0, 50)) console.error("  " + d);
  if (diffs.length > 50) console.error(`  … ${diffs.length - 50} more`);
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
