import type { RoleConfig, TipoutType } from '../types/reports'

/**
 * Role settings are stored as dated versions. Each version covers [effectiveFrom, effectiveTo):
 * effectiveFrom is the first day it applies, effectiveTo is the first day it no longer applies,
 * and the latest version is open-ended (effectiveTo null). A role's versions never overlap and
 * never leave gaps, so every date after a role's first version has exactly one set of settings.
 *
 * Dates are plain 'YYYY-MM-DD' strings so comparisons never depend on time zones.
 */
export type DateOnly = string

export const TIPOUT_TYPES: TipoutType[] = ['bar', 'host', 'sa']

export type VersionTipout = {
  tipoutType: TipoutType
  percentageRate: number
  paysTipout: boolean
  receivesTipout: boolean
  distributionGroup: string | null
}

export type RoleSettings = {
  basePayRate: number
  tipPoolGroup: string | null
  tipouts: VersionTipout[]
}

export type RoleVersion = RoleSettings & {
  id: string
  roleId: string
  effectiveFrom: DateOnly
  effectiveTo: DateOnly | null
  note?: string | null
  createdAt?: string
  createdBy?: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** The calendar day of a stored date. Shift and version dates are stored at UTC midnight. */
export function toDateOnly(value: Date | string): DateOnly {
  return (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10)
}

export function addDays(day: DateOnly, days: number): DateOnly {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Today's date in the restaurant's time zone. */
export function todayInRestaurant(now = new Date(), timeZone = 'America/New_York'): DateOnly {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export const sortVersions = <T extends { effectiveFrom: DateOnly }>(versions: T[]) =>
  [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

export function coversDay(version: Pick<RoleVersion, 'effectiveFrom' | 'effectiveTo'>, day: DateOnly) {
  return version.effectiveFrom <= day && (version.effectiveTo === null || day < version.effectiveTo)
}

export function versionOn<T extends Pick<RoleVersion, 'effectiveFrom' | 'effectiveTo'>>(versions: T[], day: DateOnly): T | null {
  return versions.find(v => coversDay(v, day)) ?? null
}

/** Versions that apply to at least one day in [start, end] (both inclusive). */
export function versionsInRange<T extends Pick<RoleVersion, 'effectiveFrom' | 'effectiveTo'>>(versions: T[], start: DateOnly, end: DateOnly): T[] {
  return sortVersions(versions).filter(v => v.effectiveFrom <= end && (v.effectiveTo === null || v.effectiveTo > start))
}

const round = (n: number, places = 4) => Number(n.toFixed(places))

/** Settings in a canonical form: one entry per tipout type that does anything, in a fixed order. */
export function normalizeSettings(settings: RoleSettings): RoleSettings {
  const tipouts = TIPOUT_TYPES.flatMap(type => {
    const t = settings.tipouts.find(x => x.tipoutType === type)
    if (!t || (!t.paysTipout && !t.receivesTipout)) return []
    return [{
      tipoutType: type,
      percentageRate: t.paysTipout ? round(Number(t.percentageRate) || 0) : 0,
      paysTipout: !!t.paysTipout,
      receivesTipout: !!t.receivesTipout,
      distributionGroup: t.receivesTipout ? (t.distributionGroup?.trim() || null) : null,
    }]
  })
  return {
    basePayRate: round(Number(settings.basePayRate) || 0, 2),
    tipPoolGroup: settings.tipPoolGroup?.trim() || null,
    tipouts,
  }
}

export function settingsEqual(a: RoleSettings, b: RoleSettings) {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b))
}

/** Problems that make settings unusable, in plain words. */
export function validateSettings(settings: RoleSettings): string[] {
  const errors: string[] = []
  if (!Number.isFinite(Number(settings.basePayRate)) || Number(settings.basePayRate) < 0) errors.push('Base pay rate must be zero or more.')
  for (const t of settings.tipouts) {
    if (!TIPOUT_TYPES.includes(t.tipoutType)) errors.push(`Unknown tipout type "${t.tipoutType}".`)
    if (t.paysTipout && t.receivesTipout) errors.push(`A role can't both pay and receive ${label(t.tipoutType)} tipout.`)
    if (t.paysTipout && !(Number(t.percentageRate) >= 0 && Number(t.percentageRate) <= 100)) errors.push(`${cap(label(t.tipoutType))} tipout must be between 0% and 100%.`)
    if (t.receivesTipout && !t.distributionGroup?.trim()) errors.push(`Pick who shares the ${label(t.tipoutType)} tipout this role receives.`)
  }
  const types = settings.tipouts.map(t => t.tipoutType)
  if (new Set(types).size !== types.length) errors.push('Each tipout type can only be set once.')
  return errors
}

const label = (type: TipoutType) => (type === 'sa' ? 'SA' : type)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pct = (n: number) => `${round(n, 2)}%`
const money = (n: number) => `$${n.toFixed(2)}`

/** Plain-English list of what differs between two sets of settings. */
export function describeChanges(before: RoleSettings | null, after: RoleSettings): string[] {
  const a = normalizeSettings(after)
  if (!before) return ['first settings for this role']
  const b = normalizeSettings(before)
  const changes: string[] = []
  if (b.basePayRate !== a.basePayRate) changes.push(`base pay ${money(b.basePayRate)} → ${money(a.basePayRate)}`)
  if (b.tipPoolGroup !== a.tipPoolGroup) {
    if (!a.tipPoolGroup) changes.push(`stops pooling tips (was the ${b.tipPoolGroup} pool)`)
    else if (!b.tipPoolGroup) changes.push(`starts pooling tips in the ${a.tipPoolGroup} pool`)
    else changes.push(`tip pool ${b.tipPoolGroup} → ${a.tipPoolGroup}`)
  }
  for (const type of TIPOUT_TYPES) {
    const x = b.tipouts.find(t => t.tipoutType === type)
    const y = a.tipouts.find(t => t.tipoutType === type)
    const name = `${label(type)} tipout`
    if (x?.paysTipout && !y?.paysTipout) changes.push(`stops paying ${name}`)
    if (!x?.paysTipout && y?.paysTipout) changes.push(`starts paying ${name} (${pct(y.percentageRate)})`)
    if (x?.paysTipout && y?.paysTipout && x.percentageRate !== y.percentageRate) changes.push(`${name} ${pct(x.percentageRate)} → ${pct(y.percentageRate)}`)
    if (x?.receivesTipout && !y?.receivesTipout) changes.push(`stops receiving ${name}`)
    if (!x?.receivesTipout && y?.receivesTipout) changes.push(`starts receiving ${name} (shared with ${y.distributionGroup})`)
    if (x?.receivesTipout && y?.receivesTipout && x.distributionGroup !== y.distributionGroup) changes.push(`${name} shared with ${x.distributionGroup} → ${y.distributionGroup}`)
  }
  return changes
}

/** One-line summary of a version's settings. */
export function describeSettings(settings: RoleSettings): string {
  const s = normalizeSettings(settings)
  const parts = [`base pay ${money(s.basePayRate)}/hr`]
  for (const t of s.tipouts) {
    if (t.paysTipout) parts.push(`pays ${label(t.tipoutType)} ${pct(t.percentageRate)} of ${t.tipoutType === 'bar' ? 'liquor sales' : 'tips'}`)
    if (t.receivesTipout) parts.push(`receives ${label(t.tipoutType)} tipout (shared with ${t.distributionGroup})`)
  }
  parts.push(s.tipPoolGroup ? `pools tips in the ${s.tipPoolGroup} pool` : 'no tip pool')
  return parts.join(' · ')
}

export type LockedRange = { startDate: DateOnly; endDate: DateOnly }

/** Last locked day, or null when nothing is locked. Changes can only take effect after it. */
export function lockedThrough(locks: LockedRange[]): DateOnly | null {
  return locks.reduce<DateOnly | null>((max, l) => (max === null || l.endDate > max ? l.endDate : max), null)
}

export function isLocked(locks: LockedRange[], day: DateOnly) {
  return locks.some(l => l.startDate <= day && day <= l.endDate)
}

export type VersionPlan =
  | { ok: true; kind: 'create'; create: { effectiveFrom: DateOnly; settings: RoleSettings }; close?: { id: string; effectiveTo: DateOnly }; changes: string[] }
  | { ok: true; kind: 'replace'; replace: { id: string; settings: RoleSettings }; changes: string[] }
  | { ok: true; kind: 'merge'; delete: string; reopen: string; changes: string[] }
  | { ok: false; error: string }

/**
 * How to apply new settings starting on a date, without touching any day before it.
 * - After the latest version starts: end the latest version the day before and start a new one.
 * - On the day the latest version starts: correct that version in place (or drop it if the
 *   correction makes it the same as the one before).
 * - Before the latest version starts, or inside a locked pay period: refused.
 */
export function planVersionChange(
  existing: RoleVersion[],
  next: RoleSettings,
  effectiveFrom: DateOnly,
  locks: LockedRange[] = [],
): VersionPlan {
  if (!isDateOnly(effectiveFrom)) return { ok: false, error: 'Pick the date the new settings start.' }
  const problems = validateSettings(next)
  if (problems.length) return { ok: false, error: problems.join(' ') }
  const locked = lockedThrough(locks)
  if (locked && effectiveFrom <= locked) {
    return { ok: false, error: `Payroll is locked through ${locked}. New settings have to start on ${addDays(locked, 1)} or later.` }
  }
  const settings = normalizeSettings(next)
  const versions = sortVersions(existing)
  const latest = versions[versions.length - 1]
  if (!latest) return { ok: true, kind: 'create', create: { effectiveFrom, settings }, changes: describeChanges(null, settings) }

  if (effectiveFrom < latest.effectiveFrom) {
    return { ok: false, error: `This role's settings already change on ${latest.effectiveFrom}. Pick that date or later, or undo that change first.` }
  }
  if (effectiveFrom === latest.effectiveFrom) {
    const previous = versions[versions.length - 2]
    if (settingsEqual(latest, settings)) return { ok: false, error: 'Nothing changed.' }
    if (previous && settingsEqual(previous, settings)) {
      return { ok: true, kind: 'merge', delete: latest.id, reopen: previous.id, changes: describeChanges(latest, settings) }
    }
    return { ok: true, kind: 'replace', replace: { id: latest.id, settings }, changes: describeChanges(previous ?? null, settings) }
  }
  if (settingsEqual(latest, settings)) return { ok: false, error: 'Nothing changed.' }
  return {
    ok: true,
    kind: 'create',
    create: { effectiveFrom, settings },
    close: { id: latest.id, effectiveTo: effectiveFrom },
    changes: describeChanges(latest, settings),
  }
}

/** Undo the most recent change: drop the latest version and let the one before it run on. */
export function planUndoLatest(existing: RoleVersion[], locks: LockedRange[] = []):
  | { ok: true; delete: string; reopen: string; restores: RoleVersion }
  | { ok: false; error: string } {
  const versions = sortVersions(existing)
  const latest = versions[versions.length - 1]
  const previous = versions[versions.length - 2]
  if (!latest || !previous) return { ok: false, error: 'There is no earlier change to go back to.' }
  const locked = lockedThrough(locks)
  if (locked && latest.effectiveFrom <= locked) {
    return { ok: false, error: `Payroll is locked through ${locked}, which includes this change.` }
  }
  return { ok: true, delete: latest.id, reopen: previous.id, restores: previous }
}

/** Problems with a role's stored versions: overlaps, gaps, or more than one open-ended version. */
export function checkTimeline(versions: RoleVersion[]): string[] {
  const sorted = sortVersions(versions)
  const problems: string[] = []
  sorted.forEach((v, i) => {
    const next = sorted[i + 1]
    if (v.effectiveTo !== null && v.effectiveTo <= v.effectiveFrom) problems.push(`version ${v.id} ends before it starts`)
    if (next && v.effectiveTo === null) problems.push(`version ${v.id} is open-ended but ${next.id} starts later`)
    if (next && v.effectiveTo !== null && v.effectiveTo !== next.effectiveFrom) {
      problems.push(v.effectiveTo > next.effectiveFrom ? `versions ${v.id} and ${next.id} overlap` : `gap between ${v.id} and ${next.id}`)
    }
  })
  return problems
}

/**
 * The settings for one shift in the shape the payroll calculation reads. The calculation only ever
 * sees the version for that shift's date, so its own date checks always pass.
 */
export function toEngineRole(name: string, version: RoleVersion | null, shiftDay: DateOnly) {
  const from = `${version?.effectiveFrom ?? shiftDay}T00:00:00.000Z`
  const configs: RoleConfig[] = (version?.tipouts ?? []).map(t => ({
    id: `${version!.id}:${t.tipoutType}`,
    tipoutType: t.tipoutType,
    percentageRate: t.percentageRate,
    effectiveFrom: from,
    effectiveTo: null,
    paysTipout: t.paysTipout,
    receivesTipout: t.receivesTipout,
    distributionGroup: t.distributionGroup ?? undefined,
    tipPoolGroup: version?.tipPoolGroup ?? undefined,
  }))
  return {
    name,
    basePayRate: version?.basePayRate ?? 0,
    tipPoolGroup: version?.tipPoolGroup ?? null,
    versionId: version?.id ?? null,
    configs,
  }
}

/** Settings from a request body, with numbers and flags coerced. Unknown tipout types are dropped. */
export function parseSettings(input: unknown): RoleSettings {
  const raw = (input ?? {}) as { basePayRate?: unknown; tipPoolGroup?: unknown; tipouts?: unknown }
  const tipouts = Array.isArray(raw.tipouts) ? raw.tipouts : []
  return {
    basePayRate: Number(raw.basePayRate),
    tipPoolGroup: typeof raw.tipPoolGroup === 'string' ? raw.tipPoolGroup : null,
    tipouts: tipouts
      .map(t => t as Record<string, unknown>)
      .filter(t => TIPOUT_TYPES.includes(t.tipoutType as TipoutType))
      .map(t => ({
        tipoutType: t.tipoutType as TipoutType,
        percentageRate: Number(t.percentageRate ?? 0),
        paysTipout: t.paysTipout === true,
        receivesTipout: t.receivesTipout === true,
        distributionGroup: typeof t.distributionGroup === 'string' ? t.distributionGroup : null,
      })),
  }
}
