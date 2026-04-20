# Tipout: Supabase/Postgres → Convex Migration Plan

## Executive summary

Tipout currently runs on Next.js 15 + Prisma → Postgres (hosted on Supabase) + Clerk. The stack is small (4 tables, ~12 API routes, all business logic is pure-function in `src/utils/`). Migration to Convex is low-risk in surface area but **high-risk in correctness** because:

1. The tipout math has non-trivial daily pooling / redistribution logic that the business depends on for payroll.
2. Historical data must move without drift (precision, rounding, UTC boundaries).
3. Reporting outputs must be byte-identical to what payroll processes today.

The plan below is structured around a **"prove-no-change" harness**: before we flip any writes to Convex, we run the live Postgres data through both calculation paths and assert identical outputs. Only when that gate passes do we cut over.

---

## Invariants (these do not change)

| # | Invariant | How we enforce |
|---|-----------|----------------|
| 1 | `calculateTipouts()` output is identical for every historical shift. | Snapshot regression harness: run both engines over prod data, diff to the penny. |
| 2 | `calculateEmployeeRoleSummariesDaily()` output (every field per employee/role) is identical across date ranges. | Golden-report diff harness run on every prod date range back to inception. |
| 3 | `calculateOverallSummary()` output is identical. | Same harness. |
| 4 | Every row in Postgres has a matching row in Convex with the same business values. | Row-by-row diff job post-ETL. |
| 5 | Reporting exposes the same fields (same names, same types, same math). | `ReportSummary` / `EmployeeRoleSummary` types are preserved verbatim. Integration tests assert shape. |
| 6 | Clerk auth, role gating (`admin`), and invitation flows keep working. | Adapter layer on top of Convex auth; no change to Clerk itself. |

**UX can change in the direction of better UX** (e.g., dropping the API-route round-trip for live Convex queries, adding realtime to the reports page). But see "Out of scope" below — we don't do UX work in the migration PRs themselves.

---

## What we learned from the code (short version)

- Database is **Prisma on Postgres**, not direct Supabase SDK. `@supabase/supabase-js` is in package.json but is not called from anywhere. This simplifies migration — we only need to replace Prisma.
- **No raw SQL, no triggers, no RLS, no Supabase Storage, no Supabase Realtime, no webhooks, no cron.**
- Business logic lives in `src/utils/tipoutCalculations.ts` and `src/utils/reportCalculations.ts` — pure functions operating on plain objects. These can move **unchanged** to Convex.
- Decimal fields are `DECIMAL(65,30)` in Postgres but already coerced to JS `Number` at every API boundary. Convex's `v.number()` is already the de-facto data type.
- 4 tables: `Employee`, `Role`, `Shift`, `RoleConfig`. ~10 indexes. One multi-column uniqueness constraint: `RoleConfig (roleId, tipoutType, effectiveFrom)` — must be enforced in mutation logic.
- `effectiveFrom` / `effectiveTo` gives role configs time-versioned rates. Any migration that re-orders or rewrites these rows changes historical payroll. Must be immutable during migration.

---

## Phased plan

### Phase 0 — Pre-flight (2–4 hours)

**Goal**: lock down the source of truth and build the parity harness before touching Convex.

Tasks:
1. `pg_dump` the production Supabase DB. Store it locally + S3/GDrive backup. All subsequent work reads from a restored copy, not prod.
2. Capture a **"business truth" snapshot**: run `/api/reports` for:
   - Every complete pay period since inception.
   - The rolling 7-day, 30-day, 90-day, YTD ranges.
   - Per-employee reports for each active employee.
   Dump the JSON response bodies to `tests/fixtures/reports/*.json`.
3. Write a parity harness at `tests/parity/run.ts`:
   - Reads each fixture's input params.
   - Calls the current Prisma-backed calculator.
   - Calls the new Convex-backed calculator (initially stubbed; wired in Phase 4).
   - Deep-equals the two outputs, normalizing only for numeric noise within 1e-9.
   - Any field-level drift fails the build.
4. Freeze schema changes in the Postgres side (no new migrations until cutover is done).

**Exit criteria**: harness runs green with both engines pointing at Postgres/Prisma (sanity — proves the harness itself is correct).

### Phase 1 — Convex schema (half a day)

Create `~/src/tipout/convex/schema.ts`:

```ts
export default defineSchema({
  employees: defineTable({
    name: v.string(),
    active: v.boolean(),
    defaultRoleId: v.optional(v.id("roles")),
    // Preserve legacy Postgres CUID for migration/audit. Never shown in UI.
    legacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_legacy", ["legacyId"]),

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
    date: v.number(),            // Unix ms, UTC midnight per today's convention
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
    tipoutType: v.union(v.literal("bar"), v.literal("host"), v.literal("sa")),
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
```

Notes:
- `tipoutType` becomes a literal union — today's code uses plain strings, and typos are silent bugs. This is the one schema-level improvement.
- `legacyId` on every table preserves the Postgres CUID/UUID so we can diff and resume migrations.
- No cascade delete support in Convex — we implement that in mutations (Phase 2).
- Dates stored as Unix milliseconds to match `Date.now()` and avoid string parsing.

### Phase 2 — Convex functions (1–2 days)

One file per collection under `convex/`:

- `convex/employees.ts` — `list`, `get`, `create`, `update`, `deactivate`, `deleteWithCheck` (errors if there are shifts).
- `convex/roles.ts` — same shape; `deleteWithCheck` cascades `roleConfigs` (mirror Prisma's `onDelete: Cascade`) but refuses if any shift references it.
- `convex/shifts.ts` — `list` (with date range + employee + role filters), `get`, `create`, `update`, `remove`. Includes hydrates role + role.configs like the current `/api/shifts` does.
- `convex/roleConfigs.ts` — `listForRole`, `upsertBatch` (the "save role configs" action does a whole-array replace today; keep same semantics). Enforce the `(roleId, tipoutType, effectiveFrom)` uniqueness in the mutation.
- `convex/reports.ts` — `getReport({ startDate, endDate, employeeId? })`. Internally:
  1. Loads shifts in range via `by_date` index.
  2. Hydrates employees, roles, and all active roleConfigs that overlap the range.
  3. Calls the shared pure-function calculators (see Phase 4).
  4. Returns `{ summary, employeeSummaries, roleConfigs }` — same shape as `/api/reports` today.
- `convex/auth.config.ts` — Clerk JWT issuer + audience wired per Convex+Clerk docs.
- `convex/lib/acl.ts` — wrapper that reads `ctx.auth.getUserIdentity()`, pulls `publicMetadata.roles` from Clerk JWT claim, exposes `requireAdmin(ctx)` / `requireUser(ctx)`.

**Unique constraint enforcement pattern** (applied in `roleConfigs.upsertBatch`):
```ts
const existing = await ctx.db
  .query("roleConfigs")
  .withIndex("by_role_type", q => q.eq("roleId", cfg.roleId).eq("tipoutType", cfg.tipoutType))
  .filter(q => q.eq(q.field("effectiveFrom"), cfg.effectiveFrom))
  .first();
if (existing && existing._id !== cfg._id) throw new ConvexError("duplicate config");
```

### Phase 3 — Clerk + Convex auth wiring (2–4 hours)

- Install `convex` + `@clerk/nextjs` bridge per docs.
- Add `<ConvexProviderWithClerk>` at the root layout.
- `auth.config.ts` points to your Clerk JWT template. **Make sure the template includes `publicMetadata.roles`** — today's middleware reads it from the session cookie directly; Convex needs it inside the JWT claims.
- Keep `src/middleware.ts` as-is for page-level route gating (it's a Next.js concern; Convex auth is in addition, not a replacement).
- Replicate `isAdmin()` / `hasRole()` over Convex's `getUserIdentity()` in `convex/lib/acl.ts` so the server-side admin checks (currently in `app/actions/*.ts`) move cleanly.

### Phase 4 — Move the business logic, unchanged (half a day)

This is the "do not change the math" phase. Make it mechanical.

1. Move `src/utils/tipoutCalculations.ts` → `src/lib/tipoutCalculations.ts` (same file, no edits). Purpose: it's no longer a "utility for the API route", it's a shared library used by both the Convex query and the client.
2. Same for `src/utils/reportCalculations.ts` → `src/lib/reportCalculations.ts`.
3. In `convex/reports.ts`, import from `../src/lib/reportCalculations`. Convex supports TS imports from the repo; no duplication, no rewrite.
4. Wire the parity harness from Phase 0 to call `convex/reports.ts` via `ConvexHttpClient` against a dev deployment, comparing its output to the Prisma-backed `/api/reports`.
5. The `date-fns` `parseISO` calls in the calculators assume `config.effectiveFrom` is an ISO string. Today's API stringifies Decimals and Dates before passing them. For Convex, we'll be passing raw ms numbers. Options:
   - (a) Convert ms → ISO string in `convex/reports.ts` before calling the calculators (zero risk, zero math change).
   - (b) Parameterize the calculators to accept `number | string`. More invasive, don't do this during migration.
   Go with (a).

**Exit criteria**: parity harness runs green. Both engines produce identical JSON for every fixture captured in Phase 0.

### Phase 5 — Data migration ETL (1 day)

Script at `scripts/migrate-pg-to-convex.ts`. Runs offline against (a) a pg_dump of prod, (b) a fresh Convex dev deployment.

Order (FK-safe):
1. `roles` → insert. Capture `legacyId → _id` map.
2. `employees` → insert, rewriting `defaultRoleId` via the map.
3. `roleConfigs` → insert, rewriting `roleId`.
4. `shifts` → insert, rewriting `employeeId` and `roleId`.

Each step:
- Batches of 500 via `internalMutation`.
- Resumable: if a row's `legacyId` already exists, skip. So re-running the script is safe.
- Logs `{ table, inserted, skipped, errored }` at the end.

Post-ETL verification (mandatory gate):
- Row count per table: Postgres == Convex.
- Per-table checksum: for each row in Postgres, hash business fields (name, active, basePayRate, hours, cashTips, creditTips, liquorSales, percentageRate, etc. — NOT timestamps or IDs). Same hash in Convex. Sum of hashes must match.
- Run the parity harness (Phase 4) against the Convex deployment now that it has real data. Fail loud on any drift.

### Phase 6 — Client refactor (2–3 days)

**One screen at a time.** Each screen goes through: new Convex hook → feature-flagged behind `NEXT_PUBLIC_USE_CONVEX=1` → both paths live in the same build → manual smoke.

Order (cheapest first):
1. `/employees` list + edit
2. `/roles` list + edit + configs
3. `/shifts` list + new + edit
4. `/reports` (includes charts)
5. `/admin` (Clerk invitation/role management — doesn't touch DB, mostly unchanged; just move the server actions into Convex actions where they gate on `requireAdmin`)

For each screen:
- Replace `fetch('/api/...')` with `useQuery(api.x.y, ...)` / `useMutation`.
- Keep the old API route alive and deployed — it's the fallback during rollback.
- Delete the API route only in Phase 10.

### Phase 7 — Parallel-run verification (1 week)

Ship to prod with `NEXT_PUBLIC_USE_CONVEX=0`. Writes still go to Postgres. But add a **shadow-write** wrapper in each mutation helper: every successful Postgres write triggers an async Convex `internalMutation` that upserts the same row by `legacyId`. Failures log to Sentry but don't fail the user's request.

Run this for at least a full pay period. At the end:
- Count Postgres writes vs Convex shadow writes. Should match 1:1.
- Re-run the parity harness against live data. Should match 1:1.
- Any drift → root-cause before flipping the flag.

### Phase 8 — Cutover (30 minutes + monitoring)

1. Put up a maintenance banner on the app (60-second freeze is fine; writes pause).
2. Run a final incremental ETL: any Postgres row with `updatedAt > last_migration_timestamp` gets re-upserted into Convex.
3. Run the full parity harness. Green light required.
4. Flip `NEXT_PUBLIC_USE_CONVEX=1` in Vercel.
5. Keep shadow-writes flowing to Convex for another 48h (now Postgres is the shadow, Convex is primary — a safety net for rollback).
6. Remove banner.

### Phase 9 — Bake (1 week)

Convex is primary, Postgres is shadow, fully readable. Monitor:
- Sentry for unexpected Convex errors.
- Daily diff job: pull shifts from both stores for the previous day, assert equality.
- Payroll owner runs the first payroll report off Convex. **This is the real acceptance test** — if payroll matches what Postgres would have produced, we're done.

### Phase 10 — Decommission (few hours)

Only after a full pay period of Convex-primary operation with no drift:
1. Stop shadow-writing to Postgres.
2. Take a final pg_dump; store in cold storage for 12 months.
3. Delete `prisma/`, `src/lib/prisma.ts`, `@prisma/client`, `@supabase/*` packages, Prisma-backed `/api/*/route.ts` files.
4. Pause the Supabase project (don't delete — the dump is the archive; pausing is reversible).

---

## Decimal precision strategy

Postgres uses `DECIMAL(65,30)`. Convex uses `v.number()` (IEEE 754 float64).

The current code **already** coerces every Decimal to `Number` at the API boundary (`Number(shift.hours)`, etc.), and the tipout math is all floating-point arithmetic. **So Convex is storing exactly what the current calculator already operates on.** There is no precision regression.

However, we should **preserve display rounding**: `reportCalculations.ts` already rounds to 2 decimals via `parseFloat(value.toFixed(2))` for every reported field. Keep that.

One gotcha: `basePayRate` is currently stored at high precision. If any role has a base pay rate with >15 significant digits, we'll lose precision. Guard with a one-time assertion in the ETL: `assert(fitsInFloat64(basePayRate))`. In practice these are values like `15.00`, so this is theoretical.

---

## Timezone / date handling

Today's code writes `YYYY-MM-DD` + `T00:00:00.000Z` and reads ISO strings back. Effectively: **all shift dates are UTC midnight**. Reports iterate days by local-interpreted date.

We preserve this exactly:
- ETL writes `shift.date` as `Date.parse(pgRow.date.toISOString())` — which for a UTC-midnight source is the same ms.
- `findActiveConfig()` does `parseISO(shift.date)` — in the Convex path we convert ms → ISO string before calling (Phase 4, option a).

**Do not try to "fix" timezone handling during the migration.** It is an invariant. File a follow-up ticket.

---

## Testing strategy

1. **Unit tests** (existing): `src/utils/tipoutCalculations.test.ts` stays as-is after move to `src/lib/`. It's library tests, store-agnostic.
2. **Parity harness** (new, Phase 0): the fixture-based diff described above. Runs in CI on every PR.
3. **ETL dry-run test**: runs the migration script against a small seeded Postgres DB, asserts row counts and checksums.
4. **Integration test**: boots a Convex dev deployment in CI (or uses Convex's test harness), runs `api.reports.getReport` against a seeded dataset, asserts shape.
5. **Manual payroll test**: before Phase 8 cutover, finance/ops team runs last pay period's report from both systems side-by-side and visually diffs. Written sign-off required.

---

## Rollback plan

At each phase:
- **Phase 1–4**: nothing user-facing. Revert branch.
- **Phase 5** (ETL): Convex dev deployment is isolated; just wipe it and rerun.
- **Phase 6** (client refactor, flagged): `NEXT_PUBLIC_USE_CONVEX=0`, redeploy. Takes ~2 min.
- **Phase 7** (shadow-writes): shadow-write is async; disable the wrapper. Postgres is still canonical.
- **Phase 8** (cutover): within the 48h shadow window, flip `NEXT_PUBLIC_USE_CONVEX=0`. Postgres has all writes (shadow kept it current). Convex rolls back automatically.
- **Phase 9+**: if Convex is primary for more than 48h, rollback is harder — we'd need a reverse ETL (Convex → Postgres). Budget 1 day for this if it's ever needed.

---

## Out of scope (explicit)

The following are worth doing but **not** in the migration PRs — each is a follow-up:
- CSV/PDF export for payroll (multiple people would like this; it's a clean add on top of Convex).
- Realtime report updates (trivial once on Convex — one-line change from `useQuery` — but a separate UX decision).
- Multi-tenant / org support (Clerk orgs are there; the schema doesn't use them).
- Timezone correctness for multi-zone teams.
- Soft-delete for shifts (currently hard-delete; no audit trail).
- Clerk webhook → Convex user sync (nice-to-have for admin dashboard).

---

## Estimated effort

| Phase | Wall-clock |
|-------|-----------|
| 0 — Pre-flight & harness | 0.5 day |
| 1 — Schema | 0.5 day |
| 2 — Functions | 1.5 days |
| 3 — Auth wiring | 0.5 day |
| 4 — Move calculators + parity green | 0.5 day |
| 5 — ETL + verification | 1 day |
| 6 — Client refactor (flagged) | 2–3 days |
| 7 — Parallel run | 1 week (mostly wall-clock, little active work) |
| 8 — Cutover | 0.5 day |
| 9 — Bake | 1 week (passive) |
| 10 — Decommission | 0.5 day |

**Active engineering ≈ 8 days. Total elapsed ≈ 3 weeks** to include the two bake windows.

---

## First commits

When you're ready to start, I'd do these in order as individual PRs:
1. Move `src/utils/tipoutCalculations.ts` + `src/utils/reportCalculations.ts` → `src/lib/`, no other changes. Green CI. This is a no-op mechanically but it's the foundation for Phase 4.
2. Add `tests/parity/` with captured fixtures from current prod + a diff runner wired into CI.
3. Scaffold `convex/` with schema only. No functions yet.
