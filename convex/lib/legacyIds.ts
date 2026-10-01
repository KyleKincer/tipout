import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type LegacyTable = "employees" | "roles" | "shifts" | "roleConfigs";

/** Resolve existing bookmarks without guessing identities or matching names. */
export async function resolveLegacyDoc<Table extends LegacyTable>(
  ctx: QueryCtx | MutationCtx,
  table: Table,
  id: string,
): Promise<Doc<Table> | null> {
  if (!id) return null;
  const nativeId = ctx.db.normalizeId(table, id);
  if (nativeId) {
    const native = await ctx.db.get(nativeId);
    if (native) return native;
  }
  // A source ID could happen to be valid native-ID syntax, so a missing native
  // document still gets an exact legacy lookup. Duplicate mappings fail closed.
  const rows = await ctx.db.query(table as LegacyTable)
    .withIndex("by_legacy", (q) => q.eq("legacyId", id))
    .take(2);
  if (rows.length > 1) throw new ConvexError("Ambiguous legacy identity; contact an administrator");
  return (rows[0] as unknown as Doc<Table> | undefined) ?? null;
}
