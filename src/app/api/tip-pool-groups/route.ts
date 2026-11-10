import { NextResponse } from 'next/server'
import { usesConvex, viaConvex } from '@/lib/convexServer'
import { api } from '@convex/_generated/api'
import { prisma } from '@/lib/prisma'
import { errorResponse, requireUser } from '@/lib/apiAuth'

/** Pool names and tipout-sharing group names used by any role, for the settings form's suggestions. */
export async function GET() {
  if (usesConvex()) return viaConvex('Error fetching tip pool groups', c => c.query(api.roles.groups, {}))
  try {
    await requireUser()
    const [pools, groups] = await Promise.all([
      prisma.roleVersion.findMany({ where: { tipPoolGroup: { not: null } }, select: { tipPoolGroup: true }, distinct: ['tipPoolGroup'] }),
      prisma.roleVersionTipout.findMany({ where: { distributionGroup: { not: null } }, select: { distributionGroup: true }, distinct: ['distributionGroup'] }),
    ])
    return NextResponse.json({
      pools: pools.map(p => p.tipPoolGroup!).filter(Boolean).sort(),
      distributionGroups: groups.map(g => g.distributionGroup!).filter(Boolean).sort(),
    })
  } catch (error) {
    return errorResponse(error, 'Error fetching tip pool groups')
  }
}
