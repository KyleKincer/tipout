import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, HttpError, requireUser } from '@/lib/apiAuth'
import { buildReport } from '@/lib/reportData'
import { isDateOnly } from '@/utils/roleVersions'

/**
 * Payroll results for a date range. Each shift is calculated with the role settings in effect on
 * its own date, and days inside a locked pay period return the saved, as-paid results.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUser()
    const startDate = request.nextUrl.searchParams.get('startDate')
    const endDate = request.nextUrl.searchParams.get('endDate')
    if (!isDateOnly(startDate) || !isDateOnly(endDate)) throw new HttpError(400, 'Pick a start and end date.')
    if (endDate < startDate) throw new HttpError(400, 'The end date has to be on or after the start date.')
    return NextResponse.json(await buildReport(prisma, startDate, endDate))
  } catch (error) {
    return errorResponse(error, 'Error generating report data')
  }
}
