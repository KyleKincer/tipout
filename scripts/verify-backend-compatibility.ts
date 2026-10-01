import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { requireBackendCheck, verifyBackendContract } from "./lib/backend-compatibility";

async function main() {
  await verifyBackendContract(process.env, async (url) => {
    const client = new ConvexHttpClient(url, { logger: false });
    return client.query(makeFunctionReference<"query">("deployment:frontendCompatibility"), {});
  });
  console.log(requireBackendCheck(process.env)
    ? "Convex backend contract verified; frontend build may proceed."
    : "Offline build: backend compatibility and live authentication were NOT verified.");
}

main().catch(() => {
  // Do not include raw service errors, keys, or potentially private response data.
  console.error("Deployment blocked by the Convex compatibility gate. Deploy and verify the matching backend first, then rebuild this frontend. The existing Vercel production release remains unchanged. See docs/CONVEX_CUTOVER_RUNBOOK.md. No backend deployment or data change was attempted by this check.");
  process.exitCode = 1;
});
