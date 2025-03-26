import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Define types for prisma role configuration
type RoleConfig = {
  id: string;
  tipoutType: string;
  percentageRate: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  receivesTipout?: boolean;
  paysTipout?: boolean;
  distributionGroup?: string | null;
  [key: string]: unknown;
};

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // First, get the shift
    const shift = await prisma.shift.findUnique({
      where: {
        id: params.id,
      },
      include: {
        employee: true,
        role: true,
      },
    })

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }

    // Get the shift date to find appropriate configs
    const shiftDate = new Date(shift.date)

    // Now get the role configs that were active on the shift date
    const roleConfigs = await prisma.roleConfig.findMany({
      where: {
        roleId: shift.roleId,
        OR: [
          { effectiveTo: null },
          {
            AND: [
              { effectiveFrom: { lte: shiftDate } },
              {
                OR: [
                  { effectiveTo: { gte: shiftDate } },
                  { effectiveTo: null }
                ]
              }
            ]
          }
        ]
      }
    })

    // Convert Decimal values to numbers for JSON serialization
    const serializedShift = {
      ...shift,
      hours: Number(shift.hours),
      cashTips: Number(shift.cashTips),
      creditTips: Number(shift.creditTips),
      liquorSales: Number(shift.liquorSales),
      role: shift.role ? {
        ...shift.role,
        basePayRate: Number(shift.role.basePayRate),
        configs: roleConfigs.map((config: RoleConfig) => ({
          ...config,
          percentageRate: Number(config.percentageRate)
        }))
      } : undefined
    }

    return NextResponse.json(serializedShift)
  } catch (error) {
    console.error('Error fetching shift:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shift' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    // Update shift without tipout calculations
    const shift = await prisma.shift.update({
      where: {
        id: params.id,
      },
      data: {
        employeeId,
        roleId,
        date: new Date(date),
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
                      { effectiveFrom: { lte: new Date(date) } },
                      {
                        OR: [
                          { effectiveTo: { gte: new Date(date) } },
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
    console.error('Error updating shift:', error)
    return NextResponse.json(
      { error: 'Failed to update shift' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.shift.delete({
      where: {
        id: params.id,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting shift:', error)
    return NextResponse.json(
      { error: 'Failed to delete shift' },
      { status: 500 }
    )
  }
} 