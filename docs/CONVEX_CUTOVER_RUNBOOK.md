# Tipout migration and same-URL cutover runbook

Status: preparation, not a completed migration. No production data import, domain change, or final cutover is recorded by this document. The legacy app remains the system of record until all gates below pass and the owner explicitly approves the switch.

## Verified code and deployment evidence (2026-10-01)

- Repository: `KyleKincer/tipout`; legacy `main` initially `7693aa7`; Convex successor `convex-migration` initially `7d277d5`
- GitHub deployment checks identify Vercel team `kylekincers-projects`, legacy project `tipout`, successor project `tipout-convex`
- Existing successor build: https://vercel.com/kylekincers-projects/tipout-convex/jgqwzMyER8dB6dKwbBwvSBXwZwpH
- Existing legacy build: https://vercel.com/kylekincers-projects/tipout/5nZVZF5XNfcpGST5EffS1osskHeN
- The desired customer URL is `https://tipout.kylekincer.com`. Its current Vercel domain assignment, live deployment IDs, source Postgres project/database, target Convex project/deployment, and Clerk instance must be verified in their authenticated dashboards before any data movement
- A successful Vercel frontend build does not prove that matching Convex functions/schema were deployed or that data was migrated
- The old `MIGRATION_PLAN.md` is historical design, not implementation evidence. This branch removed the Prisma API routes and does not implement a `NEXT_PUBLIC_USE_CONVEX` flag, dual writes, a reverse ETL, or a maintenance/write-freeze control. Do not rely on flipping a flag as rollback

## Non-negotiable invariants

1. Preserve every source entity and foreign key, all inactive employees, all closed/historical configs, pool-only configs, exact millisecond timestamps, and original source IDs
2. Never recalculate or rewrite historical money during ETL. Preserve raw Postgres decimal strings in the restricted snapshot; map operational numbers exactly as the existing app does with `Number(decimal)`
3. Preserve the existing calculator order, effective-date inclusivity, daily grouping, per-field rounding, and runtime timezone. This migration is not an opportunity to change payroll rules
4. Role base pay is stored on `Role` in the actual schema, not time-versioned in `RoleConfig`. Preserve that source value and existing behavior; do not invent historical wage-rate records that the source does not contain
5. All shifts for a day enter report pooling before the employee display filter is applied. The Shifts page describes outgoing amounts as `tipout paid`; incoming allocation and payroll totals belong in Reports
6. Do not silently merge employees or roles by name. Different people may share names. Reconcile using source IDs and explicit legacy-to-Convex maps
7. No anonymous payroll reads. Clerk issuer/application and role claims must match the current production account boundary. This app is not multi-tenant: verify that the production Clerk app is restricted to the intended workforce before importing payroll
8. No deletion/overwrite of existing target data on mismatch. A conflict is a stop condition requiring review

## Access and backup gate, before any import

Use an already authorized machine/session with existing credentials; never put credentials, payroll exports, user lists, or snapshot contents in GitHub, chat, build logs, screenshots, or browser URL parameters. Do not create new deploy keys, OAuth grants, account access, or security settings without separate approval.

Record a restricted migration manifest containing:

- Source owner/project, database and schema, source fingerprint, source application commit and runtime timezone
- Target owner/project, exact Convex deployment URL/name/environment, frontend project/branch, target code commit and schema protocol version
- Exact Clerk production instance/issuer, existing public metadata role claim shape, production sign-in/callback/verification domains
- Source `pg_dump` backup timestamp and SHA-256, restore-test result; destination Convex export timestamp and SHA-256, restore-test result where supported
- Snapshot start/end, consistent read transaction, row counts and checksums, source schema hash, immutable snapshot hash; keep raw decimal strings and timestamps
- Who verified each identity and backup, and the explicit intended destination; URLs alone do not prove account ownership

Take a restorable Postgres backup including schema and all app tables; verify it by restoring to an isolated database. Take a full export of the existing target before altering it. Restrict files to the migration operator, encrypt persistent backups using approved storage, and retain them through acceptance and the agreed retention window. Do not assume the workspace copy is a durable backup.

The migration export must run a read-only, repeatable-read transaction. Never run Prisma migrations, schema resets, seed scripts, or database cleanup against the live source. A snapshot export is additional evidence, not a replacement for a restorable database backup.

## Exact entity mapping

| Source | Target | Identity and relationships | Values to preserve |
|---|---|---|---|
| `Role` | `roles` | Source `id` -> `legacyId`; generated target `_id` mapped explicitly | `name`, `basePayRate`, `createdAt`, `updatedAt` |
| `Employee` | `employees` | Source `id` -> `legacyId`; nullable `defaultRoleId` remapped through Role | `name`, `active`, exact null/default relation, timestamps |
| `RoleConfig` | `roleConfigs` | Source UUID -> `legacyId`; `roleId` remapped | Exact `tipoutType` including `''` for pool-only membership; percentage; effective start/end; pays/receives; distribution and tip-pool group; timestamps |
| `Shift` | `shifts` | Source `id` -> `legacyId`; `employeeId` and `roleId` remapped | Date, hours, cash/credit tips, liquor sales, timestamps |

Import order: roles, employees, role configs, shifts. Tip-pool groups are derived from configs; there is no separate source group table. Clerk users, invitations, passwords, sessions, MFA and admin roles stay in the SAME Clerk production instance; do not export/recreate accounts as payroll employees. No source attachment/storage table appears in this Prisma schema, but inspect the deployed source for manual tables, triggers or integrations before declaring the inventory complete.

## Backfill procedure and checks

Use `scripts/migrate-to-convex.ts` with its default non-mutating validation path first. Read the runner's usage/requirements rather than copying old example commands from the design plan. Apply is gated by explicit identity, backup, snapshot and write-freeze checks. Its safe operation is insert-only plus identical-row skips. It fails on conflicting rows, extra target rows, duplicate legacy IDs, missing relations, unsupported values, or mismatched identities; it never deletes or silently overwrites a target row.

1. Deploy and verify the corrected backend schema/auth/functions in the existing isolated successor deployment; frontend and backend must name the same target
2. Check anonymous queries fail, signed-in authorized reads succeed, and unauthorized writes fail before adding sensitive rows
3. Capture one source snapshot, validate raw values and all relations, create its checksum and aggregate manifest
4. Read and reconcile the existing target. If it is populated, stop on conflicts/extras; do not wipe it or assume that its data is disposable
5. Apply the approved snapshot in FK order, with per-row transactions and stable `legacyId` lookup. Resume only against the same manifest. A duplicate run must insert zero rows and change zero fields
6. After any interrupted or ambiguous call, reread and reconcile. Do not infer import success from the number of completed requests
7. Reconcile all four tables row by row, including creation/update timestamps, nullable fields and mapped FKs; require zero mismatches, zero dangling relations, zero duplicates and zero unexplained target extras
8. Compare exact raw decimal aggregates from source snapshot against canonical target numeric values, and compare full payroll report output independently. Aggregate equality alone cannot prove individual employee correctness
9. Obtain the actual payroll-period calendar from the payroll owner; do not assume weekly/biweekly boundaries. Run the unchanged legacy and Convex report paths for every historical pay period, every distinct day, representative overlapping ranges, and each employee. Include empty periods, multiple shifts/roles, inactive employees, duplicate names, mixed cash/credit, zero hours, no recipients, pools, and every config effective-date boundary
10. Compare all numeric result fields at their actual output precision, arrays keyed by stable employee/role identity, and summary/role-config shapes. No tolerance that can hide a penny error. Do not log payroll values on failure; record counts and field paths in restricted artifacts
11. Have the payroll owner compare the last completed payroll and current open period, including cents and hours. Record acceptance and the exact commits/snapshot checksums

A backfill taken while legacy writes continue is a rehearsal, not the final cutover state. The current apply tool requires the source snapshot to be unchanged; do not make that acknowledgement while production writes continue. Use a restored immutable source for rehearsal or an actual coordinated source freeze. The current insert-only runner intentionally rejects changed or deleted source rows on a subsequent snapshot; that protects history but does not implement delta synchronization.

## Work required before a seamless cutover

These are release gates, not promises that the current branch already implements them:

- **Legacy links:** support old CUID/UUID URLs and employee query filters through `legacyId` resolution for `/shifts/:id/edit`, `/employees/:id/edit`, `/roles/:id/edit`, Reports/Shifts employee filters and any saved bookmarks. Current Convex `v.id` validators accept native IDs only. Add dual-ID lookup/resolution and automated end-to-end tests before switch
- **Permissions:** verify the existing role matrix for anonymous, invited/signed-in staff, admin and revoked users. Legacy lets signed-in staff open New Shift; the successor currently requires admin in `shifts.create`. Resolve this parity mismatch explicitly and test with real Clerk accounts, without changing workforce access accidentally
- **Dates/history:** confirm runtime UTC and source date convention from actual data; test DST/local display boundaries without changing source instants. Preserve full historical config timestamps; active-rate changes must close old rows rather than rewrite history
- **Write freeze:** implement a server-enforced legacy write gate covering all API routes/server actions, not just a banner; verify existing browser tabs and in-flight requests cannot write after the barrier. Keep successor writes disabled during migration checks
- **Delta catch-up:** implement audited compare-and-swap updates from the previous imported snapshot to the final snapshot, refusing any independently changed target. Detect deleted source IDs and handle them through an explicitly reviewed migration policy; the current runner does not perform deletion. Alternatively prepare an approved empty target for the final complete import, preserving the rehearsal target and backups. Do not improvise a destructive replace
- **Rollback after new writes:** implement and rehearse a lossless reverse export/import or durable validated reverse-write journal. A frontend rollback alone would hide all Convex-only shifts and config changes
- **Operational parity:** verify all app routes, Back/Forward, deep links, new/edit/delete flows, filters, repeat submissions, role changes, invitations, sign-in redirects and old open tabs. The removed `/api/*` routes need compatibility only if actual integrations call them; inventory those callers first
- **Scale and order:** large report queries currently collect a date range and role configs into memory. Test the largest historical range against Convex query limits. Detect ambiguous overlapping configs and unspecified same-day ordering using real parity results; do not reorder payroll inputs speculatively

## Exact switch sequence (requires a separate go-ahead)

Preferred route: keep the customer domain on the existing Vercel `tipout` project and promote a validated Convex-backed release into that project. This avoids changing bookmarks and usually avoids a DNS change; verify Vercel's actual project/branch/deployment restrictions first. An alternative is reassigning the same custom domain to `tipout-convex`, but only after verifying ownership, TLS, redirects and rollback of domain assignment. Do not change the domain now.

1. Publish the tested candidate at an isolated preview URL and verify it against the intended Convex deployment. Keep the old production release immutable and record its deployment ID
2. Rehearse the complete sequence on restored source data, including the rollback path, and measure the time needed. Announce only a measured write-pause window, not an invented 60-second guarantee
3. At the agreed quiet period, enable the server-side legacy write freeze. Drain in-flight requests, record the barrier time/commit, verify writes are rejected, and keep reads available with a brief banner
4. Take the final read-only consistent source snapshot and backup. Apply the reviewed delta or approved final full import. Keep both stores frozen while reconciling all records and all impacted payroll periods
5. If any gate fails, abort the switch: legacy still owns the domain and source of truth. Unfreeze it only after confirming no unintended source mutation. Keep target/snapshots for diagnosis
6. With reconciliation green, deploy/promote the candidate on `tipout.kylekincer.com`, preserving the same Clerk instance, origin, cookie/session configuration, sign-in paths, route names and callback URLs. Verify TLS and no unexpected redirects
7. Test a pre-existing signed-in session, an incognito login, old saved links, current report, permitted staff entry and admin edit. A seamless migration aims to retain sessions, but cannot promise zero reauthentication without this real-browser proof
8. Establish one authoritative write store. Enable Convex writes only after the switch barrier and rollback capture are ready; leave legacy writes blocked to prevent split-brain writes from old browser tabs
9. Observe create/edit/delete, reports, auth, error rates and the reverse-write/export journal. Reconcile daily and through the first completed payroll cycle; obtain payroll-owner sign-off before retiring the legacy system

## Rollback without losing post-cutover work

- Before Convex accepts new writes: return the customer domain/deployment to the recorded legacy release, verify source unchanged, and release its write freeze
- After Convex accepts new writes: freeze BOTH write paths first; export all Convex changes (including edits/deletes/config history), reconcile and apply them to Postgres through the rehearsed reverse path, verify payroll/IDs/FKs, then restore the legacy deployment and unfreeze. Never simply flip the frontend back to stale Postgres
- If reverse reconciliation is not ready or fails, stay frozen/read-only and repair forward; preserve both stores and the complete write journal. This is safer than losing submitted shifts
- Retire neither database, old deployment nor backups until the owner accepts the first Convex payroll and the agreed rollback/retention window expires. Decommissioning/deletion needs separate authorization

## Reference documentation

- Convex/Clerk auth validation and auth-ready client reads: https://docs.convex.dev/auth/clerk
- Coordinated Convex and Vercel deployment: https://docs.convex.dev/production/hosting/vercel
- Convex backup export: https://docs.convex.dev/database/import-export/export
