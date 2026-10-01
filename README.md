This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Convex migration

Read the [current cutover runbook](docs/CONVEX_CUTOVER_RUNBOOK.md) before deploying the successor or moving data. The original migration plan is historical design, not proof that dual writes or rollback exist.

- `npm run migrate:convex -- --help`: protected snapshot export, dry-run reconciliation, and explicitly gated insert-only apply
- `npm run parity:reports`: read-only report parity audit; requires an isolated/read-only source or a coordinated freeze and verified source/target identities
- `npm run test:backfill`: offline migration safety tests
- `npm run typecheck`: standalone type checking (the existing Next build skips types and lint)

Never commit source/target exports, migration reports, checkpoints, backup files, or credentials. The runner requires private artifacts outside the checkout. A successful frontend build is not evidence of a matching Convex backend deployment or a completed data migration.
