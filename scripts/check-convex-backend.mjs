// Build step: when the app is set to use Convex (DATA_BACKEND=convex), refuse to build unless the Convex
// deployment it points at runs matching backend code. Reads no data; the check query is public metadata.
import { readFileSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

if (process.env.DATA_BACKEND !== 'convex') process.exit(0)
const expected = readFileSync(new URL('../convex/lib/deploymentContract.ts', import.meta.url), 'utf8').match(/FRONTEND_BACKEND_CONTRACT\s*=\s*'([^']+)'/)?.[1]
const url = process.env.NEXT_PUBLIC_CONVEX_URL
try {
  if (!url) throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  const { contract } = await new ConvexHttpClient(url, { logger: false }).query(makeFunctionReference('deployment:frontendCompatibility'), {})
  if (contract !== expected) throw new Error(`backend reports "${contract}", this build needs "${expected}"`)
  console.log(`Convex backend at ${new URL(url).host} matches (${expected}).`)
} catch (error) {
  console.error(`Build stopped: the Convex backend isn't ready for this build (${error instanceof Error ? error.message : error}). Deploy the backend first with \`npx convex deploy\`. The live site is unchanged.`)
  process.exit(1)
}
