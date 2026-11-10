# Moving tipout from Postgres to Convex

The app can run on either database. `DATA_BACKEND=convex` (a Vercel environment variable) sends every API
route to the matching Convex function; anything else uses Postgres. Pages, URLs and API responses are the
same either way, so the switch is an environment change and a redeploy, and so is the rollback.

Both backends implement the same rules: dated role settings, pay period locks, the change log, archive
instead of delete, and sign-in on every request (admin for changes, except adding a shift).

## How the two were checked against each other (on a copy of production)

- `npm run migrate:convex -- --apply` imported all rows (insert-only, matched by Postgres ID), then ran both
  apps' report code over the full history, every month and every pay period: 0 differences of a cent or more,
  including two locked pay periods (their saved, as-paid results carry over with IDs remapped).
- All 23 read API responses (roles, each role's history, employees, shifts with filters, single shifts, pool
  groups, pay periods, change log) were identical after mapping IDs.
- Changes made in Convex (pooling off from a date, a new shift, a new employee, unlocking a period) were
  copied back with `npm run convex-to-postgres -- --apply`; afterwards both backends matched again.
- `npm run test:convex` covers access rules, dated changes, confirmations, locks, drift, delete guards, the
  change log and the importer. `src/app/api/convexAdapter.test.ts` covers the API routes in Convex mode.

## One-time setup (needs the owner's go-ahead)

1. **Clerk**: create a JWT template named `convex` in the production instance (Clerk dashboard → Configure →
   JWT templates → New → Convex). Claims:
   ```json
   { "aud": "convex", "name": "{{user.full_name}}", "email": "{{user.primary_email_address}}", "metadata": "{{user.public_metadata}}" }
   ```
   `metadata.roles` carries the admin flag, as in the session token. Until this exists, Convex mode answers
   503 "Clerk has no convex token template".
2. **Convex production deployment** (`artful-basilisk-205`, currently empty): get a fresh production deploy key
   from the Convex dashboard (the one in `.env.migration` is no longer valid), then:
   ```sh
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.tipout.kylekincer.com --prod
   CONVEX_DEPLOY_KEY=... npx convex deploy
   ```
3. **Vercel (`tipout` project)**: add `NEXT_PUBLIC_CONVEX_URL=https://artful-basilisk-205.convex.cloud`.
   Leave `DATA_BACKEND` unset, so the site keeps using Postgres.

## Cutover (a quiet hour, about 15 minutes)

1. **Pause changes.** Set `WRITES_FROZEN=1` on Vercel and redeploy. Every change now gets a 503 with a
   "paused for a few minutes" message, and pages still load.
2. **Copy the data.** Set a one-time token on Convex and run the import against production Postgres:
   ```sh
   TOKEN=$(openssl rand -hex 24)
   npx convex env set MIGRATION_TOKEN "$TOKEN" --prod
   DATABASE_URL=<prod> CONVEX_URL=https://artful-basilisk-205.convex.cloud MIGRATION_TOKEN=$TOKEN npm run migrate:convex          # dry run
   DATABASE_URL=<prod> CONVEX_URL=https://artful-basilisk-205.convex.cloud MIGRATION_TOKEN=$TOKEN npm run migrate:convex -- --apply
   ```
   It must end with `0 differences`. Anything else: stop, leave the site on Postgres, unfreeze.
3. **Switch.** Set `DATA_BACKEND=convex`, remove `WRITES_FROZEN`, redeploy. The build refuses to finish if the
   Convex backend doesn't match this code.
4. **Check while signed in**: Reports for the last pay period and this week, Shifts for a busy day, a role's
   settings history, the change log, then add and delete a test shift.
5. **Remove the token**: `npx convex env remove MIGRATION_TOKEN --prod`. Keep Postgres as is (it is the
   rollback copy) until the first payroll run on Convex has been checked.

## Rollback

1. Set `WRITES_FROZEN=1` and redeploy.
2. Copy Convex's changes back (dry run first):
   ```sh
   npx convex env set MIGRATION_TOKEN "$TOKEN" --prod
   DATABASE_URL=<prod> CONVEX_URL=... MIGRATION_TOKEN=$TOKEN npm run convex-to-postgres
   DATABASE_URL=<prod> CONVEX_URL=... MIGRATION_TOKEN=$TOKEN npm run convex-to-postgres -- --apply
   ```
3. Remove `DATA_BACKEND` and `WRITES_FROZEN`, redeploy, remove the token.

## Later

Once Convex has been the system of record through a payroll cycle: drop the Postgres branches from the API
routes, the Prisma code and the legacy tables. The pages can also move to live Convex queries, so Shifts and
Reports update the moment someone enters a shift; that needs a client-side Convex provider using the same
Clerk `convex` token.
