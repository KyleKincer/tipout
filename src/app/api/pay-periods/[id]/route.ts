import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { buildSnapshot } from '@/lib/reportData'
import { todayInRestaurant, toDateOnly } from '@/utils/roleVersions'

type Params = { params: Promise<{ id: string }> }

/**
 * { action: 'lock' } saves the period's results exactly as calculated now and blocks changes to them.
 * { action: 'unlock', reason } reopens it; the saved results are kept in the change log.
 */
export async function POST(request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    const { action, reason } = await request.json()
    return viaConvex('Failed to update pay period', c => {
      if (action === 'lock') return c.mutation(api.payPeriods.lock, { id })
      if (action === 'unlock') return c.mutation(api.payPeriods.unlock, { id, reason: typeof reason === 'string' ? reason : undefined })
      throw new HttpError(400, 'Unknown action.')
    })
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const { action, reason } = await request.json()
    const result = await prisma.$transaction(async tx => {
      const period = await tx.payPeriod.findUnique({ where: { id } })
      if (!period) throw new HttpError(404, 'Pay period not found')
      const startDate = toDateOnly(period.startDate)
      const endDate = toDateOnly(period.endDate)
      if (action === 'lock') {
        if (period.lockedAt) throw new HttpError(409, 'That pay period is already locked.')
        if (endDate > todayInRestaurant()) throw new HttpError(409, `This pay period runs through ${endDate}. Lock it once it's over.`)
        const snapshot = await buildSnapshot(tx, startDate, endDate)
        const payrollTips = snapshot.shiftResults.reduce((s, r) => s + r.payrollTips, 0)
        const lockedAt = new Date()
        await tx.payPeriod.update({
          where: { id },
          data: { lockedAt, lockedBy: actor.name, snapshot: snapshot as unknown as Prisma.InputJsonValue },
        })
        await audit(tx, actor, {
          action: 'payPeriod.lock', entityType: 'payPeriod', entityId: id,
          summary: `Locked payroll for ${startDate} to ${endDate}: ${snapshot.shiftResults.length} shifts, $${payrollTips.toFixed(2)} in payroll tips`,
        })
        return { lockedAt: lockedAt.toISOString() }
      }
      if (action === 'unlock') {
        if (!period.lockedAt) throw new HttpError(409, 'That pay period is not locked.')
        const why = typeof reason === 'string' ? reason.trim() : ''
        if (!why) throw new HttpError(400, 'Say why it needs unlocking. It goes in the change log.')
        await audit(tx, actor, {
          action: 'payPeriod.unlock', entityType: 'payPeriod', entityId: id,
          summary: `Unlocked payroll for ${startDate} to ${endDate}: ${why}`,
          before: { lockedAt: period.lockedAt, lockedBy: period.lockedBy, snapshot: period.snapshot },
        })
        await tx.payPeriod.update({ where: { id }, data: { lockedAt: null, lockedBy: null, snapshot: Prisma.DbNull } })
        return { lockedAt: null }
      }
      throw new HttpError(400, 'Unknown action.')
    }, { isolationLevel: 'Serializable', timeout: 30000 })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error, 'Failed to update pay period')
  }
}

/** Remove a pay period that isn't locked. */
export async function DELETE(_request: Request, { params }: Params) {
  if (usesConvex()) {
    const { id } = await params
    return viaConvex('Failed to remove pay period', c => c.mutation(api.payPeriods.remove, { id }))
  }
  try {
    const actor = await requireAdmin()
    const { id } = await params
    await prisma.$transaction(async tx => {
      const period = await tx.payPeriod.findUnique({ where: { id } })
      if (!period) throw new HttpError(404, 'Pay period not found')
      if (period.lockedAt) throw new HttpError(409, 'Unlock the pay period before removing it.')
      await tx.payPeriod.delete({ where: { id } })
      await audit(tx, actor, {
        action: 'payPeriod.delete', entityType: 'payPeriod', entityId: id,
        summary: `Removed pay period ${toDateOnly(period.startDate)} to ${toDateOnly(period.endDate)}`,
      })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Failed to remove pay period')
  }
}
