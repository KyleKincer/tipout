#!/usr/bin/env -S npx tsx
/**
 * Controlled, insert-only Postgres → Convex backfill. Default is dry-run.
 *
 * 1. Export ONE read-only REPEATABLE READ Postgres transaction, preserving
 *    every scalar field, raw decimal text, exact timestamp(3), and foreign key.
 * 2. Dry-run against the immutable archive. Every row, relationship, table hash,
 *    and exact decimal aggregate is reconciled. No mutations are called.
 * 3. Apply only with explicit identities, independently hashed source/target
 *    backups, freeze/restore attestations, and matching server-side gates.
 *
 * Run --help for the complete options. Never deploys, deletes, patches, changes
 * credentials, or runs Prisma schema migrations. A partial import stays partial
 * until a safe rerun; there is deliberately no destructive automatic rollback.
 */
import { PrismaClient } from "@prisma/client";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { realpath } from "node:fs/promises";
import {
  BackfillError, MAX_ROWS, TABLES, assertCheckpoint, canonical, emptyTables,
  normalizeSource, normalizeTarget, reconcile, requireSafe, rowKey, sha256,
  sourceIdentity, targetIdentity, validateSnapshot,
} from "./lib/backfill";
import type { Checkpoint, Row, Table, Tables } from "./lib/backfill";
import { exportSource } from "./lib/backfill-source";
import { hashFile, readPrivateJson, verifyBackup, writePrivateJson } from "./lib/backfill-files";

const HELP = `Tipout protected backfill (all local artifacts contain private data)

Export only (does not connect to Convex):
  DATABASE_URL=... npm run migrate:convex -- --export /private/absolute/snapshot.json

Default dry-run (requires CONVEX_URL and CONVEX_DEPLOY_KEY):
  npm run migrate:convex -- --snapshot /private/absolute/snapshot.json --report /private/absolute/dry-run.json

Apply additionally requires ALL of:
  --apply
  --expect-source <sourceFingerprint printed by export>
  --expect-target <exact https://deployment.convex.cloud origin>
  --snapshot-sha256 <independently recorded archive file SHA-256>
  --source-backup <absolute path> --source-backup-sha256 <SHA-256>
  --target-backup <absolute path> --target-backup-sha256 <SHA-256>
  --checkpoint <absolute path; keep this same file for every rerun>
  --ack-source-unchanged --ack-target-frozen --ack-restore-tested

Acknowledgements mean the source has not changed since snapshot export, all
non-ETL target writes remain paused through final verification, both backups
belong to these identities, and restoration has been tested. The script verifies
file hashes, NOT backup restorability or the truth of these attestations.

Separately configure the intended Convex deployment before apply:
  TIPOUT_ETL_ENABLED=true
  TIPOUT_ETL_SOURCE_FINGERPRINT=<snapshot sourceFingerprint>
  TIPOUT_ETL_SNAPSHOT_SHA256=<snapshot logical checksum printed by export>
Disable TIPOUT_ETL_ENABLED after verification. Deploying code/setting these
variables is an operator action, never performed by this script.

Use a read-only PostgreSQL account. Set env vars through your secret manager;
never paste credentials into logs or source control. Artifacts are mode 0600,
created exclusively outside the current checkout. Keep them and the checkpoint
in private backed-up storage. No row values, payroll amounts, or raw errors are
printed. New --report paths are required for every run; checkpoints alone update.

Target reads are paginated and are NOT one global snapshot: two full scans plus
a maintained write freeze are required for apply. Every mutation checks the
current row atomically and refuses any difference, including newer timestamps.
Extras/native rows and disappeared checkpoint rows require a separately reviewed
merge. An unresolved absent pending write stops for review. Do not erase the
checkpoint to bypass a deletion/uncertain-write stop.

Limits: 100,000 rows total, 128 MiB snapshot, five-minute source transaction.
Binary64 numbers must round-trip to the original decimal value; raw decimals
remain archived. Unsupported precision/schema/role values stop before writing.
`;
const VALUE_FLAGS = ["export", "snapshot", "report", "expect-source", "expect-target", "snapshot-sha256", "source-backup", "source-backup-sha256", "target-backup", "target-backup-sha256", "checkpoint"];
const BOOL_FLAGS = ["apply", "dry-run", "help", "ack-source-unchanged", "ack-target-frozen", "ack-restore-tested"];
export function parseArgs(argv: string[]): Record<string, string | true> {
  const result: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    requireSafe(VALUE_FLAGS.includes(flag) || BOOL_FLAGS.includes(flag), "Unknown argument; run with --help");
    requireSafe(!(flag in result), "Duplicate argument; run with --help");
    if (BOOL_FLAGS.includes(flag)) result[flag] = true;
    else {
      const value = argv[++i];
      requireSafe(value && !value.startsWith("--"), "Missing argument value; run with --help"); result[flag] = value;
    }
  }
  requireSafe(!(result.apply && result["dry-run"]), "Choose apply or dry-run, not both");
  requireSafe(!(result.export && (result.apply || result.snapshot)), "Export is a separate read-only phase");
  return result;
}

async function readTarget(client: ConvexHttpClient): Promise<Tables> {
  const rows = emptyTables();
  let total = 0;
  for (const table of TABLES) {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    while (true) {
      const result: { page: Row[]; isDone: boolean; continueCursor: string } = await client.query(anyApi.etl.auditPage, { table, paginationOpts: { cursor, numItems: 250 } });
      requireSafe(Array.isArray(result.page) && typeof result.isDone === "boolean", "Invalid target audit protocol");
      rows[table].push(...result.page); total += result.page.length;
      requireSafe(total <= MAX_ROWS, "Target exceeds supported 100,000-row safety limit");
      if (result.isDone) break;
      requireSafe(typeof result.continueCursor === "string" && !cursors.has(result.continueCursor), "Target pagination did not advance");
      cursor = result.continueCursor; cursors.add(cursor);
    }
  }
  return rows;
}
function rowHashes(expected: Tables, actual: Tables) {
  return Object.fromEntries(TABLES.map(table => {
    const actualMap = new Map(actual[table].map(row => [row.legacyId, row]));
    const sourceIds = new Set(expected[table].map(row => row.legacyId));
    return [table, [
      ...expected[table].map(row => ({ key: rowKey(table, row), expected: sha256(canonical(row)), actual: actualMap.has(row.legacyId) ? sha256(canonical(actualMap.get(row.legacyId))) : null })),
      ...actual[table].filter(row => !sourceIds.has(row.legacyId)).map(row => ({ key: rowKey(table, row), expected: null, actual: sha256(canonical(row)) })),
    ]];
  }));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const value = (name: string) => typeof args[name] === "string" ? args[name] as string : undefined;
  if (args.help) { console.log(HELP); return; }
  if (value("export")) {
    requireSafe(process.env.DATABASE_URL, "DATABASE_URL is required for source export");
    const source = sourceIdentity(process.env.DATABASE_URL);
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [] });
    try {
      const snapshot = await exportSource(prisma, source);
      await writePrivateJson(value("export")!, snapshot);
      console.log(JSON.stringify({ status: "source-archived-read-only", sourceFingerprint: snapshot.sourceFingerprint, snapshotChecksum: snapshot.checksum, archiveSha256: await hashFile(value("export")!), counts: Object.fromEntries(TABLES.map(t => [t, snapshot.tables[t].length])) }));
      validateSnapshot(snapshot);
      console.log("Archive validated for target dry-run. No target connection was made.");
    } finally { await prisma.$disconnect(); }
    return;
  }
  requireSafe(value("snapshot") && value("report"), "Specify --snapshot and a new --report path, or --export; run with --help");
  const { data, bytes } = await readPrivateJson(value("snapshot")!);
  const snapshot = validateSnapshot(data);
  const expected = normalizeSource(snapshot.tables);
  const configuredUrl = process.env.CONVEX_URL;
  requireSafe(configuredUrl && process.env.CONVEX_DEPLOY_KEY, "CONVEX_URL and CONVEX_DEPLOY_KEY are required (no implicit frontend URL fallback)");
  const url = targetIdentity(configuredUrl);
  let backups: { source: string; target: string } | null = null;
  if (args.apply) {
    requireSafe(value("expect-source") === snapshot.sourceFingerprint, "Explicit source fingerprint does not match archive");
    requireSafe(value("expect-target") === url, "Explicit target origin does not match CONVEX_URL");
    requireSafe(value("snapshot-sha256") === sha256(bytes), "Explicit snapshot file SHA-256 does not match archive");
    requireSafe(args["ack-source-unchanged"] && args["ack-target-frozen"] && args["ack-restore-tested"], "Apply requires source-unchanged, target-write-freeze, and tested-restore acknowledgements");
    requireSafe(value("checkpoint"), "Apply requires a durable checkpoint path, reused on every rerun");
    backups = { source: await verifyBackup(value("source-backup"), value("source-backup-sha256")), target: await verifyBackup(value("target-backup"), value("target-backup-sha256")) };
    const paths = await Promise.all([value("snapshot")!, value("source-backup")!, value("target-backup")!].map(p => realpath(p)));
    requireSafe(new Set(paths).size === 3 && backups.source !== sha256(bytes) && backups.target !== sha256(bytes), "Archive and independent source/target backups must be distinct files");
  }
  // Disable server-side console messages from the client's logger. Service
  // exceptions may contain names, row values or tokens and are never printed.
  const client = new ConvexHttpClient(url, { logger: false });
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(process.env.CONVEX_DEPLOY_KEY!);
  const identity = await client.query(anyApi.etl.identity, {});
  requireSafe(identity.protocolVersion === 1 && identity.deploymentUrl && targetIdentity(identity.deploymentUrl) === url, "Connected target identity/protocol mismatch");
  if (args.apply) requireSafe(identity.enabled && identity.sourceFingerprint === snapshot.sourceFingerprint && identity.snapshotChecksum === snapshot.checksum, "Target backfill gate is disabled or does not match the approved source/snapshot");

  const first = await readTarget(client);
  const raw = await readTarget(client);
  requireSafe(canonical(first) === canonical(raw), "Target changed during preflight; pause all target writers and repeat dry-run");
  const actual = normalizeTarget(raw);
  const before = reconcile(expected, actual);
  const report = { version: 1, mode: args.apply ? "apply" : "dry-run", phase: "preflight", createdAt: new Date().toISOString(), sourceFingerprint: snapshot.sourceFingerprint, snapshotChecksum: snapshot.checksum, archiveSha256: sha256(bytes), targetUrl: url, backups, before, rowHashes: rowHashes(expected, actual) };
  await writePrivateJson(value("report")!, report);
  console.log(JSON.stringify({ mode: report.mode, tables: before.tables, wouldInsert: before.insert, conflicts: before.conflicts, extras: before.extras, aggregatesMatch: before.aggregatesMatch }));
  requireSafe(before.conflicts === 0 && before.extras === 0, "Reconciliation found changed or extra target rows; stop for a reviewed merge, never overwrite/delete");
  if (!args.apply) { console.log("Dry-run finished. No mutation was called. Financial totals and row hashes are in the protected report."); return; }

  const checkpointPath = value("checkpoint")!;
  let checkpoint: Checkpoint;
  try {
    checkpoint = (await readPrivateJson(checkpointPath)).data as Checkpoint;
    assertCheckpoint(checkpoint, snapshot, url, actual);
    if (checkpoint.pending) { checkpoint.confirmed.push(checkpoint.pending); checkpoint.pending = null; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    checkpoint = { version: 1, snapshotChecksum: snapshot.checksum, targetUrl: url, confirmed: [], pending: null };
    await writePrivateJson(checkpointPath, checkpoint);
  }
  checkpoint.confirmed = [...new Set([...checkpoint.confirmed, ...TABLES.flatMap(t => actual[t].map(row => rowKey(t, row)))])];
  await writePrivateJson(checkpointPath, checkpoint, true);
  const gate = { sourceFingerprint: snapshot.sourceFingerprint, snapshotChecksum: snapshot.checksum, targetUrl: url };
  const functionNames: Record<Table, string> = { roles: "upsertRole", employees: "upsertEmployee", roleConfigs: "upsertRoleConfig", shifts: "upsertShift" };
  let inserted = 0;
  for (const table of TABLES) {
    const present = new Set(actual[table].map(row => row.legacyId));
    for (const row of expected[table]) {
      if (present.has(row.legacyId)) continue;
      // Persist intent before calling the server. An uncertain response can be
      // resumed only when that exact row exists; never blindly recreate it.
      checkpoint.pending = rowKey(table, row);
      await writePrivateJson(checkpointPath, checkpoint, true);
      await client.mutation(anyApi.etl[functionNames[table]], { migration: gate, ...row });
      checkpoint.confirmed.push(checkpoint.pending); checkpoint.pending = null;
      await writePrivateJson(checkpointPath, checkpoint, true);
      inserted++;
    }
  }
  const finalRaw = await readTarget(client);
  requireSafe(canonical(finalRaw) === canonical(await readTarget(client)), "Target changed during final verification; retain checkpoint and backups, stop for review");
  const final = normalizeTarget(finalRaw);
  assertCheckpoint(checkpoint, snapshot, url, final);
  const after = reconcile(expected, final);
  await writePrivateJson(value("report")!, { ...report, phase: after.complete ? "verified" : "verification-failed", completedAt: new Date().toISOString(), inserted, after, rowHashes: rowHashes(expected, final) }, true);
  requireSafe(after.complete, "Final row/hash/relationship/financial reconciliation failed; retain checkpoint and backups, stop for review");
  console.log(JSON.stringify({ status: "verified", inserted, unchanged: TABLES.reduce((n, t) => n + before.tables[t].unchanged, 0), rowsHashesRelationshipsAndAggregatesMatch: true }));
}

// Importing this module for offline tests must never create clients or write.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/migrate-to-convex.ts")) {
  main().catch(error => {
    console.error(error instanceof BackfillError ? error.message : "Backfill stopped due to a file, source, or target error. Raw service details are suppressed to protect private data. Preserve backups/checkpoint and investigate securely before retrying.");
    process.exitCode = 1;
  });
}
