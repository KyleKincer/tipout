import { addDays, normalizeSettings, settingsEqual, TIPOUT_TYPES, toDateOnly, type DateOnly, type RoleSettings } from './roleVersions'

/**
 * One-time conversion of the old RoleConfig rows into dated versions. It reproduces exactly what
 * the old calculation did for a shift on each date: for each tipout type, the first config (in the
 * order the database returned them) whose effectiveFrom <= shift date <= effectiveTo applied, and
 * the role was pooled if any config active that day named a pool.
 */
export type LegacyConfig = {
  tipoutType: string
  percentageRate: number
  effectiveFrom: string
  effectiveTo: string | null
  paysTipout?: boolean | null
  receivesTipout?: boolean | null
  distributionGroup?: string | null
  tipPoolGroup?: string | null
}

const instant = (iso: string) => new Date(iso).getTime()
const shiftInstant = (day: DateOnly) => instant(`${day}T00:00:00.000Z`)
const activeOn = (c: LegacyConfig, day: DateOnly) =>
  instant(c.effectiveFrom) <= shiftInstant(day) && (c.effectiveTo === null || shiftInstant(day) <= instant(c.effectiveTo))

export function legacySettingsOn(configs: LegacyConfig[], basePayRate: number, day: DateOnly): RoleSettings {
  const tipouts = TIPOUT_TYPES.flatMap(type => {
    const c = configs.find(x => x.tipoutType === type && activeOn(x, day))
    if (!c) return []
    return [{
      tipoutType: type,
      percentageRate: Number(c.percentageRate),
      paysTipout: c.paysTipout !== false,
      receivesTipout: !!c.receivesTipout,
      distributionGroup: c.distributionGroup ?? null,
    }]
  })
  // A config that receives a tipout but is also flagged as paying 0% of it pays nothing; drop the flag.
  for (const t of tipouts) if (t.receivesTipout && t.paysTipout && t.percentageRate === 0) t.paysTipout = false
  const pool = configs.find(c => c.tipPoolGroup && activeOn(c, day))?.tipPoolGroup ?? null
  return normalizeSettings({ basePayRate, tipPoolGroup: pool, tipouts })
}

/** First shift date each config applies to, and the first date after it stops applying. */
function boundaries(configs: LegacyConfig[]): DateOnly[] {
  const days = new Set<DateOnly>()
  for (const c of configs) {
    const fromDay = toDateOnly(c.effectiveFrom)
    days.add(shiftInstant(fromDay) >= instant(c.effectiveFrom) ? fromDay : addDays(fromDay, 1))
    if (c.effectiveTo) days.add(addDays(toDateOnly(c.effectiveTo), 1))
  }
  return [...days].sort()
}

export type LegacyVersion = { effectiveFrom: DateOnly; effectiveTo: DateOnly | null; settings: RoleSettings }

/** The dated versions that give the same settings as the old configs on every date from firstDay on. */
export function versionsFromLegacy(configs: LegacyConfig[], basePayRate: number, firstDay: DateOnly): LegacyVersion[] {
  const starts = [firstDay, ...boundaries(configs).filter(d => d > firstDay)]
  const versions: LegacyVersion[] = []
  for (const start of starts) {
    const settings = legacySettingsOn(configs, basePayRate, start)
    const last = versions[versions.length - 1]
    if (last && settingsEqual(last.settings, settings)) continue
    if (last) last.effectiveTo = start
    versions.push({ effectiveFrom: start, effectiveTo: null, settings })
  }
  return versions
}
