import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/prisma';

export async function GET() {
  try {
    const configsWithGroups = await db.roleConfig.findMany({
      where: {
        tipPoolGroup: {
          not: null, // Exclude null values
          notIn: [''], // Exclude empty strings if necessary
        },
      },
      select: {
        tipPoolGroup: true,
      },
      distinct: ['tipPoolGroup'], // Get distinct values
    });

    // Extract the names and filter out any potential nulls again just in case
    const groupNames = configsWithGroups
      .map(config => config.tipPoolGroup)
      .filter((group): group is string => group !== null && group !== ''); 

    return NextResponse.json(groupNames);
  } catch (error) {
    console.error("Error fetching tip pool groups:", error);
    return NextResponse.json({ message: 'Error fetching tip pool groups' }, { status: 500 });
  }
} 