import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireAdmin, requireUser } from '@/lib/apiAuth'
import { audit } from '@/lib/audit'
import { dbDate, earliestChangeDate, loadVersions } from '@/lib/roleData'
import { versionData } from '@/lib/roleWrites'
import { describeSettings, isDateOnly, normalizeSettings, parseSettings, todayInRestaurant, validateSettings, versionOn } from '@/utils/roleVersions'

/**
 * Roles with the settings in effect on a date (today unless ?date=YYYY-MM-DD).
 * `configs` keeps the shape the shift forms already read.
 */
export async function GET(request: Request) {
  if (usesConvex()) {
    const date = new URL(request.url).searchParams.get('date') ?? undefined
    return viaConvex('Failed to fetch roles', c => c.query(api.roles.list, { date }))
  }
  try {
    await requireUser()
    const param = new URL(request.url).searchParams.get('date')
    const day = isDateOnly(param) ? param : todayInRestaurant()
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } })
    const versions = await loadVersions(prisma)
    return NextResponse.json(roles.map(role => {
      const all = versions.get(role.id) ?? []
      const v = versionOn(all, day)
      const upcoming = all.find(x => x.effectiveFrom > day)
      return {
        id: role.id,
        name: role.name,
        active: role.active,
        asOf: day,
        basePayRate: v?.basePayRate ?? 0,
        tipPoolGroup: v?.tipPoolGroup ?? null,
        settingsFrom: v?.effectiveFrom ?? null,
        summary: v ? describeSettings(v) : 'no settings for this date',
        upcomingChange: upcoming ? { effectiveFrom: upcoming.effectiveFrom, summary: describeSettings(upcoming) } : null,
        configs: (v?.tipouts ?? []).map(t => ({ ...t, effectiveFrom: v!.effectiveFrom, effectiveTo: v!.effectiveTo })),
      }
    }))
  } catch (error) {
    return errorResponse(error, 'Failed to fetch roles')
  }
}

/** Create a role with its first settings, starting on a date. */
export async function POST(request: Request) {
  if (usesConvex()) {
    const body = await request.json()
    return viaConvex('Failed to create role', c => c.mutation(api.roles.create, {
      name: String(body.name ?? ''), effectiveFrom: String(body.effectiveFrom ?? ''), settings: parseSettings(body.settings), note: body.note ?? null,
    }))
  }
  try {
    const actor = await requireAdmin()
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const effectiveFrom = body.effectiveFrom
    const settings = parseSettings(body.settings)
    if (!name) throw new HttpError(400, 'Give the role a name.')
    if (!isDateOnly(effectiveFrom)) throw new HttpError(400, 'Pick the date these settings start.')
    const problems = validateSettings(settings)
    if (problems.length) throw new HttpError(400, problems.join(' '))
    const role = await prisma.$transaction(async tx => {
      const earliest = await earliestChangeDate(tx)
      if (earliest && effectiveFrom < earliest) throw new HttpError(409, `Payroll is locked before ${earliest}. Start this role on ${earliest} or later.`)
      const created = await tx.role.create({ data: { name } })
      const normalized = normalizeSettings(settings)
      await tx.roleVersion.create({ data: { roleId: created.id, effectiveFrom: dbDate(effectiveFrom), ...versionData(normalized, actor, body.note) } })
      await audit(tx, actor, {
        action: 'role.create', entityType: 'role', entityId: created.id,
        summary: `Created role ${name} from ${effectiveFrom}: ${describeSettings(normalized)}`,
        after: { name, effectiveFrom, settings: normalized },
      })
      return created
    }, { isolationLevel: 'Serializable' })
    return NextResponse.json({ id: role.id, name: role.name })
  } catch (error) {
    return errorResponse(error, 'Failed to create role')
  }
}
