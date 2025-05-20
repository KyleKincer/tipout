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
        configs: { // Fetch all configs to determine the current one
          orderBy: {
            effectiveFrom: 'desc',
          },
          select: { // Explicitly select all needed fields from RoleConfig
            id: true,
            tipoutType: true,
            percentageRate: true,
            effectiveFrom: true,
            effectiveTo: true,
            paysTipout: true,
            receivesTipout: true,
            distributionGroup: true,
            tipPoolGroup: true,
            basePayRate: true,
          },
        },
      },
    });

    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Determine current basePayRate from the latest applicable config
    const currentConfig = role.configs.find(c => c.effectiveTo === null) || role.configs[0];
    const currentBasePayRate = currentConfig ? Number(currentConfig.basePayRate) : 0;

    const serializedRole = {
      id: role.id,
      name: role.name,
      basePayRate: currentBasePayRate, // Current effective base pay rate
      configs: role.configs.map(config => ({
        ...config,
        percentageRate: Number(config.percentageRate),
        basePayRate: Number(config.basePayRate),
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
    const { id } = await params;
    const body = await request.json();
    const { name, basePayRate } = body;

    let updatedRoleData;

    if (basePayRate !== undefined) {
      const newBasePayRate = parseFloat(basePayRate);

      updatedRoleData = await prisma.$transaction(async (tx) => {
        const currentActiveConfig = await tx.roleConfig.findFirst({
          where: {
            roleId: id,
            effectiveTo: null,
          },
          orderBy: {
            effectiveFrom: 'desc',
          },
        });

        let previousConfigData = { // Defaults if no previous config
            tipoutType: "GENERAL_PAY_INFO",
            percentageRate: 0,
            receivesTipout: false,
            paysTipout: false,
            distributionGroup: null,
            tipPoolGroup: null,
        };

        if (currentActiveConfig) {
          await tx.roleConfig.update({
            where: { id: currentActiveConfig.id },
            data: { effectiveTo: new Date() },
          });
          // Carry over settings from the previous config
          previousConfigData = {
            tipoutType: currentActiveConfig.tipoutType,
            percentageRate: currentActiveConfig.percentageRate, // Keep existing rate for other types
            receivesTipout: currentActiveConfig.receivesTipout,
            paysTipout: currentActiveConfig.paysTipout,
            distributionGroup: currentActiveConfig.distributionGroup,
            tipPoolGroup: currentActiveConfig.tipPoolGroup,
          };
        }
        
        // If this specific update is for basePayRate, ensure tipoutType reflects that
        // If other types of configs are managed elsewhere, this might need adjustment
        // For now, assume changing basePayRate means this config is primarily for pay info.
        if (basePayRate !== undefined) {
            previousConfigData.tipoutType = "GENERAL_PAY_INFO";
            // If it's a general pay info config, other tip-related rates might be zeroed out
            // This depends on how "GENERAL_PAY_INFO" configs are interpreted vs. specific tipout configs.
            // For now, we only set basePayRate and keep other financial fields from prev config or default.
        }


        await tx.roleConfig.create({
          data: {
            roleId: id,
            basePayRate: newBasePayRate,
            effectiveFrom: new Date(),
            effectiveTo: null,
            tipoutType: previousConfigData.tipoutType,
            percentageRate: previousConfigData.percentageRate, // Use existing or default
            receivesTipout: previousConfigData.receivesTipout, // Use existing or default
            paysTipout: previousConfigData.paysTipout,         // Use existing or default
            distributionGroup: previousConfigData.distributionGroup,
            tipPoolGroup: previousConfigData.tipPoolGroup,
          },
        });

        if (name) {
          return tx.role.update({
            where: { id: id },
            data: { name },
            include: { configs: { orderBy: { effectiveFrom: 'desc' } } },
          });
        }
        return tx.role.findUnique({
          where: { id: id },
          include: { configs: { orderBy: { effectiveFrom: 'desc' } } },
        });
      });
    } else if (name) {
      updatedRoleData = await prisma.role.update({
        where: { id: id },
        data: { name },
        include: { configs: { orderBy: { effectiveFrom: 'desc' } } },
      });
    } else {
      // No actual update data provided
      return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
    }
    
    if (!updatedRoleData) {
        return NextResponse.json({ error: 'Role not found or failed to update' }, { status: 404 });
    }

    const finalCurrentConfig = updatedRoleData.configs.find(c => c.effectiveTo === null) || updatedRoleData.configs[0];
    const finalBasePayRate = finalCurrentConfig ? Number(finalCurrentConfig.basePayRate) : 0;

    const serializedRole = {
      id: updatedRoleData.id,
      name: updatedRoleData.name,
      basePayRate: finalBasePayRate,
      configs: updatedRoleData.configs.map(config => ({
        ...config,
        basePayRate: Number(config.basePayRate),
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
    const { id } = await params;
    const body = await request.json();
    const { name, basePayRate } = body;

    if (!name && basePayRate === undefined) {
      return NextResponse.json(
        { error: 'Name or base pay rate is required for update' },
        { status: 400 }
      );
    }
    
    // PUT should fully replace the resource's updatable fields or create if not existing.
    // Prisma's update acts like upsert if we ensure required fields for creation are present.
    // However, for this specific scenario, we'll treat PUT as a comprehensive update.

    let updatedRoleData;

    // Transaction for basePayRate change (similar to PATCH)
    if (basePayRate !== undefined) {
        const newBasePayRate = parseFloat(basePayRate);
        updatedRoleData = await prisma.$transaction(async (tx) => {
            const currentActiveConfig = await tx.roleConfig.findFirst({
                where: { roleId: id, effectiveTo: null },
                orderBy: { effectiveFrom: 'desc' },
            });

            let previousConfigData = {
                tipoutType: "GENERAL_PAY_INFO", percentageRate: 0, receivesTipout: false,
                paysTipout: false, distributionGroup: null, tipPoolGroup: null,
            };

            if (currentActiveConfig) {
                await tx.roleConfig.update({
                    where: { id: currentActiveConfig.id },
                    data: { effectiveTo: new Date() },
                });
                previousConfigData = {
                    tipoutType: currentActiveConfig.tipoutType,
                    percentageRate: currentActiveConfig.percentageRate,
                    receivesTipout: currentActiveConfig.receivesTipout,
                    paysTipout: currentActiveConfig.paysTipout,
                    distributionGroup: currentActiveConfig.distributionGroup,
                    tipPoolGroup: currentActiveConfig.tipPoolGroup,
                };
            }
            
            // If basePayRate is being set, this config is for general pay info.
            if (basePayRate !== undefined) {
                 previousConfigData.tipoutType = "GENERAL_PAY_INFO";
            }

            await tx.roleConfig.create({
                data: {
                    roleId: id, basePayRate: newBasePayRate, effectiveFrom: new Date(), effectiveTo: null,
                    tipoutType: previousConfigData.tipoutType,
                    percentageRate: previousConfigData.percentageRate,
                    receivesTipout: previousConfigData.receivesTipout,
                    paysTipout: previousConfigData.paysTipout,
                    distributionGroup: previousConfigData.distributionGroup,
                    tipPoolGroup: previousConfigData.tipPoolGroup,
                },
            });

            return tx.role.update({
                where: { id: id },
                // If name is not provided in PUT, it should ideally clear it or be required.
                // For this implementation, we only update if 'name' is explicitly provided.
                data: { ...(name && { name }) }, 
                include: { configs: { orderBy: { effectiveFrom: 'desc' } } },
            });
        });
    } else if (name) { // Only name is updated
        updatedRoleData = await prisma.role.update({
            where: { id: id },
            data: { name },
            include: { configs: { orderBy: { effectiveFrom: 'desc' } } },
        });
    } else {
      // Should not happen if check at the beginning is correct
      return NextResponse.json({ error: 'Invalid data for PUT request' }, { status: 400 });
    }

    if (!updatedRoleData) {
        return NextResponse.json({ error: 'Role not found or failed to update' }, { status: 404 });
    }

    const finalCurrentConfig = updatedRoleData.configs.find(c => c.effectiveTo === null) || updatedRoleData.configs[0];
    const finalBasePayRate = finalCurrentConfig ? Number(finalCurrentConfig.basePayRate) : 0;

    const serializedRole = {
      id: updatedRoleData.id,
      name: updatedRoleData.name,
      basePayRate: finalBasePayRate,
      configs: updatedRoleData.configs.map(config => ({
        ...config,
        basePayRate: Number(config.basePayRate),
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