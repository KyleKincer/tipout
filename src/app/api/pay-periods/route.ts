import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { dbDate } from '@/lib/roleData'
import { validatePayPeriod, type PayPeriodSnapshot } from '@/utils/payPeriods'
import { addDays, toDateOnly } from '@/utils/roleVersions'

export async function GET() {
  try {
    await requireUser()
    const rows = await prisma.payPeriod.findMany({ orderBy: { startDate: 'desc' } })
    const periods = rows.map(p => {
      const snapshot = p.snapshot as unknown as PayPeriodSnapshot | null
      return {
        id: p.id,
        startDate: toDateOnly(p.startDate),
        endDate: toDateOnly(p.endDate),
        lockedAt: p.lockedAt?.toISOString() ?? null,
        lockedBy: p.lockedBy,
        createdBy: p.createdBy,
        shiftCount: snapshot?.shiftResults.length ?? null,
        payrollTips: snapshot ? Number(snapshot.shiftResults.reduce((s, r) => s + r.payrollTips, 0).toFixed(2)) : null,
      }
    })
    // Suggest the next period: right after the latest one, the same length.
    const latest = periods[0]
    const days = latest ? Math.round((dbDate(latest.endDate).getTime() - dbDate(latest.startDate).getTime()) / 86400000) : 13
    const suggestion = latest ? { startDate: addDays(latest.endDate, 1), endDate: addDays(latest.endDate, 1 + days) } : null
    return NextResponse.json({ periods, suggestion })
  } catch (error) {
    return errorResponse(error, 'Failed to fetch pay periods')
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin()
    const { startDate, endDate } = await request.json()
    const period = await prisma.$transaction(async tx => {
      const existing = (await tx.payPeriod.findMany()).map(p => ({ id: p.id, startDate: toDateOnly(p.startDate), endDate: toDateOnly(p.endDate) }))
      const problems = validatePayPeriod({ startDate, endDate }, existing)
      if (problems.length) throw new HttpError(400, problems.join(' '))
      const created = await tx.payPeriod.create({ data: { startDate: dbDate(startDate), endDate: dbDate(endDate), createdBy: actor.name } })
      await audit(tx, actor, { action: 'payPeriod.create', entityType: 'payPeriod', entityId: created.id, summary: `Added pay period ${startDate} to ${endDate}` })
      return created
    }, { isolationLevel: 'Serializable' })
    return NextResponse.json({ id: period.id })
  } catch (error) {
    return errorResponse(error, 'Failed to create pay period')
  }
}
