import type { Prisma, PrismaClient } from '@prisma/client'
import type { Actor } from './apiAuth'

type Db = PrismaClient | Prisma.TransactionClient

export type AuditEntry = {
  action: string
  entityType: 'shift' | 'employee' | 'role' | 'roleVersion' | 'payPeriod'
  entityId?: string | null
  summary: string
  before?: unknown
  after?: unknown
}

const json = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue)

/** Record a change. Call it inside the same transaction as the change so neither happens alone. */
export function audit(db: Db, actor: Actor, entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      actorId: actor.id,
      actorName: actor.name,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: json(entry.before),
      after: json(entry.after),
    },
  })
}
