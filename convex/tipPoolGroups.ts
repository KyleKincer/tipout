import { requireAuthenticated } from "./lib/acl";
import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    await requireAuthenticated(ctx);
    const configs = await ctx.db.query("roleConfigs").collect();
    const set = new Set<string>();
    for (const c of configs) {
      if (c.tipPoolGroup && c.tipPoolGroup !== "") set.add(c.tipPoolGroup);
    }
    return Array.from(set);
  },
});
