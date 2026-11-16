import { v } from 'convex/values'
import { query } from './_generated/server'
import { fail, requireUser } from './lib/auth'
import { buildReport } from './lib/reports'
import { isDateOnly } from '../src/utils/roleVersions'

/**
 * Payroll results for a date range. Each shift is calculated with the role settings in effect on
 * its own date, and days inside a locked pay period return the saved, as-paid results.
 */
export const get = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    await requireUser(ctx)
    if (!isDateOnly(startDate) || !isDateOnly(endDate)) fail(400, 'Pick a start and end date.')
    if (endDate < startDate) fail(400, 'The end date has to be on or after the start date.')
    return buildReport(ctx, startDate, endDate)
  },
})
