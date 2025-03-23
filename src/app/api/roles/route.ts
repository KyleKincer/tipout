import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const roles = await prisma.role.findMany({
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        basePayRate: true,
        configs: {
          where: {
            effectiveTo: null,
          },
          select: {
            id: true,
            tipoutType: true,
            percentageRate: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        },
      },
    })

    // Convert Decimal to number for JSON serialization
    const serializedRoles = roles.map(role => ({
      ...role,
      basePayRate: Number(role.basePayRate),
      configs: role.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
      })),
    }))

    return NextResponse.json(serializedRoles)
  } catch (error) {
    console.error('Error fetching roles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch roles' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, basePayRate } = body

    if (!name || basePayRate === undefined) {
      return NextResponse.json(
        { error: 'Name and base pay rate are required' },
        { status: 400 }
      )
    }

    const role = await prisma.role.create({
      data: {
        name,
        basePayRate: parseFloat(basePayRate),
      },
      select: {
        id: true,
        name: true,
        basePayRate: true,
        configs: true,
      },
    })

    // Convert Decimal to number for JSON serialization
    const serializedRole = {
      ...role,
      basePayRate: Number(role.basePayRate),
      configs: role.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
      })),
    }

    return NextResponse.json(serializedRole)
  } catch (error) {
    console.error('Error creating role:', error)
    return NextResponse.json(
      { error: 'Failed to create role' },
      { status: 500 }
    )
  }
} 