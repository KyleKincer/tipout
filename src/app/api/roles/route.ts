import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const roles = await prisma.role.findMany({
      orderBy: {
        name: 'asc',
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        // basePayRate is no longer directly on Role, it's on RoleConfig
        configs: {
          orderBy: {
            effectiveFrom: 'desc', // Get the latest one first
          },
          select: {
            id: true,
            tipoutType: true,
            percentageRate: true,
            effectiveFrom: true,
            effectiveTo: true,
            paysTipout: true,
            receivesTipout: true, // ensure this is selected
            basePayRate: true,    // ensure this is selected
          },
        },
      },
    })

    // Convert Decimal to number for JSON serialization
    const serializedRoles = roles.map(role => {
      // Determine current basePayRate from the latest applicable config
      const currentConfig = role.configs.find(c => c.effectiveTo === null) || role.configs[0];
      const currentBasePayRate = currentConfig ? Number(currentConfig.basePayRate) : 0;

      return {
        id: role.id,
        name: role.name,
        basePayRate: currentBasePayRate, // This is the current effective base pay rate
        configs: role.configs.map(config => ({
          ...config,
          percentageRate: Number(config.percentageRate),
          basePayRate: Number(config.basePayRate),
        })),
      };
    })

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
        configs: {
          create: {
            basePayRate: parseFloat(basePayRate),
            effectiveFrom: new Date(),
            effectiveTo: null,
            tipoutType: "GENERAL_PAY_INFO", // Standard type for base pay configurations
            percentageRate: 0,
            receivesTipout: false,
            paysTipout: false,
          },
        },
      },
      select: {
        id: true,
        name: true,
        configs: { // Select configs to get the newly created one
          orderBy: {
            effectiveFrom: 'desc',
          },
          select: {
            id: true,
            tipoutType: true,
            percentageRate: true,
            effectiveFrom: true,
            effectiveTo: true,
            paysTipout: true,
            receivesTipout: true,
            basePayRate: true,
          },
        },
      },
    })

    // Convert Decimal to number for JSON serialization
    // The first config (latest) will have the basePayRate just set.
    const currentConfig = role.configs[0];
    const serializedRole = {
      id: role.id,
      name: role.name,
      basePayRate: currentConfig ? Number(currentConfig.basePayRate) : 0,
      configs: role.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
        basePayRate: Number(config.basePayRate),
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