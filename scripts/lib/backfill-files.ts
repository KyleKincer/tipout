import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { BackfillError, requireSafe } from "./backfill";

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
// Keep archives (names/payroll), checkpoint identities, and financial reports
// off stdout and outside the working tree. No existing archive is overwritten.
async function privatePath(file: string): Promise<string> {
  requireSafe(path.isAbsolute(file), "Artifact paths must be absolute and outside the checkout");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(file));
  const cwd = await realpath(process.cwd());
  const resolved = path.join(parent, path.basename(file));
  requireSafe(resolved !== cwd && !resolved.startsWith(cwd + path.sep), "Private artifacts must be outside the checkout");
  return resolved;
}
export async function writePrivateJson(file: string, value: unknown, replace = false): Promise<void> {
  const destination = await privatePath(file);
  const data = JSON.stringify(value, null, 2) + "\n";
  requireSafe(Buffer.byteLength(data) <= MAX_ARCHIVE_BYTES, "Archive exceeds 128 MiB safety limit");
  if (!replace) {
    const handle = await open(destination, "wx", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    return;
  }
  const existing = await lstat(destination);
  requireSafe(existing.isFile() && (existing.mode & 0o077) === 0, "Unsafe checkpoint path or file permissions");
  const temp = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, destination);
}
export async function readPrivateJson(file: string): Promise<{ data: unknown; bytes: Buffer }> {
  requireSafe(path.isAbsolute(file), "Artifact paths must be absolute");
  const info = await lstat(file);
  requireSafe(info.isFile() && (info.mode & 0o077) === 0, "Archive/checkpoint must be a regular owner-only file (chmod 600)");
  requireSafe(info.size > 0 && info.size <= MAX_ARCHIVE_BYTES, "Invalid archive size");
  const bytes = await readFile(file);
  try { return { data: JSON.parse(bytes.toString("utf8")), bytes }; }
  catch { throw new BackfillError("Archive is not valid JSON"); }
}
export async function hashFile(file: string): Promise<string> {
  requireSafe(path.isAbsolute(file), "Backup paths must be absolute");
  const info = await stat(file);
  requireSafe(info.isFile() && info.size > 0, "Backup must be a non-empty regular file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function verifyBackup(file: string | undefined, digest: string | undefined): Promise<string> {
  requireSafe(file && digest && /^[a-f0-9]{64}$/.test(digest), "Apply requires both backup files and their independently recorded SHA-256 hashes");
  const actual = await hashFile(file);
  requireSafe(actual === digest, "Backup digest mismatch");
  return actual;
}
