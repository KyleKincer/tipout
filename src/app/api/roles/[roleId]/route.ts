import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { roleId: string } }
) {
  try {
    // Await params before accessing its properties
    const { roleId } = await params;
    
    const body = await request.json();
    const { name, basePayRate } = body;
    
    const updatedRole = await prisma.role.update({
      where: {
        id: roleId,
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
  { params }: { params: { roleId: string } }
) {
  try {
    // Await params before accessing its properties
    const { roleId } = await params;
    
    // First, delete all configurations associated with this role
    await prisma.roleConfiguration.deleteMany({
      where: {
        roleId,
      },
    });
    
    // Then delete the role itself
    await prisma.role.delete({
      where: {
        id: roleId,
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