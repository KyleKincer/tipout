import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Helper function to ensure consistent date handling
function parseDate(dateString: string): Date {
  const date = new Date(dateString)
  // Set to start of day in local timezone
  date.setHours(0, 0, 0, 0)
  return date
}

// Helper function to get the end of a day
function getEndOfDay(dateString: string): Date {
  const date = new Date(dateString)
  // Set to end of day in local timezone
  date.setHours(23, 59, 59, 999)
  return date
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')

    // Modified where clause for date handling
    let where: any = {}
    
    if (employeeId) {
      where.employeeId = employeeId
    }
    
    if (startDate && endDate) {
      if (startDate === endDate) {
        // If startDate and endDate are the same, use a date range for that single day
        where.date = {
          gte: parseDate(startDate),
          lte: getEndOfDay(startDate), 
        }
      } else {
        // Normal date range
        where.date = {
          gte: parseDate(startDate),
          lte: getEndOfDay(endDate), // Changed from lt to lte with getEndOfDay
        }
      }
    } else if (startDate) {
      where.date = {
        gte: parseDate(startDate),
        lte: getEndOfDay(startDate), // For a single date, include all hours in that day
      }
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        employee: true,
        role: {
          include: {
            configs: {
              where: {
                OR: [
                  { effectiveTo: null },
                  {
                    AND: [
                      { effectiveFrom: { lte: getEndOfDay(endDate || startDate || new Date().toISOString().split('T')[0]) } },
                      {
                        OR: [
                          { effectiveTo: { gte: parseDate(startDate || new Date().toISOString().split('T')[0]) } },
                          { effectiveTo: null }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      orderBy: {
        date: 'desc',
      },
    })

    // Convert Decimal values to numbers for JSON serialization
    const serializedShifts = shifts.map(shift => ({
      ...shift,
      hours: Number(shift.hours),
      cashTips: Number(shift.cashTips),
      creditTips: Number(shift.creditTips),
      liquorSales: Number(shift.liquorSales),
      role: {
        ...shift.role,
        basePayRate: Number(shift.role.basePayRate),
        configs: shift.role.configs.map(config => ({
          ...config,
          percentageRate: Number(config.percentageRate)
        }))
      }
    }))

    return NextResponse.json(serializedShifts)
  } catch (error) {
    console.error('Error fetching shifts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shifts' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      employeeId,
      roleId,
      date,
      hours,
      cashTips,
      creditTips,
      liquorSales,
    } = body

    // Validate required fields
    if (!employeeId || !roleId || !date || hours === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create shift without tipout calculations
    const shift = await prisma.shift.create({
      data: {
        employeeId,
        roleId,
        date: parseDate(date),
        hours: Number(hours),
        cashTips: Number(cashTips || 0),
        creditTips: Number(creditTips || 0),
        liquorSales: Number(liquorSales || 0),
      },
      include: {
        employee: true,
        role: {
          include: {
            configs: {
              where: {
                OR: [
                  { effectiveTo: null },
                  {
                    AND: [
                      { effectiveFrom: { lte: getEndOfDay(date) } },
                      {
                        OR: [
                          { effectiveTo: { gte: parseDate(date) } },
                          { effectiveTo: null }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
    })

    // Convert Decimal values to numbers for JSON serialization
    const serializedShift = {
      ...shift,
      hours: Number(shift.hours),
      cashTips: Number(shift.cashTips),
      creditTips: Number(shift.creditTips),
      liquorSales: Number(shift.liquorSales),
      role: {
        ...shift.role,
        basePayRate: Number(shift.role.basePayRate),
        configs: shift.role.configs.map(config => ({
          ...config,
          percentageRate: Number(config.percentageRate)
        }))
      }
    }

    return NextResponse.json(serializedShift)
  } catch (error) {
    console.error('Error creating shift:', error)
    return NextResponse.json(
      { error: 'Failed to create shift' },
      { status: 500 }
    )
  }
} 