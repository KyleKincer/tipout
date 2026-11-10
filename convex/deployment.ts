import { v } from 'convex/values'
import { query } from './_generated/server'
import { FRONTEND_BACKEND_CONTRACT } from './lib/deploymentContract'

// Anonymous by design: a build can check compatibility without account access. Reads no data.
export const frontendCompatibility = query({
  args: {},
  returns: v.object({ contract: v.string() }),
  handler: async () => ({ contract: FRONTEND_BACKEND_CONTRACT }),
})
