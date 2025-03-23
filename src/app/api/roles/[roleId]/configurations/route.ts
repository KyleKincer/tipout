import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  context: { params: { roleId: string } }
) {
  try {
    // Get the roleId from params
    const { roleId } = context.params;
    
    const configurations = await prisma.roleConfiguration.findMany({
      where: {
        roleId,
        effectiveTo: null, // Get current active configurations
      },
      orderBy: {
        effectiveFrom: 'desc',
      },
    })
    return NextResponse.json(configurations)
  } catch (error) {
    console.error('Error fetching role configurations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch role configurations' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { roleId: string } }
) {
  try {
    // Get the roleId from params
    const { roleId } = context.params;
    
    const body = await request.json()
    const { tipoutType, percentageRate } = body

    if (!tipoutType || percentageRate === undefined) {
      return NextResponse.json(
        { error: 'Tipout type and percentage rate are required' },
        { status: 400 }
      )
    }

    // End any existing configuration for this tipout type
    await prisma.roleConfiguration.updateMany({
      where: {
        roleId,
        tipoutType,
        effectiveTo: null,
      },
      data: {
        effectiveTo: new Date(),
      },
    })

    // Create new configuration
    const configuration = await prisma.roleConfiguration.create({
      data: {
        roleId,
        tipoutType,
        percentageRate: parseFloat(percentageRate),
        effectiveFrom: new Date(),
      },
    })

    return NextResponse.json(configuration)
  } catch (error) {
    console.error('Error creating role configuration:', error)
    return NextResponse.json(
      { error: 'Failed to create role configuration' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { roleId: string } }
) {
  try {
    // Get the roleId from params
    const { roleId } = context.params;
    
    // Get the tipout type from the request
    const { searchParams } = new URL(request.url);
    const tipoutType = searchParams.get('tipoutType');
    
    if (!tipoutType) {
      return NextResponse.json(
        { error: 'Tipout type is required' },
        { status: 400 }
      );
    }
    
    // End all configurations for this tipout type
    await prisma.roleConfiguration.updateMany({
      where: {
        roleId,
        tipoutType,
        effectiveTo: null,
      },
      data: {
        effectiveTo: new Date(),
      },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing role configuration:', error);
    return NextResponse.json(
      { error: 'Failed to remove role configuration' },
      { status: 500 }
    );
  }
} 