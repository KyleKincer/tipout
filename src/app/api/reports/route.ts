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
                include: { 
                    configs: true // This includes all fields from RoleConfig, including tipPoolGroup
                }, 
            },
        },
        orderBy: {
            date: 'asc',
        },
    });

    // Map Prisma result to the ReportShift type, including tipPoolGroup
    const reportShifts: ReportShift[] = shifts.filter(
        // Ensure employee and role are non-null
        (shift): shift is ShiftWithIncludes & { employee: NonNullable<ShiftWithIncludes['employee']>, role: NonNullable<ShiftWithIncludes['role']> } =>
            !!shift.employee && !!shift.role
    ).map((shift) => {
        const shiftDate = new Date(shift.date); // shift.date is already a Date object from Prisma
        let currentActiveBasePayRate = 0;
        if (shift.role && shift.role.configs && shift.role.configs.length > 0) {
            // Sort by effectiveFrom descending to easily find the latest active
            const sortedConfigs = [...shift.role.configs].sort((a, b) => 
                new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
            );
            const activeConfig = sortedConfigs.find(config => {
                const effectiveFrom = new Date(config.effectiveFrom);
                const isAfterOrOnFrom = shiftDate >= effectiveFrom;
                if (!isAfterOrOnFrom) return false;
                if (config.effectiveTo) {
                    const effectiveTo = new Date(config.effectiveTo);
                    return shiftDate <= effectiveTo;
                }
                return true; // No effectiveTo means active indefinitely
            });

            // activeConfig.basePayRate is Decimal from Prisma, needs conversion
            if (activeConfig && activeConfig.basePayRate !== null && activeConfig.basePayRate !== undefined) {
                 currentActiveBasePayRate = Number(activeConfig.basePayRate);
            }
        }

        return {
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
                id: shift.role.id,
                name: shift.role.name,
                basePayRate: currentActiveBasePayRate, // Populate with the determined active base pay rate
                configs: (shift.role.configs || []).map((config) => ({
                    id: config.id,
                    tipoutType: config.tipoutType,
                    percentageRate: Number(config.percentageRate),
                    effectiveFrom: config.effectiveFrom.toISOString(),
                    effectiveTo: config.effectiveTo ? config.effectiveTo.toISOString() : null,
                    receivesTipout: config.receivesTipout ?? false,
                    paysTipout: config.paysTipout ?? true,
                    distributionGroup: config.distributionGroup ?? undefined,
                    tipPoolGroup: config.tipPoolGroup ?? undefined,
                    basePayRate: config.basePayRate !== null && config.basePayRate !== undefined ? Number(config.basePayRate) : 0 // Also ensure this is mapped
                })),
            },
        };
    });

    console.log(`Fetched ${reportShifts.length} shifts.`);
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
            return NextResponse.json({ summary: null, employeeSummaries: [], roleConfigs: {} });
        }

        // Get unique roles and their current configs
        const roleConfigMap = new Map<string, Record<string, number>>();
        allShiftsData.forEach(shift => {
            if (!roleConfigMap.has(shift.role.name)) {
                // Storing percentage rates directly for frontend display
                const roleConfigRates = {
                    barTipout: shift.role.configs.find(c => c.tipoutType === 'bar')?.percentageRate || 0,
                    hostTipout: shift.role.configs.find(c => c.tipoutType === 'host')?.percentageRate || 0,
                    sa: shift.role.configs.find(c => c.tipoutType === 'sa')?.percentageRate || 0,
                    // We might want other config details here later if needed
                };
                roleConfigMap.set(shift.role.name, roleConfigRates);
            }
        });

        // Convert the map to an object for the response
        const roleConfigsForResponse = Object.fromEntries(roleConfigMap);

        // Calculate summaries using the utility function
        // Pass the fetched shifts directly
        const summary = calculateOverallSummary(allShiftsData);
        const employeeSummaries = calculateEmployeeRoleSummariesDaily(allShiftsData);

        // Return the processed data including role configs
        return NextResponse.json({ 
            summary, 
            employeeSummaries,
            roleConfigs: roleConfigsForResponse // Use the prepared object
        });

    } catch (error) {
        console.error("Error generating report:", error);
        // Consider logging the specific error or providing more context if safe
        const errorMessage = 'Error generating report data'; // Use const
        if (error instanceof Error) {
            // Avoid exposing sensitive details, but log them
            console.error("Detailed error:", error.message, error.stack);
            // Optionally, provide a generic error or a more specific one if applicable
            // errorMessage = `Failed to process report: ${error.message}`; // Use cautiously
        }
        return NextResponse.json({ message: errorMessage }, { status: 500 });
    }
} 