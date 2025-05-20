import { calculateTipouts, roleReceivesTipoutType, rolePaysTipoutType, getRoleDistributionGroup } from './tipoutCalculations';
import {
  Shift,
  ReportSummary,
  EmployeeRoleSummary,
  RoleConfig,
} from '@/types/reports';

import { isWithinInterval, parseISO, isBefore, isEqual } from 'date-fns';

// Helper function to find the active configuration for a specific type and date
const findActiveConfig = (shift: Shift, tipoutType: string): RoleConfig | null => {
  if (!shift.role?.configs) return null;
  
  const shiftDate = parseISO(shift.date); // Parse the shift date string once
  
  const activeConfig = shift.role.configs.find(config => {
    if (config.tipoutType !== tipoutType) return false;
    
    const effectiveFrom = parseISO(config.effectiveFrom);
    const isAfterOrOnFrom = isEqual(shiftDate, effectiveFrom) || isBefore(effectiveFrom, shiftDate);
    if (!isAfterOrOnFrom) return false;
    
    if (config.effectiveTo) {
      const effectiveTo = parseISO(config.effectiveTo);
      const isOnOrBeforeTo = isEqual(shiftDate, effectiveTo) || isBefore(shiftDate, effectiveTo);
      return isOnOrBeforeTo;
    } else {
      return true;
    }
  });
  
  return activeConfig || null;
};

/**
 * Finds the tipPoolGroup for a given shift based on its active config.
 */
const getShiftTipPoolGroup = (shift: Shift): string | null => {
  // Find any active config first, then check its tipPoolGroup
  // This assumes a role belongs entirely to one pool based on any active config.
  // A more precise approach might find the active config for a specific *pooling type* if that were a concept.
  if (!shift.role?.configs) return null;
  const shiftDate = parseISO(shift.date);
  
  const relevantConfig = shift.role.configs.find(config => {
     // Check date effectivity first
     const effectiveFrom = parseISO(config.effectiveFrom);
     const isAfterOrOnFrom = isEqual(shiftDate, effectiveFrom) || isBefore(effectiveFrom, shiftDate);
     if (!isAfterOrOnFrom) return false;
     if (config.effectiveTo) {
       const effectiveTo = parseISO(config.effectiveTo);
       const isOnOrBeforeTo = isEqual(shiftDate, effectiveTo) || isBefore(shiftDate, effectiveTo);
       if (!isOnOrBeforeTo) return false;
     } 
     // If effective, check if it defines a tip pool group
     return config.tipPoolGroup; // Return true if tipPoolGroup is defined and truthy
  });

  return relevantConfig?.tipPoolGroup || null;
};

// Helper type for intermediate calculations
type ProcessedShift = Shift & {
  originalCashTips: number;
  originalCreditTips: number;
  tipPoolGroup: string | null;
  // Store calculated paid/received amounts for THIS shift
  paidBarTipout: number;
  paidHostTipout: number;
  paidSaTipout: number;
  receivedBarTipout: number;
  receivedHostTipout: number;
  receivedSaTipout: number;
  payrollTips: number; // Calculated based on pooled/adjusted tips + net tipouts/payments
};

/**
 * Calculates the overall summary report for a given set of shifts.
 * Note: Averages calculated here might be less meaningful if pooling is done daily.
 */
export const calculateOverallSummary = (shiftsToProcess: Shift[]): ReportSummary => {
  const summary: ReportSummary = {
    totalShifts: 0,
    totalHours: 0,
    totalCashTips: 0,
    totalCreditTips: 0,
    totalLiquorSales: 0,
    totalBarTipoutPaid: 0,
    totalHostTipoutPaid: 0,
    totalSaTipoutPaid: 0,
    barTipsPerHour: 0,
    serverTipsPerHour: 0,
    barCashTipsPerHour: 0,
    barCreditTipsPerHour: 0,
    serverCashTipsPerHour: 0,
    serverCreditTipsPerHour: 0,
  };

  if (shiftsToProcess.length === 0) {
    return summary; // Return empty summary if no shifts
  }

  // Determine role presence for each day within the processed shifts
  const dailyRolePresence = new Map<string, { hasHost: boolean; hasSA: boolean; hasBar: boolean }>();
  shiftsToProcess.forEach(shift => {
    const date = shift.date.slice(0, 10); // Use YYYY-MM-DD as key
    if (!dailyRolePresence.has(date)) {
      dailyRolePresence.set(date, { hasHost: false, hasSA: false, hasBar: false });
    }
    const dailyInfo = dailyRolePresence.get(date)!;
    // Check RECEIVING roles to determine presence for payout calculation
    if (roleReceivesTipoutType(shift, 'host')) dailyInfo.hasHost = true;
    if (roleReceivesTipoutType(shift, 'sa')) dailyInfo.hasSA = true;
    if (roleReceivesTipoutType(shift, 'bar')) dailyInfo.hasBar = true;
  });

  // Process all shifts for basic totals and calculate total tipouts paid into pools
  shiftsToProcess.forEach(shift => {
    summary.totalShifts += 1;
    summary.totalHours += Number(shift.hours);
    summary.totalCashTips += Number(shift.cashTips);
    summary.totalCreditTips += Number(shift.creditTips);
    summary.totalLiquorSales += Number(shift.liquorSales);

    // Determine if tipouts should be calculated based on daily presence
    const date = shift.date.slice(0, 10);
    const dailyInfo = dailyRolePresence.get(date) ?? { hasHost: false, hasSA: false, hasBar: false };
    // Use original tips/sales to calculate the *contribution* amount
    const shiftWithOriginalTips = {
        ...shift,
        cashTips: Number(shift.cashTips),
        creditTips: Number(shift.creditTips)
    };
    const { barTipout, hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);

    // Accumulate total tipouts paid *by* relevant roles
    if (rolePaysTipoutType(shift, 'bar')) {
        summary.totalBarTipoutPaid += barTipout;
    }
    if (rolePaysTipoutType(shift, 'host')) {
        summary.totalHostTipoutPaid += hostTipout;
    }
    if (rolePaysTipoutType(shift, 'sa')) {
        summary.totalSaTipoutPaid += saTipout;
    }
  });

  // --- Calculate Average Rates (Use with caution if using daily pooling) ---
  // These averages are calculated across the entire range.
  const barShifts = shiftsToProcess.filter(shift => roleReceivesTipoutType(shift, 'bar'));
  const serverShifts = shiftsToProcess.filter(shift => {
    // Simple definition: Pays bar tipout but doesn't receive bar/host/sa
    return rolePaysTipoutType(shift, 'bar') &&
           !roleReceivesTipoutType(shift, 'bar') &&
           !roleReceivesTipoutType(shift, 'host') &&
           !roleReceivesTipoutType(shift, 'sa');
  });

  const barHours = barShifts.reduce((acc, shift) => acc + Number(shift.hours), 0);
  const serverHours = serverShifts.reduce((acc, shift) => acc + Number(shift.hours), 0);

  const barCashTips = barShifts.reduce((acc, shift) => acc + Number(shift.cashTips), 0);
  const barCreditTips = barShifts.reduce((acc, shift) => acc + Number(shift.creditTips), 0);
  const serverCashTips = serverShifts.reduce((acc, shift) => acc + Number(shift.cashTips), 0);
  const serverCreditTips = serverShifts.reduce((acc, shift) => acc + Number(shift.creditTips), 0);

  // Bartender tipouts paid to Host/SA (based on original tips/sales)
  const bartenderHostSATipouts = barShifts.reduce((acc, shift) => {
      const date = shift.date.slice(0, 10);
      const dailyInfo = dailyRolePresence.get(date) ?? { hasHost: false, hasSA: false, hasBar: false };
      const shiftWithOriginalTips = { ...shift, cashTips: Number(shift.cashTips), creditTips: Number(shift.creditTips) };
      const { hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);
      let paid = 0;
      if (rolePaysTipoutType(shift, 'host')) paid += hostTipout;
      if (rolePaysTipoutType(shift, 'sa')) paid += saTipout;
      return acc + paid;
    }, 0);

  // Server tipouts paid to Host/SA (based on original tips/sales)
  const serverHostSATipouts = serverShifts.reduce((sum, shift) => {
    const date = shift.date.slice(0, 10);
    const dailyInfo = dailyRolePresence.get(date) ?? { hasHost: false, hasSA: false, hasBar: false };
    const shiftWithOriginalTips = { ...shift, cashTips: Number(shift.cashTips), creditTips: Number(shift.creditTips) };
    const { hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);
    let paid = 0;
    if (rolePaysTipoutType(shift, 'host')) paid += hostTipout;
    if (rolePaysTipoutType(shift, 'sa')) paid += saTipout;
    return sum + paid;
  }, 0);

  // Calculate Payroll Tips for average rate calculation
  const barPayrollTips = barCreditTips - bartenderHostSATipouts + summary.totalBarTipoutPaid; // CreditTips - PaidOut(Host/SA) + ReceivedPool(Bar)
  const serverPayrollTips = serverCreditTips - serverHostSATipouts - summary.totalBarTipoutPaid; // CreditTips - PaidOut(Host/SA) - PaidOut(Bar)

  // Calculate per-hour rates (Averages over the period)
  summary.barCashTipsPerHour = barHours > 0 ? barCashTips / barHours : 0;
  summary.barCreditTipsPerHour = barHours > 0 ? barPayrollTips / barHours : 0;
  summary.barTipsPerHour = barHours > 0 ? (barCashTips + barPayrollTips) / barHours : 0;

  summary.serverCashTipsPerHour = serverHours > 0 ? serverCashTips / serverHours : 0;
  summary.serverCreditTipsPerHour = serverHours > 0 ? serverPayrollTips / serverHours : 0;
  summary.serverTipsPerHour = serverHours > 0 ? (serverCashTips + serverPayrollTips) / serverHours : 0;

  return summary;
};

/**
 * Calculates employee/role summaries, performing tip pooling and distribution daily.
 */
export const calculateEmployeeRoleSummariesDaily = (shiftsToProcess: Shift[]): EmployeeRoleSummary[] => {
  const dailyProcessedShifts: ProcessedShift[] = [];

  // Get unique dates from the shifts to process
  const uniqueDates = Array.from(new Set(shiftsToProcess.map(shift => shift.date.slice(0, 10))));

  // --- Process Day by Day ---
  uniqueDates.forEach(date => {
    const originalDailyShifts = shiftsToProcess.filter(shift => shift.date.slice(0, 10) === date);
    if (originalDailyShifts.length === 0) return; // Skip if no shifts on this date

    // --- 0. PREPARE: Create copies with original tips preserved ---
    // We need original tips for calculating tipouts PAID, but will modify tips for pooling.
    const dailyShifts: (Shift & { originalCashTips: number, originalCreditTips: number })[] = originalDailyShifts.map(s => ({
        ...s,
        originalCashTips: Number(s.cashTips), // Ensure numbers
        originalCreditTips: Number(s.creditTips), // Ensure numbers
    }));

    // --- 1. TIP POOLING (Based on tipPoolGroup) ---
    const tipPools = new Map<string, {
      totalCashTips: number;
      totalCreditTips: number;
      totalHours: number;
      shifts: (Shift & { originalCashTips: number, originalCreditTips: number })[];
      // Add fields to track pool's total tipout obligations
      totalPaidBarTipout: number;
      totalPaidHostTipout: number;
      totalPaidSaTipout: number;
    }>();

    // Determine daily role presence first (needed for pool tipout calculation)
    let dailyHasHost = false;
    let dailyHasSA = false;
    let dailyHasBar = false;
    dailyShifts.forEach(shift => {
      // Check if an active config exists for the type and receivesTipout is not explicitly false
      if (roleReceivesTipoutType(shift, 'host')) dailyHasHost = true;
      if (roleReceivesTipoutType(shift, 'sa')) dailyHasSA = true;
      if (roleReceivesTipoutType(shift, 'bar')) dailyHasBar = true;
    });

    // Group shifts into pools and calculate pool's gross tips/hours
    dailyShifts.forEach(shift => {
      const poolGroup = getShiftTipPoolGroup(shift);
      if (poolGroup) {
        if (!tipPools.has(poolGroup)) {
          tipPools.set(poolGroup, {
            totalCashTips: 0,
            totalCreditTips: 0,
            totalHours: 0,
            shifts: [],
            totalPaidBarTipout: 0,
            totalPaidHostTipout: 0,
            totalPaidSaTipout: 0
          });
        }
        const pool = tipPools.get(poolGroup)!;
        pool.totalCashTips += shift.originalCashTips; // Pool based on original collected tips
        pool.totalCreditTips += shift.originalCreditTips;
        pool.totalHours += Number(shift.hours);
        pool.shifts.push(shift);
      }
      // Shifts not in a pool are processed later individually
    });

    // Calculate total tipouts paid BY each pool and then the net rates
    tipPools.forEach((pool) => {
      // Calculate total tipouts paid by this pool's shifts using ORIGINAL tips
      pool.shifts.forEach(shiftInPool => {
        const shiftWithOriginalTips = {
          ...shiftInPool,
          cashTips: shiftInPool.originalCashTips,
          creditTips: shiftInPool.originalCreditTips
        };
        const { barTipout, hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyHasHost, dailyHasSA, dailyHasBar);
        // Accumulate tipouts the POOL is responsible for paying out
        if (rolePaysTipoutType(shiftInPool, 'bar')) pool.totalPaidBarTipout += barTipout;
        if (rolePaysTipoutType(shiftInPool, 'host')) pool.totalPaidHostTipout += hostTipout;
        if (rolePaysTipoutType(shiftInPool, 'sa')) pool.totalPaidSaTipout += saTipout;
      });

      // Calculate NET pool tips (assuming tipouts paid from credit)
      // Pool pays Host and SA tipouts. Bar tipout is paid individually.
      const poolNetCashTips = pool.totalCashTips;
      const poolNetCreditTips = pool.totalCreditTips - pool.totalPaidHostTipout - pool.totalPaidSaTipout;

      if (pool.totalHours > 0) {
        const netPoolCashRate = poolNetCashTips / pool.totalHours;
        const netPoolCreditRate = poolNetCreditTips / pool.totalHours;

        // Adjust each shift's tips to reflect their NET share of the pool
        pool.shifts.forEach(shift => {
          shift.cashTips = Number(shift.hours) * netPoolCashRate; // NET cash share
          shift.creditTips = Number(shift.hours) * netPoolCreditRate; // NET credit share (after pool deductions)
          console.log(`Shift ${shift.id} (${shift.role?.name}) NET adjusted tips: Cash=$${shift.cashTips.toFixed(2)}, Credit=$${shift.creditTips.toFixed(2)} from NET pool rate`);
        });
      } else {
         pool.shifts.forEach(shift => {
            shift.cashTips = 0;
            shift.creditTips = 0;
         });
      }
    });
    // Shifts NOT in a pool retain their original cashTips/creditTips at this stage.

    // --- 2. Calculate total daily tipout pools (paid INTO distribution pools) ---
    // Calculated based on ORIGINAL performance of ALL shifts.
    let dailyBarTipoutPool = 0;
    let dailyHostTipoutPool = 0;
    let dailySATipoutPool = 0;

    dailyShifts.forEach(shift => {
      const shiftWithOriginalTips = {
          ...shift,
          cashTips: shift.originalCashTips,
          creditTips: shift.originalCreditTips
      };
      const { barTipout, hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyHasHost, dailyHasSA, dailyHasBar);
      if (rolePaysTipoutType(shift, 'bar')) dailyBarTipoutPool += barTipout;
      if (rolePaysTipoutType(shift, 'host')) dailyHostTipoutPool += hostTipout;
      if (rolePaysTipoutType(shift, 'sa')) dailySATipoutPool += saTipout;
    });

    // --- 4. Calculate daily hours for roles within DISTRIBUTION groups (for receiving tipouts) ---
    const dailyDistributionGroupHours = new Map<string, number>();
    dailyShifts.forEach(shift => {
      const barGroup = getRoleDistributionGroup(shift, 'bar');
      if (barGroup) dailyDistributionGroupHours.set(barGroup, (dailyDistributionGroupHours.get(barGroup) || 0) + Number(shift.hours));

      const hostGroup = getRoleDistributionGroup(shift, 'host');
      if (hostGroup) dailyDistributionGroupHours.set(hostGroup, (dailyDistributionGroupHours.get(hostGroup) || 0) + Number(shift.hours));

      const saGroup = getRoleDistributionGroup(shift, 'sa');
      if (saGroup) dailyDistributionGroupHours.set(saGroup, (dailyDistributionGroupHours.get(saGroup) || 0) + Number(shift.hours));
    });


    // --- 5. Process each shift for the day: Calculate paid/received tipouts and final payroll tips ---
    dailyShifts.forEach(shift => {
      if (!shift.employee || !shift.role) return;

      let payrollTips = 0;

      // --- Calculate Received Tipouts (Based on daily pools and shift hours) ---
      let receivedBar = 0;
      let receivedHost = 0;
      let receivedSA = 0;

      if (roleReceivesTipoutType(shift, 'bar')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'bar');
        const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
        if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailyBarTipoutPool > 0) {
          receivedBar = (Number(shift.hours) / groupTotalHours) * dailyBarTipoutPool;
        }
      }
      if (roleReceivesTipoutType(shift, 'host')) {
          const distributionGroup = getRoleDistributionGroup(shift, 'host');
          const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
          if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailyHostTipoutPool > 0) {
            receivedHost = (Number(shift.hours) / groupTotalHours) * dailyHostTipoutPool;
          }
      }
      if (roleReceivesTipoutType(shift, 'sa')) {
          const distributionGroup = getRoleDistributionGroup(shift, 'sa');
          const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
          if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailySATipoutPool > 0) {
            receivedSA = (Number(shift.hours) / groupTotalHours) * dailySATipoutPool;
          }
      }

      // --- Calculate Paid Tipouts (Based on THIS shift's ORIGINAL tips/sales) ---
      const shiftWithOriginalTips = {
        ...shift,
        cashTips: shift.originalCashTips,
        creditTips: shift.originalCreditTips
      };
      const { barTipout, hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyHasHost, dailyHasSA, dailyHasBar);

      const paidBar = rolePaysTipoutType(shift, 'bar') ? barTipout : 0;
      const paidHost = rolePaysTipoutType(shift, 'host') ? hostTipout : 0;
      const paidSA = rolePaysTipoutType(shift, 'sa') ? saTipout : 0;


      // --- Calculate Payroll Tips ---
      const isInPool = !!getShiftTipPoolGroup(shift);

      if (isInPool) {
        // Payroll Tips for pooled = Net Pooled Credit Share + Received Tipouts - Paid Bar Tipout (Host/SA handled by pool)
        payrollTips = shift.creditTips + receivedBar + receivedHost + receivedSA - paidBar; // Use adjusted shift.creditTips
         console.log(`Pooled Shift ${shift.id} Payroll: ${shift.creditTips.toFixed(2)} (Net Pool) + ${receivedBar.toFixed(2)} (Rec Bar) + ${receivedHost.toFixed(2)} (Rec Host) + ${receivedSA.toFixed(2)} (Rec SA) - ${paidBar.toFixed(2)} (Paid Bar) = ${payrollTips.toFixed(2)}`);
      } else {
        // Payroll Tips for non-pooled = Original Credit Tips + Received Tipouts - Paid Tipouts
        payrollTips = shift.originalCreditTips + receivedBar + receivedHost + receivedSA - paidBar - paidHost - paidSA;
        console.log(`Non-Pooled Shift ${shift.id} Payroll: ${shift.originalCreditTips.toFixed(2)} (Orig) + ${receivedBar.toFixed(2)} (Rec Bar) + ${receivedHost.toFixed(2)} (Rec Host) + ${receivedSA.toFixed(2)} (Rec SA) - ${paidBar.toFixed(2)} (Paid Bar) - ${paidHost.toFixed(2)} (Paid Host) - ${paidSA.toFixed(2)} (Paid SA) = ${payrollTips.toFixed(2)}`);

        // Use original tips for the base cash/credit display if not pooled
        shift.cashTips = shift.originalCashTips;
        shift.creditTips = shift.originalCreditTips;
      }

      // Store the processed shift data for final aggregation
      dailyProcessedShifts.push({
        ...shift, // Includes original or net pooled cash/credit tips
        originalCashTips: shift.originalCashTips,
        originalCreditTips: shift.originalCreditTips,
        // Store the specific paid/received amounts for this shift for summary display
        paidBarTipout: paidBar,
        paidHostTipout: paidHost,
        paidSaTipout: paidSA,
        receivedBarTipout: receivedBar,
        receivedHostTipout: receivedHost,
        receivedSaTipout: receivedSA,
        payrollTips, // Contains the final payroll-relevant tip amount
        tipPoolGroup: getShiftTipPoolGroup(shift),
      });
    });
  }); // --- End of daily loop ---

  // --- 6. Aggregate Processed Shifts into Final Summaries ---
  const summaries = new Map<string, EmployeeRoleSummary>();
  dailyProcessedShifts.forEach(procShift => {
      const key = `${procShift.employee.id}-${procShift.role.name}`;
      let existing = summaries.get(key);

      // --- Find active basePayRate from RoleConfig ---
      const shiftDate = parseISO(procShift.date);
      let activePayRateConfig: RoleConfig | null = null;
      if (procShift.role && procShift.role.configs) {
          const sortedConfigs = [...procShift.role.configs].sort((a, b) => 
              parseISO(b.effectiveFrom).getTime() - parseISO(a.effectiveFrom).getTime()
          );

          activePayRateConfig = sortedConfigs.find(config => {
              const effectiveFrom = parseISO(config.effectiveFrom);
              // Check if shiftDate is on or after effectiveFrom
              const isAfterOrOnFrom = isEqual(shiftDate, effectiveFrom) || isBefore(effectiveFrom, shiftDate);
              if (!isAfterOrOnFrom) return false;

              if (config.effectiveTo) {
                  const effectiveTo = parseISO(config.effectiveTo);
                  // Check if shiftDate is on or before effectiveTo
                  const isOnOrBeforeTo = isEqual(shiftDate, effectiveTo) || isBefore(shiftDate, effectiveTo);
                  return isOnOrBeforeTo;
              }
              return true; // No effectiveTo means it's active indefinitely from effectiveFrom
          });
      }
      const currentBasePayRate = activePayRateConfig && typeof activePayRateConfig.basePayRate === 'number' 
                                 ? activePayRateConfig.basePayRate 
                                 : 0;
      // --- End find active basePayRate ---

       if (!existing) {
            existing = {
                employeeId: procShift.employee.id,
                employeeName: procShift.employee.name,
                roleName: procShift.role.name,
                totalHours: 0,
                totalCashTips: 0,        // Accumulate NET cash tips (pooled or original)
                totalCreditTips: 0,      // Accumulate NET credit tips (pooled or original) - Base for display
                totalGrossCreditTips: 0, // Accumulate original gross credit tips
                // These now represent Received - Paid for this employee/role combo
                totalBarTipout: 0,
                totalHostTipout: 0,
                totalSaTipout: 0,
                cashTipsPerHour: 0,
                creditTipsPerHour: 0,
                totalTipsPerHour: 0,
                basePayRate: currentBasePayRate, // Use new logic
                totalPayrollTips: 0,     // Accumulate final payrollTips amount
                totalLiquorSales: 0,
                payrollTotal: 0,
                tipPoolGroup: procShift.tipPoolGroup, // Assign first time, assume constant
            };
        }


      // Accumulate totals from the processed shift
      existing.totalHours += Number(procShift.hours);
      existing.totalCashTips += procShift.cashTips; // Use net pooled or original cash
      existing.totalCreditTips += procShift.creditTips; // Use net pooled or original credit (base for display)
      existing.totalGrossCreditTips += procShift.originalCreditTips; // Accumulate original gross credit
      existing.totalLiquorSales += Number(procShift.liquorSales);
      // Accumulate Net Tipouts (Received - Paid for this summary group)
      existing.totalBarTipout += procShift.receivedBarTipout - procShift.paidBarTipout;
      existing.totalHostTipout += procShift.receivedHostTipout - procShift.paidHostTipout;
      existing.totalSaTipout += procShift.receivedSaTipout - procShift.paidSaTipout;
      existing.totalPayrollTips += procShift.payrollTips; // Use the calculated payrollTips
      // Update base pay rate - might need logic if it can change mid-period for same emp/role
      existing.basePayRate = currentBasePayRate; // Use new logic

      summaries.set(key, existing);
  });

  // --- 7. Final calculations on aggregated summaries ---
  const finalSummaries = Array.from(summaries.values());
  finalSummaries.forEach(summary => {
    // Calculate final per-hour rates based on aggregated totals
    // Cash tips per hour uses the net/original cash amount.
    summary.cashTipsPerHour = summary.totalHours > 0 ? summary.totalCashTips / summary.totalHours : 0;
    // Credit tips per hour uses the final payrollTips amount.
    summary.creditTipsPerHour = summary.totalHours > 0 ? summary.totalPayrollTips / summary.totalHours : 0;
    // Total tips per hour is cash + payroll tips component.
    summary.totalTipsPerHour = summary.totalHours > 0 ? (summary.totalCashTips + summary.totalPayrollTips) / summary.totalHours : 0;

    // Calculate final payroll total
    summary.payrollTotal = (summary.basePayRate * summary.totalHours) + summary.totalPayrollTips;

    // Optional: Round final values for cleaner display
    summary.totalCashTips = parseFloat(summary.totalCashTips.toFixed(2));
    summary.totalCreditTips = parseFloat(summary.totalCreditTips.toFixed(2)); // This is the NET pool or original amount
    summary.totalGrossCreditTips = parseFloat(summary.totalGrossCreditTips.toFixed(2));
    summary.totalBarTipout = parseFloat(summary.totalBarTipout.toFixed(2));
    summary.totalHostTipout = parseFloat(summary.totalHostTipout.toFixed(2));
    summary.totalSaTipout = parseFloat(summary.totalSaTipout.toFixed(2));
    summary.totalPayrollTips = parseFloat(summary.totalPayrollTips.toFixed(2));
    summary.payrollTotal = parseFloat(summary.payrollTotal.toFixed(2));
    summary.cashTipsPerHour = parseFloat(summary.cashTipsPerHour.toFixed(2));
    summary.creditTipsPerHour = parseFloat(summary.creditTipsPerHour.toFixed(2));
    summary.totalTipsPerHour = parseFloat(summary.totalTipsPerHour.toFixed(2));


  });

  return finalSummaries;
}; 