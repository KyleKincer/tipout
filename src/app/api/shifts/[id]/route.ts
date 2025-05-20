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
      where: {
        id: params.id,
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

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }
    
    const shiftDate = new Date(shift.date);
    let currentBasePayRate = 0;
    if (shift.role && shift.role.configs && shift.role.configs.length > 0) {
        // Configs are already sorted by effectiveFrom: 'desc' from the Prisma query
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

    // Convert Decimal values to numbers for JSON serialization
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
        configs: shift.role.configs.map((config: RoleConfig) => ({
          ...config,
          percentageRate: Number(config.percentageRate),
          basePayRate: config.basePayRate !== null ? Number(config.basePayRate) : 0
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

    const shiftDate = new Date(shift.date);
    let currentBasePayRate = 0;
    if (shift.role && shift.role.configs && shift.role.configs.length > 0) {
        // Configs are already sorted by effectiveFrom: 'desc' from the Prisma query
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
    
    // Convert Decimal values to numbers for JSON serialization
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