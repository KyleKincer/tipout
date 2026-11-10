import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin } from '@/lib/apiAuth'
import { applyVersionChange, planForRole, undoLatestChange } from '@/lib/roleWrites'
import { isDateOnly, parseSettings } from '@/utils/roleVersions'

type Params = { params: Promise<{ id: string }> }

async function findRole(id: string) {
  const role = await prisma.role.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!role) throw new HttpError(404, 'Role not found')
  return role
}

/**
 * New settings for a role from a date onward. Days before that date keep the settings they had.
 * Send `dryRun: true` to see what would change without saving, including how many shifts already
 * entered it would recalculate. Saving a change that recalculates entered shifts needs `confirmAffected: true`.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const role = await findRole(id)
    const body = await request.json()
    if (!isDateOnly(body.effectiveFrom)) throw new HttpError(400, 'Pick the date the new settings start.')
    const settings = parseSettings(body.settings)
    if (body.dryRun) {
      const { plan, affects } = await planForRole(prisma, id, settings, body.effectiveFrom)
      return NextResponse.json(plan.ok ? { ...plan, affects } : plan)
    }
    const { plan } = await prisma.$transaction(
      tx => applyVersionChange(tx, actor, role, settings, body.effectiveFrom, body.note, body.confirmAffected === true),
      { isolationLevel: 'Serializable' },
    )
    return NextResponse.json(plan)
  } catch (error) {
    return errorResponse(error, 'Failed to save role settings')
  }
}

/** Undo the most recent settings change. ?confirm=1 is needed when that recalculates entered shifts. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin()
    const { id } = await params
    const role = await findRole(id)
    const confirmed = new URL(request.url).searchParams.get('confirm') === '1'
    const plan = await prisma.$transaction(tx => undoLatestChange(tx, actor, role, confirmed), { isolationLevel: 'Serializable' })
    return NextResponse.json(plan)
  } catch (error) {
    return errorResponse(error, 'Failed to undo the settings change')
  }
}
