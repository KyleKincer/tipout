import type { MutationCtx } from '../_generated/server'
import type { Actor } from './auth'

export type AuditEntry = {
  action: string
  entityType: 'shift' | 'employee' | 'role' | 'roleVersion' | 'payPeriod'
  entityId?: string | null
  summary: string
  before?: unknown
  after?: unknown
}

/** Plain JSON copy, so documents with ids, nulls and nested arrays store cleanly. */
const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** Record a change. Always called inside the mutation making the change, so both happen or neither does. */
export async function audit(ctx: MutationCtx, actor: Actor, entry: AuditEntry) {
  await ctx.db.insert('auditLog', {
    at: Date.now(),
    actorId: actor.id,
    actorName: actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: json(entry.before),
    after: json(entry.after),
  })
}
