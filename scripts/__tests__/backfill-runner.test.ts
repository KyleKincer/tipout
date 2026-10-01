import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonical, emptyTables, sealSnapshot, sha256 } from "../lib/backfill";
import type { Row, Table } from "../lib/backfill";
import { hashFile, readPrivateJson, writePrivateJson } from "../lib/backfill-files";

const mockRows = emptyTables();
const mockIdentity = { protocolVersion: 1, deploymentUrl: "https://target.convex.cloud", enabled: true, sourceFingerprint: "", snapshotChecksum: "" };
const mockQuery = jest.fn(async (_fn: unknown, args: { table?: Table }) => args.table
  ? { page: mockRows[args.table], isDone: true, continueCursor: "done" }
  : mockIdentity);
const mockMutation = jest.fn(async (_fn: unknown, args: Row) => {
  const doc = { ...args }; delete doc.migration;
  mockRows.roles.push({ ...doc, _id: "role:native", _creationTime: 1 });
  return "role:native";
});
jest.mock("convex/browser", () => ({ ConvexHttpClient: jest.fn(() => ({ query: mockQuery, mutation: mockMutation, setAdminAuth: jest.fn() })) }));
import { main, parseArgs } from "../migrate-to-convex";

let directory: string, env: NodeJS.ProcessEnv, log: jest.SpyInstance;
const source = { host: "source.test", port: "5432", database: "tipout", schema: "public", principal: "username" };
const snapshot = sealSnapshot({ version: 1, source, sourceFingerprint: sha256(canonical(source)), capturedAt: "2025-01-01T00:00:00.000Z", postgresSnapshot: "1:2:", tables: {
  roles: [{ id: "legacy-r", name: "PRIVATE PAYROLE", basePayRate: "123.45", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }], employees: [], roleConfigs: [], shifts: [],
} });
beforeEach(async () => {
  env = { ...process.env };
  process.env.CONVEX_URL = mockIdentity.deploymentUrl; process.env.CONVEX_DEPLOY_KEY = "TEST_KEY_DO_NOT_PRINT";
  mockIdentity.sourceFingerprint = snapshot.sourceFingerprint; mockIdentity.snapshotChecksum = snapshot.checksum;
  for (const table of Object.keys(mockRows) as Table[]) mockRows[table] = [];
  mockQuery.mockClear(); mockMutation.mockClear();
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  directory = await mkdtemp(path.join(os.tmpdir(), "tipout-runner-test-"));
  await writePrivateJson(path.join(directory, "snapshot.json"), snapshot);
});
afterEach(async () => { log.mockRestore(); process.env = env; await rm(directory, { recursive: true, force: true }); });
const base = (report = "report.json") => ["--snapshot", path.join(directory, "snapshot.json"), "--report", path.join(directory, report)];
async function applyArgs(report = "report.json") {
  const sourceBackup = path.join(directory, "pg.backup"), targetBackup = path.join(directory, "convex.backup");
  await writeFile(sourceBackup, "test-source-backup"); await writeFile(targetBackup, "test-target-backup");
  return [...base(report), "--apply", "--expect-source", snapshot.sourceFingerprint, "--expect-target", mockIdentity.deploymentUrl,
    "--snapshot-sha256", await hashFile(path.join(directory, "snapshot.json")), "--source-backup", sourceBackup, "--source-backup-sha256", await hashFile(sourceBackup),
    "--target-backup", targetBackup, "--target-backup-sha256", await hashFile(targetBackup), "--checkpoint", path.join(directory, "checkpoint.json"),
    "--ack-source-unchanged", "--ack-target-frozen", "--ack-restore-tested"];
}

test("default dry-run reads and reconciles but calls no mutation; logs contain no names, amounts or keys", async () => {
  await main(base());
  expect(mockQuery).toHaveBeenCalledTimes(9); expect(mockMutation).not.toHaveBeenCalled();
  const report = (await readPrivateJson(path.join(directory, "report.json"))).data as { mode: string; before: { insert: number } };
  expect(report.mode).toBe("dry-run"); expect(report.before.insert).toBe(1);
  const output = log.mock.calls.flat().join(" ");
  expect(output).not.toContain("PRIVATE PAYROLE"); expect(output).not.toContain("123.45"); expect(output).not.toContain("TEST_KEY_DO_NOT_PRINT");
});

test("apply refuses missing identity/backup/freeze gates before connecting", async () => {
  await expect(main([...base(), "--apply"])).rejects.toThrow(/source fingerprint/);
  expect(mockQuery).not.toHaveBeenCalled(); expect(mockMutation).not.toHaveBeenCalled();
});

test("approved apply verifies all rows and an exact rerun calls no mutation", async () => {
  await main(await applyArgs()); expect(mockMutation).toHaveBeenCalledTimes(1);
  const report = (await readPrivateJson(path.join(directory, "report.json"))).data as { phase: string; after: { complete: boolean } };
  expect(report.phase).toBe("verified"); expect(report.after.complete).toBe(true);
  await main(await applyArgs("second-report.json")); expect(mockMutation).toHaveBeenCalledTimes(1);
});

test("deleted confirmed row and absent uncertain write stop instead of resurrecting data", async () => {
  await main(await applyArgs()); mockRows.roles = [];
  await expect(main(await applyArgs("second-report.json"))).rejects.toThrow(/deleted/);
  expect(mockMutation).toHaveBeenCalledTimes(1);
});

test("uncertain network failure persists intent and refuses blind retry", async () => {
  mockMutation.mockRejectedValueOnce(new Error("PRIVATE SERVICE FAILURE"));
  await expect(main(await applyArgs())).rejects.toThrow("PRIVATE SERVICE FAILURE");
  const checkpoint = (await readPrivateJson(path.join(directory, "checkpoint.json"))).data as { pending: string | null };
  expect(checkpoint.pending).not.toBeNull();
  await expect(main(await applyArgs("second-report.json"))).rejects.toThrow(/uncertain/);
  expect(mockMutation).toHaveBeenCalledTimes(1);
});

test("unknown/duplicate flags and mixed export/apply modes are refused", () => {
  for (const args of [["--unsafe"], ["--apply", "--apply"], ["--apply", "--dry-run"], ["--snapshot"], ["--export", "/tmp/source", "--apply"]]) expect(() => parseArgs(args)).toThrow();
});
