import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errorResponse, requireAdmin } from '@/lib/apiAuth'

/** The change log, newest first. ?entityType=&entityId= narrow it; ?before=<ISO time> pages back. */
export async function GET(request: Request) {
  try {
    await requireAdmin()
    const params = new URL(request.url).searchParams
    const where: Prisma.AuditLogWhereInput = {}
    if (params.get('entityType')) where.entityType = params.get('entityType')!
    if (params.get('entityId')) where.entityId = params.get('entityId')!
    if (params.get('before')) where.at = { lt: new Date(params.get('before')!) }
    const limit = Math.min(Number(params.get('limit')) || 50, 200)
    const entries = await prisma.auditLog.findMany({
      where, orderBy: { at: 'desc' }, take: limit,
      select: { id: true, at: true, actorName: true, action: true, entityType: true, entityId: true, summary: true },
    })
    return NextResponse.json({ entries, next: entries.length === limit ? entries[entries.length - 1].at.toISOString() : null })
  } catch (error) {
    return errorResponse(error, 'Failed to fetch the change log')
  }
}
