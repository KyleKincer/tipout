import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Await params before accessing its properties
    const { id } = await params;
    
    const role = await prisma.role.findUnique({
      where: {
        id: id,
      },
      include: {
        configs: {
          where: {
            effectiveTo: null,
          },
        },
      },
    });
    
    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }
    
    // Convert Decimal to number for JSON serialization
    const serializedRole = {
      ...role,
      basePayRate: Number(role.basePayRate),
      configs: role.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
      })),
    };
    
    return NextResponse.json(serializedRole);
  } catch (error) {
    console.error('Error fetching role:', error);
    return NextResponse.json(
      { error: 'Failed to fetch role' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Await params before accessing its properties
    const { id } = await params;
    
    const body = await request.json();
    const { name, basePayRate } = body;
    
    const updatedRole = await prisma.role.update({
      where: {
        id: id,
      },
      data: {
        ...(name && { name }),
        ...(basePayRate !== undefined && { basePayRate: parseFloat(basePayRate) }),
      },
      include: {
        configs: {
          where: {
            effectiveTo: null,
          },
        },
      },
    });
    
    // Convert Decimal to number for JSON serialization
    const serializedRole = {
      ...updatedRole,
      basePayRate: Number(updatedRole.basePayRate),
      configs: updatedRole.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
      })),
    };
    
    return NextResponse.json(serializedRole);
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Await params before accessing its properties
    const { id } = await params;
    
    // First, delete all configurations associated with this role
    await prisma.roleConfig.deleteMany({
      where: {
        roleId: id,
      },
    });
    
    // Then delete the role itself
    await prisma.role.delete({
      where: {
        id: id,
      },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting role:', error);
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Await params before accessing its properties
    const { id } = await params;
    
    const body = await request.json();
    const { name, basePayRate } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    
    const updatedRole = await prisma.role.update({
      where: {
        id: id,
      },
      data: {
        name,
        basePayRate: basePayRate !== undefined ? parseFloat(basePayRate.toString()) : undefined,
      },
      include: {
        configs: {
          where: {
            effectiveTo: null,
          },
        },
      },
    });
    
    // Convert Decimal to number for JSON serialization
    const serializedRole = {
      ...updatedRole,
      basePayRate: Number(updatedRole.basePayRate),
      configs: updatedRole.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
      })),
    };
    
    return NextResponse.json(serializedRole);
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
} 