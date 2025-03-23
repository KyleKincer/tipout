import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { RoleConfiguration } from '@prisma/client'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')

    const where = {
      ...(startDate && {
        date: {
          gte: new Date(startDate),
        },
      }),
      ...(endDate && {
        date: {
          lte: new Date(endDate),
        },
      }),
      ...(employeeId && {
        employeeId,
      }),
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        employee: true,
        role: true,
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
      barTipout: Number(shift.barTipout),
      hostTipout: Number(shift.hostTipout),
      saTipout: Number(shift.saTipout),
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

    // Get role configuration for tipout calculations
    const roleConfigs = await prisma.roleConfiguration.findMany({
      where: {
        roleId,
        effectiveTo: null, // Get current active configurations
      },
    })

    // Calculate total tips
    const totalTips = Number(cashTips || 0) + Number(creditTips || 0)

    // Calculate tipouts based on role configurations
    const tipouts = roleConfigs.reduce((acc: Record<string, number>, config: RoleConfiguration) => {
      let amount = 0
      switch (config.tipoutType) {
        case 'bar':
          amount = (Number(liquorSales) || 0) * (Number(config.percentageRate) / 100)
          break
        case 'host':
          amount = totalTips * (Number(config.percentageRate) / 100)
          break
        case 'sa':
          amount = totalTips * (Number(config.percentageRate) / 100)
          break
      }
      acc[`${config.tipoutType}Tipout`] = amount
      return acc
    }, {} as Record<string, number>)

    // Create shift with calculated tipouts
    const shift = await prisma.shift.create({
      data: {
        employeeId,
        roleId,
        date: new Date(date),
        hours: Number(hours),
        cashTips: Number(cashTips || 0),
        creditTips: Number(creditTips || 0),
        liquorSales: Number(liquorSales || 0),
        ...tipouts,
      },
      include: {
        employee: true,
        role: true,
      },
    })

    // Convert Decimal values to numbers for JSON serialization
    const serializedShift = {
      ...shift,
      hours: Number(shift.hours),
      cashTips: Number(shift.cashTips),
      creditTips: Number(shift.creditTips),
      liquorSales: Number(shift.liquorSales),
      barTipout: Number(shift.barTipout),
      hostTipout: Number(shift.hostTipout),
      saTipout: Number(shift.saTipout),
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