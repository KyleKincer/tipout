import { FRONTEND_BACKEND_CONTRACT } from "../../convex/lib/deploymentContract";

type BuildEnvironment = Record<string, string | undefined>;
export function requireBackendCheck(env: BuildEnvironment): boolean {
  const hosted = Boolean(env.VERCEL || env.VERCEL_ENV || env.CI);
  if (env.TIPOUT_OFFLINE_BUILD === "1") {
    if (hosted) throw new Error("Offline backend checks are forbidden in hosted/CI builds");
    return false;
  }
  return true;
}

export async function verifyBackendContract(
  env: BuildEnvironment,
  readContract: (url: string) => Promise<unknown>,
): Promise<void> {
  if (!requireBackendCheck(env)) return;
  const rawUrl = env.NEXT_PUBLIC_CONVEX_URL;
  if (!rawUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for the deployment compatibility check");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Convex deployment must be an explicit HTTPS origin");
  }
  const result = await readContract(url.origin);
  if (!result || typeof result !== "object" || !("contract" in result) || result.contract !== FRONTEND_BACKEND_CONTRACT) {
    throw new Error("Target Convex backend has not deployed the required frontend contract");
  }
}
