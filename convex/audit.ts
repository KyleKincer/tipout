import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAdmin } from './lib/auth'

/** The change log, newest first. entityType/entityId narrow it; `before` (ISO time) pages back. */
export const list = query({
  args: { entityType: v.optional(v.string()), entityId: v.optional(v.string()), before: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const limit = Math.min(args.limit || 50, 200)
    const before = args.before ? Date.parse(args.before) : Number.POSITIVE_INFINITY
    const rows = args.entityType
      ? await ctx.db.query('auditLog')
          .withIndex('by_entity', q => {
            const typed = q.eq('entityType', args.entityType!)
            return args.entityId ? typed.eq('entityId', args.entityId).lt('at', before) : typed
          })
          .order('desc').filter(q => q.lt(q.field('at'), before)).take(limit)
      : await ctx.db.query('auditLog').withIndex('by_at', q => q.lt('at', before)).order('desc').take(limit)
    const entries = rows.map(r => ({
      id: r._id as string, at: new Date(r.at).toISOString(), actorName: r.actorName, action: r.action,
      entityType: r.entityType, entityId: r.entityId, summary: r.summary,
    }))
    return { entries, next: entries.length === limit ? entries[entries.length - 1].at : null }
  },
})
