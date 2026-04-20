#!/usr/bin/env -S npx tsx
/**
 * Postgres → Convex migration runner.
 *
 * Reads from the live Prisma Postgres DB (via DATABASE_URL in .env), upserts
 * each row into Convex via internal mutations keyed on legacyId, so the script
 * is idempotent and resumable. Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL="<postgres-url>" \
 *   CONVEX_URL="https://<deployment>.convex.cloud" \
 *   CONVEX_DEPLOY_KEY="<dev-or-prod-deploy-key>" \
 *   npx tsx scripts/migrate-to-convex.ts
 *
 * CONVEX_DEPLOY_KEY is the service token — get it with `npx convex dashboard`
 * or from the Convex dashboard → Settings → Deploy Keys. Required so we can
 * call `internal.*` functions that bypass client auth.
 *
 * Does NOT mutate Postgres. Does NOT delete from Convex. Idempotent.
 */
import { PrismaClient } from "@prisma/client";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const DATABASE_URL = process.env.DATABASE_URL;
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!CONVEX_URL) throw new Error("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is required");
if (!CONVEX_DEPLOY_KEY) throw new Error("CONVEX_DEPLOY_KEY is required");

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const convex = new ConvexHttpClient(CONVEX_URL);
// `setAdminAuth` exists at runtime but is omitted from the public types. It
// accepts an admin/deploy key (format `Convex <key>` wire-side), while the
// typed `setAuth` is strictly for OIDC JWTs and rejects deploy keys.
(convex as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(
  CONVEX_DEPLOY_KEY,
);

const toMs = (d: Date) => d.getTime();
const decimalToNumber = (d: unknown): number => {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  // Prisma Decimal has `toNumber()` but is a class instance; also toString works.
  const asAny = d as { toNumber?: () => number; toString: () => string };
  if (typeof asAny.toNumber === "function") return asAny.toNumber();
  const n = Number(asAny.toString());
  if (!Number.isFinite(n)) throw new Error(`Unparseable decimal: ${String(d)}`);
  return n;
};

async function migrateRoles() {
  const rows = await prisma.role.findMany();
  console.log(`[roles] ${rows.length} rows`);
  let done = 0;
  for (const r of rows) {
    await convex.mutation(anyApi.etl.upsertRole, {
      legacyId: r.id,
      name: r.name,
      basePayRate: decimalToNumber(r.basePayRate),
      createdAt: toMs(r.createdAt),
      updatedAt: toMs(r.updatedAt),
    });
    done++;
    if (done % 25 === 0) console.log(`[roles]   ${done}/${rows.length}`);
  }
  console.log(`[roles] done (${done})`);
}

async function migrateEmployees() {
  const rows = await prisma.employee.findMany();
  console.log(`[employees] ${rows.length} rows`);
  let done = 0;
  for (const e of rows) {
    await convex.mutation(anyApi.etl.upsertEmployee, {
      legacyId: e.id,
      name: e.name,
      active: e.active,
      defaultRoleLegacyId: e.defaultRoleId ?? null,
      createdAt: toMs(e.createdAt),
      updatedAt: toMs(e.updatedAt),
    });
    done++;
    if (done % 25 === 0) console.log(`[employees]   ${done}/${rows.length}`);
  }
  console.log(`[employees] done (${done})`);
}

function normalizeTipoutType(t: string): "bar" | "host" | "sa" {
  const v = t.trim().toLowerCase();
  if (v === "bar" || v === "host" || v === "sa") return v;
  throw new Error(`Unknown tipoutType: ${t}`);
}

async function migrateRoleConfigs() {
  const rows = await prisma.roleConfig.findMany();
  console.log(`[roleConfigs] ${rows.length} rows`);
  let done = 0;
  for (const c of rows) {
    await convex.mutation(anyApi.etl.upsertRoleConfig, {
      legacyId: c.id,
      roleLegacyId: c.roleId,
      tipoutType: normalizeTipoutType(c.tipoutType),
      percentageRate: decimalToNumber(c.percentageRate),
      effectiveFrom: toMs(c.effectiveFrom),
      effectiveTo: c.effectiveTo ? toMs(c.effectiveTo) : null,
      receivesTipout: c.receivesTipout,
      paysTipout: c.paysTipout,
      distributionGroup: c.distributionGroup ?? null,
      tipPoolGroup: c.tipPoolGroup ?? null,
      createdAt: toMs(c.createdAt),
      updatedAt: toMs(c.updatedAt),
    });
    done++;
    if (done % 25 === 0) console.log(`[roleConfigs]   ${done}/${rows.length}`);
  }
  console.log(`[roleConfigs] done (${done})`);
}

async function migrateShifts() {
  const rows = await prisma.shift.findMany({ orderBy: { date: "asc" } });
  console.log(`[shifts] ${rows.length} rows`);
  let done = 0;
  for (const s of rows) {
    await convex.mutation(anyApi.etl.upsertShift, {
      legacyId: s.id,
      employeeLegacyId: s.employeeId,
      roleLegacyId: s.roleId,
      date: toMs(s.date),
      hours: decimalToNumber(s.hours),
      cashTips: decimalToNumber(s.cashTips),
      creditTips: decimalToNumber(s.creditTips),
      liquorSales: decimalToNumber(s.liquorSales),
      createdAt: toMs(s.createdAt),
      updatedAt: toMs(s.updatedAt),
    });
    done++;
    if (done % 100 === 0) console.log(`[shifts]   ${done}/${rows.length}`);
  }
  console.log(`[shifts] done (${done})`);
}

async function main() {
  console.log(`Convex URL: ${CONVEX_URL}`);
  const before = await convex.query(anyApi.etl.countsByTable, {});
  console.log("Convex counts BEFORE:", before);

  await migrateRoles();
  await migrateEmployees();
  await migrateRoleConfigs();
  await migrateShifts();

  const after = await convex.query(anyApi.etl.countsByTable, {});
  console.log("Convex counts AFTER:", after);

  const pgCounts = await Promise.all([
    prisma.role.count(),
    prisma.employee.count(),
    prisma.roleConfig.count(),
    prisma.shift.count(),
  ]);
  console.log("Postgres counts:", {
    roles: pgCounts[0],
    employees: pgCounts[1],
    roleConfigs: pgCounts[2],
    shifts: pgCounts[3],
  });

  const mismatches: string[] = [];
  if (pgCounts[0] !== after.roles) mismatches.push(`roles: pg=${pgCounts[0]} convex=${after.roles}`);
  if (pgCounts[1] !== after.employees) mismatches.push(`employees: pg=${pgCounts[1]} convex=${after.employees}`);
  if (pgCounts[2] !== after.roleConfigs) mismatches.push(`roleConfigs: pg=${pgCounts[2]} convex=${after.roleConfigs}`);
  if (pgCounts[3] !== after.shifts) mismatches.push(`shifts: pg=${pgCounts[3]} convex=${after.shifts}`);
  if (mismatches.length > 0) {
    console.error("ROW COUNT MISMATCH:\n  " + mismatches.join("\n  "));
    process.exit(1);
  }
  console.log("OK — row counts match.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
