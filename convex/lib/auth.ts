import { ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export type Actor = { id: string; name: string; isAdmin: boolean }
type Ctx = QueryCtx | MutationCtx

/** Throw an error the API adapter turns into this HTTP status, with a message safe to show. */
export function fail(status: number, message: string): never {
  throw new ConvexError({ status, message })
}

/** Roles from the Clerk "convex" JWT. The template puts public metadata under `metadata`, as the session token does. */
function claimRoles(identity: Record<string, unknown>): string[] {
  for (const key of ['metadata', 'publicMetadata', 'public_metadata']) {
    const roles = (identity[key] as { roles?: unknown } | undefined)?.roles
    if (Array.isArray(roles) && roles.every(r => typeof r === 'string')) return roles
  }
  return []
}

export async function requireUser(ctx: Ctx): Promise<Actor> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) fail(401, 'Sign in first.')
  return {
    id: identity.subject,
    name: identity.name || identity.email || identity.nickname || identity.subject,
    isAdmin: claimRoles(identity as unknown as Record<string, unknown>).includes('admin'),
  }
}

export async function requireAdmin(ctx: Ctx): Promise<Actor> {
  const actor = await requireUser(ctx)
  if (!actor.isAdmin) fail(403, 'Only admins can do that.')
  return actor
}
