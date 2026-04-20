import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";

type AnyCtx = QueryCtx | MutationCtx;

export async function getIdentityRoles(ctx: AnyCtx): Promise<string[]> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return [];
  const meta = (identity as unknown as { metadata?: { roles?: string[] } }).metadata;
  if (meta?.roles && Array.isArray(meta.roles)) return meta.roles;
  const publicMetadata = (identity as unknown as { publicMetadata?: { roles?: string[] } }).publicMetadata;
  if (publicMetadata?.roles && Array.isArray(publicMetadata.roles)) return publicMetadata.roles;
  return [];
}

export async function requireAuthenticated(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return identity;
}

export async function requireAdmin(ctx: AnyCtx) {
  const identity = await requireAuthenticated(ctx);
  const roles = await getIdentityRoles(ctx);
  if (!roles.includes("admin")) throw new ConvexError("Admin required");
  return identity;
}
