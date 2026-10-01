# Convex replacement acceptance matrix

This is an evidence checklist, not a claim of production equivalence. The actual payroll-data migration and authenticated production tests have not been run. Keep `tipout.kylekincer.com` on the legacy deployment until every live gate is accepted.

| Area | Implemented / offline evidence | Required live acceptance |
|---|---|---|
| Shift/report numbers | Shifts consumes the same complete-day report calculation: signed received-minus-paid tipouts, original gross credit, pooled cash/credit, payroll tips and tip rates; original shift IDs prevent duplication | Compare every displayed day/range, employee/role filter, pooled role and multiple-shift employee with the deployed legacy app |
| Report algorithms | Existing daily formulas extracted into one shared per-shift calculation, then aggregated without changing precision or summary formulas; corrected calculation assertions also pass directly against untouched legacy functions | Every real historical payroll period, every employee/role, effective-date boundary and largest date range match |
| Employee report filter | Allocate across all daily shifts first; filter only presentation | Real multi-role and pooled employee examples including duplicate names |
| Historical role configs | Empty pool-only configs, closed history and exact timestamps preserved; rate changes close prior records | Actual source history and overlapping-config ordering reconcile |
| Stale role editors | Atomic role+configs save with original complete version snapshot; stale edits rejected before writes | Two real admin sessions, simultaneous edits/end-current, cancel/retry/new-role flows |
| Reactive drafts | Existing shift role and employee drafts survive data refresh; employee save uses version conflict check | Real live refresh, same-session navigation and Back/Forward smoke tests |
| Old bookmarked IDs | Exact legacy/native lookup; old employee filter aliases; missing shift reaches Not found | Saved employee/role/shift URLs and filters from the current app |
| Staff permissions | Signed-in staff create shifts; admin-only edit/delete/management; anonymous data access denied | Real staff, admin and revoked sessions with production Clerk issuer/template |
| Existing REST paths | 10 paths / 23 methods; legacy IDs/FKs, Decimal strings, dates and response envelopes covered | Old signed-in cached app/API callers against the deployed backend |
| Old advanced role-editor tabs | Deliberate 409 before unsafe role/config writes; no server-invented revision | Admins must refresh those old tabs before the final switch; see API compatibility document |
| Source export | Read-only repeatable-read; raw decimal/timestamp archive; source fingerprint includes pooled database principal | Verify actual DB/project owner, restored backup and source schema inventory |
| Backfill | Dry-run default; gated insert-only apply; exact skips; conflicts, missing FKs, extras and uncertain writes stop | Source/target counts, all row hashes, aggregates, full payroll reports and owner sign-off |
| Release build | Full source lint, standalone types and tests; build type/lint checks enabled | Matching backend contract and real Clerk/Convex login must pass |
| Backend/frontend coordination | Public metadata-only exact contract gate fails closed before a frontend build | Deploy verified backend first, confirm ownership and permissions, then rebuild frontend |
| Same URL/session | Customer domain unchanged so far; backend-first/domain promotion sequence documented | Verify domain assignment, TLS, original Clerk app/cookies/callbacks and old active session |
| Final writes/rollback | Procedure documented, not implemented as a production feature flag or dual-write system | Server write freeze, reviewed delta/deletion handling and tested lossless reverse path before accepting new primary writes |

## Why five pre-existing calculator tests changed

The original correction did not change payroll formulas. The later Shifts alignment extracts the existing daily processing into a shared function and keeps the aggregation formulas unchanged. The old tests contradicted their fixtures or the unchanged legacy implementation:

- No host present means no host payout; positive host-presence and cross-day coverage was added
- Fractional multiplication is asserted with numerical tolerance rather than exact `14` versus `14.000000000000002`
- A fixture's unused `shift.configs` field did not override its actual `role.configs` rate of 25%
- Pool net credit is distributed after pool deductions, then each individual's bar payment is deducted; the stale expectations double-deducted money and incorrectly hid Host/SA values
- Fixture pool membership, null semantics and Host/SA base-wage rates now match the actual source fixture

The corrected calculation suites passed against the unchanged legacy modules as well as the Convex-shared modules. This is valuable regression evidence, but synthetic tests cannot replace comparing the user's real source and target payroll data.

## Deliberate safety differences and remaining limits

- Legacy API handlers lacked server authentication. The replacement deliberately enforces the permissions the legacy signed-in UI intended; anonymous payroll read/write exposure is not reproduced
- Unversioned old advanced role/config saves cannot safely replay truncated/stale history. They receive a clear refresh response before mutation. This is an explicit exception to literal old-tab behavior and must be communicated before the final URL switch
- A network or response-projection failure can be ambiguous after an ordinary mutation commits. The adapters do not automatically retry writes. Check the stored row before retrying an ambiguous POST; a 500 is not proof that nothing was written
- A successful offline build skips remote compatibility only when explicitly requested locally. It proves compilation, not deployment, authentication, data completeness, or runtime behavior
- No source/target payroll export has been published, no live backfill has been run, and no final cutover/DNS change is authorized by this checklist

## Per-shift display precision

Shifts is still one row per original work shift, while Reports groups by employee/role across the selected days. The per-shift row uses its original share of the daily pool, never a duplicated employee summary or a newly invented allocation. Every daily contributor participates before the Shifts employee/role filters hide rows.

Existing payroll precision is preserved: Reports aggregates unrounded allocations, then rounds its summary. Shifts formats each row to cents. Three shifts receiving one third of a dollar each display $0.33, while their Reports total is $1.00. The underlying allocations still sum to $1.00; the implementation does not redistribute pennies or change payroll to force rounded row labels to add up. Effective-date checks, configuration precedence and zero-hour behavior remain the existing report behavior.

This release requires backend contract `tipout-shift-report-2026-10-01-v3`, because `reports.get` now returns `shiftResults`. Deploy the matching backend before rebuilding the frontend; the gate must not be bypassed. The compatibility REST adapter maps each shift and employee ID to its legacy identity, and the protected parity harness compares these per-shift results as well as summary totals.

## Existing wage aggregation ambiguity

The source schema permits distinct roles with the same name. Reports groups by employee ID plus role name, then applies the last encountered base rate to all grouped hours. That pre-existing behavior is intentionally unchanged. Shifts does not introduce a per-shift base-pay, all-in hourly wage or wage-inclusive payroll-total column, because those could disagree with the existing grouped report. Inventory duplicate role names/rates and reconcile their real historical Reports results before cutover; any wage-policy correction needs a separately reviewed decision.

## Report payload size

Returned shift rows contain compact identity/label and financial fields, not a copy of complete role-configuration history per shift. A 2,000-shift/50-config synthetic regression stays below 2 MiB. This is a guard against avoidable payload amplification, not a guarantee for arbitrary historical ranges; the largest real report/date range still needs live Convex limit testing.
