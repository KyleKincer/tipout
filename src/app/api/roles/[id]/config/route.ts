import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params
    
    const configs = await prisma.roleConfig.findMany({
      where: {
        roleId: id
      }
    })
    
    return NextResponse.json(configs)
  } catch (error) {
    console.error('Error fetching role configs:', error)
    return NextResponse.json({ error: 'Failed to fetch role configs' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params
    const data = await request.json()
    
    // Delete existing configs for this role
    await prisma.roleConfig.deleteMany({
      where: {
        roleId: id
      }
    })
    
    // Create new configs
    const configs = await Promise.all(
      data.map((config: any) => 
        prisma.roleConfig.create({
          data: {
            roleId: id,
            tipoutType: config.tipoutType,
            percentageRate: config.percentageRate,
            effectiveFrom: new Date(config.effectiveFrom),
            effectiveTo: config.effectiveTo ? new Date(config.effectiveTo) : null,
            receivesTipout: config.receivesTipout,
            paysTipout: config.paysTipout,
            distributionGroup: config.distributionGroup
          }
        })
      )
    )
    
    return NextResponse.json(configs)
  } catch (error) {
    console.error('Error updating role configs:', error)
    return NextResponse.json({ error: 'Failed to update role configs' }, { status: 500 })
  }
} 