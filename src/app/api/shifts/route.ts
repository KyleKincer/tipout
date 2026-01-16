import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Helper function to ensure consistent date handling
function parseDate(dateString: string): Date {
  // Create date in UTC to match database storage
  const date = new Date(dateString + 'T00:00:00.000Z')
  return date
}

// Helper function to get the end of a day
function getEndOfDay(dateString: string): Date {
  // Create date in UTC to match database storage
  const date = new Date(dateString + 'T23:59:59.999Z')
  return date
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const role = searchParams.get('role')

    // Modified where clause for date handling
    let where: any = {}
    
    if (employeeId) {
      where.employeeId = employeeId
    }
    
    if (role) {
      where.role = {
        name: role
      }
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
            configs: { // Fetch all configs for the role to determine the active one based on shift date
              orderBy: {
                effectiveFrom: 'desc' 
              },
              select: { // Ensure all necessary fields are selected
                id: true,
                tipoutType: true,
                percentageRate: true,
                effectiveFrom: true,
                effectiveTo: true,
                paysTipout: true,
                receivesTipout: true,
                distributionGroup: true,
                tipPoolGroup: true,
                basePayRate: true, // Crucial: ensure basePayRate is fetched
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
    const serializedShifts = shifts.map(shift => {
      const shiftDate = new Date(shift.date);
      let currentBasePayRate = 0;
      if (shift.role && shift.role.configs && shift.role.configs.length > 0) {
        // Already sorted by effectiveFrom: 'desc' in the query
        const activeConfig = shift.role.configs.find(config => {
            const effectiveFrom = new Date(config.effectiveFrom);
            const isAfterOrOnFrom = shiftDate >= effectiveFrom;
            if (!isAfterOrOnFrom) return false;
            if (config.effectiveTo) {
                const effectiveTo = new Date(config.effectiveTo);
                return shiftDate <= effectiveTo;
            }
            return true; // No effectiveTo means active indefinitely from effectiveFrom
        });
        if (activeConfig && activeConfig.basePayRate !== null) { // check for null
            currentBasePayRate = Number(activeConfig.basePayRate);
        }
      }

      return {
        ...shift,
        hours: Number(shift.hours),
        cashTips: Number(shift.cashTips),
        creditTips: Number(shift.creditTips),
        liquorSales: Number(shift.liquorSales),
        role: shift.role ? {
          id: shift.role.id,
          name: shift.role.name,
          basePayRate: currentBasePayRate, // Active base pay rate for the shift's date
          configs: shift.role.configs.map(config => ({
            ...config,
            percentageRate: Number(config.percentageRate),
            basePayRate: config.basePayRate !== null ? Number(config.basePayRate) : 0 // Ensure individual configs also serialize it
          }))
        } : undefined,
      };
    })

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
            configs: { // Fetch all configs for the role
              orderBy: {
                effectiveFrom: 'desc'
              },
              select: { // Ensure all necessary fields are selected
                id: true,
                tipoutType: true,
                percentageRate: true,
                effectiveFrom: true,
                effectiveTo: true,
                paysTipout: true,
                receivesTipout: true,
                distributionGroup: true,
                tipPoolGroup: true,
                basePayRate: true, // Crucial: ensure basePayRate is fetched
              }
            }
          }
        }
      },
    })

    // Convert Decimal values to numbers for JSON serialization
    const shiftDate = new Date(shift.date);
    let currentBasePayRate = 0;
    if (shift.role && shift.role.configs && shift.role.configs.length > 0) {
      // Already sorted by effectiveFrom: 'desc' in the query
      const activeConfig = shift.role.configs.find(config => {
          const effectiveFrom = new Date(config.effectiveFrom);
          const isAfterOrOnFrom = shiftDate >= effectiveFrom;
          if (!isAfterOrOnFrom) return false;
          if (config.effectiveTo) {
              const effectiveTo = new Date(config.effectiveTo);
              return shiftDate <= effectiveTo;
          }
          return true; // No effectiveTo means active indefinitely from effectiveFrom
      });
      if (activeConfig && activeConfig.basePayRate !== null) {
          currentBasePayRate = Number(activeConfig.basePayRate);
      }
    }

    const serializedShift = {
      ...shift,
      hours: Number(shift.hours),
      cashTips: Number(shift.cashTips),
      creditTips: Number(shift.creditTips),
      liquorSales: Number(shift.liquorSales),
      role: shift.role ? {
        id: shift.role.id,
        name: shift.role.name,
        basePayRate: currentBasePayRate, // Active base pay rate for the shift's date
        configs: shift.role.configs.map(config => ({
          ...config,
          percentageRate: Number(config.percentageRate),
          basePayRate: config.basePayRate !== null ? Number(config.basePayRate) : 0
        }))
      } : undefined,
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