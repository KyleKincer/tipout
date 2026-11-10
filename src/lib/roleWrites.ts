import type { Prisma } from '@prisma/client'
import type { Actor } from './apiAuth'
import { HttpError } from './apiAuth'
import { audit } from './audit'
import { dbDate, loadLockedRanges, loadVersions, settingsOf, type Db } from './roleData'
import { planUndoLatest, planVersionChange, toDateOnly, type DateOnly, type RoleSettings, type RoleVersion, type VersionPlan } from '@/utils/roleVersions'

/** Shifts already entered for a role on or after a date: the ones a change from that date recalculates. */
export type Affected = { shifts: number; firstDate: DateOnly | null; lastDate: DateOnly | null }

export async function affectedShifts(db: Db, roleId: string, from: DateOnly): Promise<Affected> {
  const where = { roleId, date: { gte: dbDate(from) } }
  const [shifts, range] = await Promise.all([
    db.shift.count({ where }),
    db.shift.aggregate({ where, _min: { date: true }, _max: { date: true } }),
  ])
  return {
    shifts,
    firstDate: range._min.date ? toDateOnly(range._min.date) : null,
    lastDate: range._max.date ? toDateOnly(range._max.date) : null,
  }
}

const describeAffected = (a: Affected) =>
  `${a.shifts} ${a.shifts === 1 ? 'shift' : 'shifts'} already entered (${a.firstDate}${a.lastDate !== a.firstDate ? ` to ${a.lastDate}` : ''})`

function requireConfirmation(a: Affected, confirmed: boolean) {
  if (a.shifts > 0 && !confirmed) {
    throw new HttpError(409, `This recalculates ${describeAffected(a)}, and everyone who worked those nights. Confirm to go ahead.`)
  }
}

const tipoutRows = (settings: RoleSettings) => settings.tipouts.map(t => ({
  tipoutType: t.tipoutType, percentageRate: t.percentageRate, paysTipout: t.paysTipout,
  receivesTipout: t.receivesTipout, distributionGroup: t.distributionGroup,
}))

export function versionData(settings: RoleSettings, actor: Actor, note?: string | null) {
  return {
    basePayRate: settings.basePayRate,
    tipPoolGroup: settings.tipPoolGroup,
    note: note?.trim() || null,
    createdBy: actor.name,
    tipouts: { create: tipoutRows(settings) },
  } satisfies Partial<Prisma.RoleVersionUncheckedCreateInput>
}

/** Work out how new settings starting on a date would be stored, without saving anything. */
export async function planForRole(db: Db, roleId: string, settings: RoleSettings, effectiveFrom: DateOnly) {
  const versions = (await loadVersions(db, [roleId])).get(roleId) ?? []
  const plan = planVersionChange(versions, settings, effectiveFrom, await loadLockedRanges(db))
  // A correction or merge rewrites the latest version from its own start date, which equals effectiveFrom.
  const affects = plan.ok ? await affectedShifts(db, roleId, effectiveFrom) : null
  return { versions, plan, affects }
}

/** Save new settings for a role starting on a date. Earlier dates are never touched. */
export async function applyVersionChange(
  tx: Prisma.TransactionClient, actor: Actor, role: { id: string; name: string },
  settings: RoleSettings, effectiveFrom: DateOnly, note: string | null | undefined, confirmAffected: boolean,
): Promise<{ plan: Extract<VersionPlan, { ok: true }>; before: RoleVersion[]; affects: Affected }> {
  const { versions, plan, affects } = await planForRole(tx, role.id, settings, effectiveFrom)
  if (!plan.ok) throw new HttpError(409, plan.error)
  requireConfirmation(affects!, confirmAffected)
  if (plan.kind === 'create') {
    if (plan.close) await tx.roleVersion.update({ where: { id: plan.close.id }, data: { effectiveTo: dbDate(plan.close.effectiveTo) } })
    await tx.roleVersion.create({ data: { roleId: role.id, effectiveFrom: dbDate(plan.create.effectiveFrom), ...versionData(plan.create.settings, actor, note) } })
  } else if (plan.kind === 'replace') {
    await tx.roleVersionTipout.deleteMany({ where: { versionId: plan.replace.id } })
    const data = versionData(plan.replace.settings, actor, note)
    await tx.roleVersion.update({ where: { id: plan.replace.id }, data: { ...data, createdAt: new Date() } })
  } else {
    await tx.roleVersion.delete({ where: { id: plan.delete } })
    await tx.roleVersion.update({ where: { id: plan.reopen }, data: { effectiveTo: null } })
  }
  await audit(tx, actor, {
    action: plan.kind === 'create' ? 'settings.change' : 'settings.correct',
    entityType: 'role', entityId: role.id,
    summary: `${role.name} from ${effectiveFrom}: ${plan.changes.join('; ')}${note?.trim() ? ` (${note.trim()})` : ''}${affects!.shifts ? `; recalculated ${describeAffected(affects!)}` : ''}`,
    before: versions.map(v => ({ ...v })),
    after: { effectiveFrom, settings },
  })
  return { plan, before: versions, affects: affects! }
}

/** Undo the most recent settings change for a role. */
export async function undoLatestChange(tx: Prisma.TransactionClient, actor: Actor, role: { id: string; name: string }, confirmAffected: boolean) {
  const versions = (await loadVersions(tx, [role.id])).get(role.id) ?? []
  const plan = planUndoLatest(versions, await loadLockedRanges(tx))
  if (!plan.ok) throw new HttpError(409, plan.error)
  const removed = versions.find(v => v.id === plan.delete)!
  const affects = await affectedShifts(tx, role.id, removed.effectiveFrom)
  requireConfirmation(affects, confirmAffected)
  await tx.roleVersion.delete({ where: { id: plan.delete } })
  await tx.roleVersion.update({ where: { id: plan.reopen }, data: { effectiveTo: null } })
  await audit(tx, actor, {
    action: 'settings.undo', entityType: 'role', entityId: role.id,
    summary: `${role.name}: undid the change from ${removed.effectiveFrom}; settings from ${plan.restores.effectiveFrom} apply again${affects.shifts ? `; recalculated ${describeAffected(affects)}` : ''}`,
    before: removed, after: settingsOf(plan.restores),
  })
  return plan
}
