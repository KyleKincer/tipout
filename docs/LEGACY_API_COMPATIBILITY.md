# Legacy REST and staff-permission compatibility

Source comparison: legacy `main` commit `5dcaf2357fa79d8974d648a016b826bbd1bae3f0`; successor base `1d4efbccaf8f3e3a3fc27697e1d00acbccfb9c07`. The source API files, middleware and role-based UI did not change between the locally available legacy base and this main commit.

The adapters restore all **10 legacy route paths / 23 HTTP methods**. They use the same signed-in person's Clerk `convex` JWT and the normal Convex public functions. There is no deploy key, service identity, database fallback, dual write, data import, or DNS change in this implementation.

## Intended staff permissions

The source middleware required a signed-in user for dashboard pages, and its `AdminOnly` UI hid management actions. Its API handlers themselves had **no server authorization**. Recreating that public payroll read/write exposure is intentionally excluded.

| Operation | Signed-out | Signed-in non-admin | Admin |
| --- | --- | --- | --- |
| List/read employees, roles, role configs, shifts, reports, pool groups | 401 | Allowed | Allowed |
| Create shift (`/shifts/new`, `POST /api/shifts`) | 401 | Allowed | Allowed |
| Create/edit/delete employee | 401 | 403 | Allowed |
| Create role through standalone old roles-list form | 401 | 403 | Allowed with same-origin `/roles` referrer |
| Role-list name/pay update (`PATCH /api/roles/:id`) | 401 | 403 | Allowed |
| Delete role | 401 | 403 | Allowed; cannot delete one with shifts |
| Add/end current tipout rate | 401 | 403 | Allowed |
| Edit/delete shift | 401 | 403 | Allowed |
| Old advanced role/config save (`PUT`) | 401 | 403 | 409, reload before any write |
| New advanced role/config save | Signed-in/admin backend guards | Rejected | Atomic version-checked Convex save |
| User/invitation administration | Existing Clerk admin enforcement | Rejected | Existing Clerk admin workflow |

The non-admin shift-create exception must remain in `convex/shifts.ts`, not merely in Next adapters. The adapters enforce access through `legacyApi:checkAccess`; every underlying data query/mutation independently enforces its access rule too. A signed-in identity without an explicit `user` role still has the same staff access the legacy dashboard exposed. Admin requires the trusted JWT role claim to include `admin`.

## Endpoint contracts

All ordinary successful legacy methods remain HTTP 200. Required-field errors preserve HTTP 400 and their existing `error` or `message` envelope. Individual employee/role/shift GET preserves 404; failed updates/deletes retain the legacy generic 500 envelope. `reports` and `tip-pool-groups` errors use `message`; other routes use `error`. New safety responses are 401 (anonymous), 403 (non-admin write), 409 (unsafe stale editor), and 503 (missing token/service configuration).

| Path | Methods | Preserved contract / deliberate exception |
| --- | --- | --- |
| `/api/employees` | GET, POST | Name-sorted employee array; employee object with `defaultRole`; required name |
| `/api/employees/:id` | GET, PUT, DELETE | Legacy/native input ID; optional field updates; explicit null clears default role; `{success:true}` deletion |
| `/api/roles` | GET, POST | Exact list select fields/current configs; name/pay create response; POST restricted to known standalone old roles-list flow |
| `/api/roles/:id` | GET, PATCH, PUT, DELETE | Current configs on GET/PATCH; optional name/pay PATCH; PUT intentionally 409 before mutation |
| `/api/roles/:id/config` | GET, PUT | Full history on GET; PUT intentionally 409 before mutation |
| `/api/roles/:id/configurations` | GET, POST, DELETE | Current configs newest-first; POST forwards rate, receives/pays flags and distribution group; DELETE expires matching rates |
| `/api/shifts` | GET, POST | Inclusive UTC day/range filtering, employee CUID/native filter, exact role-name filter, descending shift dates, numeric amounts, staff creation |
| `/api/shifts/:id` | GET, PUT, DELETE | Legacy/native ID; full update validation; exact-instant config selection on GET/PUT; deletion success envelope |
| `/api/reports` | GET | Required date pair; same report calculators/shape; employee summaries use legacy IDs; pool calculations include all employees |
| `/api/tip-pool-groups` | GET | Distinct nonempty group names |

### Identity, numeric and date details

- Imported employee/role/shift/config rows return the original CUID/UUID as `id` in these REST responses. New rows return native IDs. Input IDs can be either form.
- Foreign keys and nested `employee`, `defaultRole`, `role`, `configs`, and report `employeeId` values are mapped consistently. Native-only metadata added for the new UI is omitted. Employee names and pool-group strings are never used to identify rows or globally rewritten.
- Unknown IDs do not silently match names. Duplicate legacy mappings fail closed. Missing mapped response identities return an error instead of mixing native and old identities.
- Legacy raw employee `defaultRole.basePayRate`, `/config` rates, and `/configurations` rates remain JSON **strings**, as Prisma Decimal serialization produced. Role/shift/report numeric fields remain numbers.
- Legacy shift list/create returned open configs plus any closed configs overlapping the requested day/range; this is different from single-shift GET/PUT's exact-instant overlap. The adapter explicitly retains this distinction.
- A missing employee filter returns an empty shift list; a missing role config GET returns an empty array. Dates remain UTC and inclusive at day end.
- All responses are dynamic, private, and `no-store`.

## Why old advanced role editors must refresh

An already-open legacy advanced editor sends `PUT role` followed by `PUT configs`, has no trustworthy original revision, and truncates configuration timestamps to dates. Replaying it would either partially update the role, reopen stale history/delete newer rates, or lose historical timestamp precision.

Both PUT endpoints therefore reject before any mutation with 409 and clear reload guidance. The old advanced **new** editor sends `POST role` then `PUT configs`; to stop the first half too, REST role POST accepts only the recognized standalone list form with a same-origin `/roles` (or `/roles/`) referrer. Missing/referrer-stripped/direct API calls, advanced-new editors, and other referrers get 409 before creation. The referrer is a restrictive compatibility check, never an authorization grant; Clerk/Convex admin authorization remains mandatory.

This is a deliberate safety difference, **not literal one-to-one behavior for every cached client**. Admins must refresh all old role-editor tabs at cutover. New UI uses one version-checked mutation for role plus configs. Do not generate a fresh revision server-side to force an old payload through. The user should be told about the refresh requirement before authorizing final URL cutover.

## Remaining verification gates and limitations

1. Deploy these Convex functions and the matching Next frontend as one compatible release. A frontend build does not deploy `legacyApi` or prove its handlers are live.
2. Preserve/verify the production Clerk instance, issuer, session cookie domain, frontend origin and `convex` JWT template. Template role claims must match `metadata.roles` or `publicMetadata.roles`, and the Convex issuer/audience must accept them. Same URL alone does not prove an existing tab stays authenticated.
3. Verify one real staff identity and one admin identity. Test all reads, staff shift creation, staff-denied management writes, anonymous 401, legacy CUID bookmarks/filters, and admin edit/delete on nonproduction fixtures. Check existing and new role editors receive 409 **with zero changed rows** when running the old bundle.
4. Live strict validators, Convex transaction conflicts, session refresh/revocation, production networking, real dataset completeness and report parity were not proven by mocked/offline tests.
5. The identity/config projection is read after ordinary Convex mutations. If that read fails after the mutation committed, REST may return generic 500 even though the write succeeded. The adapter never retries mutations automatically. Inspect existing records before retrying an ambiguous POST; 500 is **not** a no-write guarantee. Network loss had similar ambiguity historically, but these adapters add a projection-read failure point.
6. Unsupported historic configuration types must fail the source-data audit before import. The successor schema only permits the known empty/bar/host/sa types; these adapters do not invent new enum mappings.
7. Unversioned old employee/shift edits and role-list PATCH retain legacy last-write-wins behavior. New advanced role/config edits specifically prevent stale loss using complete original snapshots.
8. The integrated branch fixes the baseline Next 15 admin searchParams type and enables release type/lint checks. Run the aggregate verify command and an offline build after integration; these still do not prove real authentication or deployed data parity.

## Offline evidence

- Focused adapter/helper suite: 89 tests at initial delivery, covering all 23 anonymous method checks, all restricted staff mutations, all staff GETs, staff shift create, ordinary admin operations, identity/shape/numeric/date contracts, pre-write stale-editor rejection, backend helper ACLs, duplicate IDs, inclusive closed-history overlap, bounded ID batches, and post-mutation projection failure without retry.
- Production Next build with synthetic public Convex/Clerk values: passes; all 10 API paths compile as dynamic routes. No real authentication, private data or deployed backend was used.
- Standalone TypeScript check before generated build types: passes. Post-build check exposed only the pre-existing `/admin` `searchParams` mismatch noted above; integration must re-run after fixing it.
- Focused lint on all new adapter/helper/route/test files: passes. Full pre-integration suite: 189 passed / 5 failed; the five failures are unchanged legacy calculation fixtures in `reportCalculations.test.ts` and `tipoutCalculations.test.ts`, owned by the integration work. Re-run the complete suite against the final integrated commit; do not treat this checkout as globally green.

See [the overall parity acceptance matrix](CONVEX_PARITY_MATRIX.md) and [backend-first cutover runbook](CONVEX_CUTOVER_RUNBOOK.md) for final integrated evidence and remaining live gates. The offline counts above describe the isolated adapter delivery, not the final integrated test count.
