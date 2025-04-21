import { NextRequest, NextResponse } from 'next/server';
import { calculateOverallSummary, calculateEmployeeRoleSummariesDaily } from '@/utils/reportCalculations';
import { Shift as ReportShift } from '@/types/reports';
import { prisma as db } from '@/lib/prisma';
import { Shift as PrismaShift, Employee as PrismaEmployee, Role as PrismaRole, RoleConfig as PrismaRoleConfig } from '@prisma/client';

// This helps avoid using 'any'. Define it based on your actual include/select query.
type ShiftWithIncludes = PrismaShift & {
    employee: Pick<PrismaEmployee, 'id' | 'name'> | null; // Or PrismaEmployee if all fields selected
    role: (PrismaRole & {
        configs: PrismaRoleConfig[];
    }) | null;
};

async function fetchShiftsFromDB(startDate: string, endDate: string): Promise<ReportShift[]> {
    console.log(`Fetching shifts from DB: ${startDate} to ${endDate}`);

    // Construct date objects for range query
    const startDateTime = new Date(startDate + 'T00:00:00.000Z');
    const endDateTime = new Date(endDate + 'T23:59:59.999Z');

    // First, fetch all active role configs for the period
    const roleConfigs = await db.roleConfig.findMany({
        where: {
            OR: [
                {
                    effectiveFrom: { lte: endDateTime },
                    effectiveTo: null,
                },
                {
                    effectiveFrom: { lte: endDateTime },
                    effectiveTo: { gte: startDateTime },
                },
            ],
        },
    });

    // Use the defined type for the result
    const shifts: ShiftWithIncludes[] = await db.shift.findMany({
        where: {
            date: {
                gte: startDateTime,
                lte: endDateTime,
            },
        },
        include: {
            employee: {
                select: { id: true, name: true },
            },
            role: {
                select: {
                    id: true,
                    name: true,
                    basePayRate: true,
                    createdAt: true,
                    updatedAt: true,
                    configs: true,
                },
            },
        },
        orderBy: {
            date: 'asc',
        },
    });

    // Map Prisma result to the ReportShift type
    const reportShifts: ReportShift[] = shifts.filter(
        (shift): shift is ShiftWithIncludes & { employee: NonNullable<ShiftWithIncludes['employee']>, role: NonNullable<ShiftWithIncludes['role']> } =>
            !!shift.employee && !!shift.role
    ).map((shift) => ({
        id: shift.id,
        date: shift.date.toISOString(),
        hours: Number(shift.hours),
        cashTips: Number(shift.cashTips),
        creditTips: Number(shift.creditTips),
        liquorSales: Number(shift.liquorSales),
        employee: {
            id: shift.employee.id,
            name: shift.employee.name,
        },
        role: {
            name: shift.role.name,
            basePayRate: Number(shift.role.basePayRate),
            configs: (shift.role.configs || []).map((config) => ({
                id: config.id,
                tipoutType: config.tipoutType,
                percentageRate: Number(config.percentageRate),
                effectiveFrom: config.effectiveFrom.toISOString(),
                effectiveTo: config.effectiveTo ? config.effectiveTo.toISOString() : null,
                receivesTipout: config.receivesTipout ?? true,
                paysTipout: config.paysTipout ?? true,
                distributionGroup: config.distributionGroup ?? undefined,
            })),
        },
    }));

    return reportShifts;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
        return NextResponse.json({ message: 'Missing required date parameters (startDate, endDate)' }, { status: 400 });
    }

    try {
        // Fetch raw shift data from DB for the date range
        const allShiftsData = await fetchShiftsFromDB(startDate, endDate);

        if (!allShiftsData || allShiftsData.length === 0) {
            return NextResponse.json({ summary: null, employeeSummaries: [] });
        }

        // Get unique roles and their current configs
        const roleConfigMap = new Map();
        allShiftsData.forEach(shift => {
            if (!roleConfigMap.has(shift.role.name)) {
                const roleConfigs = {
                    bar: shift.role.configs.find(c => c.tipoutType === 'bar')?.percentageRate || 0,
                    host: shift.role.configs.find(c => c.tipoutType === 'host')?.percentageRate || 0,
                    sa: shift.role.configs.find(c => c.tipoutType === 'sa')?.percentageRate || 0,
                };
                roleConfigMap.set(shift.role.name, roleConfigs);
            }
        });

        // Convert the map to an object for the response
        const roleConfigs = Object.fromEntries(roleConfigMap);

        // Calculate summaries
        const summary = calculateOverallSummary(allShiftsData);
        const employeeSummaries = calculateEmployeeRoleSummariesDaily(allShiftsData);

        // Return the processed data including role configs
        return NextResponse.json({ 
            summary, 
            employeeSummaries,
            roleConfigs 
        });

    } catch (error) {
        console.error("Error generating report:", error);
        return NextResponse.json({ message: 'Error generating report data' }, { status: 500 });
    }
} 