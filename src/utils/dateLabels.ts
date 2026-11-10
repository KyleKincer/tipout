import { addDays, type DateOnly } from './roleVersions'

const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** "Nov 16, 2026" for a YYYY-MM-DD date. */
export const formatDay = (day: DateOnly) => fmt.format(new Date(`${day}T00:00:00.000Z`))

/** "Mar 24, 2025 – May 6, 2025" or "since Nov 16, 2026" for a version's [from, to) range. */
export function formatSpan(from: DateOnly, to: DateOnly | null) {
  return to ? `${formatDay(from)} – ${formatDay(addDays(to, -1))}` : `since ${formatDay(from)}`
}
