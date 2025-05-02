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
  // Add net tipout amounts calculated daily
  netBarTipout: number;
  netHostTipout: number;
  netSaTipout: number;
  payrollTips: number; // Calculated based on pooled/adjusted tips + net tipouts
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
    const { barTipout, hostTipout, saTipout } = calculateTipouts(shift, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);

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

  // Bartender tipouts paid to Host/SA
  const bartenderHostSATipouts = barShifts.reduce((acc, shift) => {
      const date = shift.date.slice(0, 10);
      const dailyInfo = dailyRolePresence.get(date) ?? { hasHost: false, hasSA: false, hasBar: false };
      const { hostTipout, saTipout } = calculateTipouts(shift, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);
      return acc + hostTipout + saTipout;
    }, 0);

  // Server tipouts paid to Host/SA
  const serverHostSATipouts = serverShifts.reduce((sum, shift) => {
    const date = shift.date.slice(0, 10);
    const dailyInfo = dailyRolePresence.get(date) ?? { hasHost: false, hasSA: false, hasBar: false };
    const { hostTipout, saTipout } = calculateTipouts(shift, dailyInfo.hasHost, dailyInfo.hasSA, dailyInfo.hasBar);
    return sum + hostTipout + saTipout;
  }, 0);

  // Calculate Payroll Tips for average rate calculation
  const barPayrollTips = barCreditTips - bartenderHostSATipouts + summary.totalBarTipoutPaid; // CreditTips - PaidOut + ReceivedPool
  const serverPayrollTips = serverCreditTips - serverHostSATipouts; // CreditTips - PaidOut

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
        originalCashTips: s.cashTips,
        originalCreditTips: s.creditTips,
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
      const hostConfig = findActiveConfig(shift, 'host');
      if (hostConfig && hostConfig.receivesTipout !== false) dailyHasHost = true;
      
      const saConfig = findActiveConfig(shift, 'sa');
      if (saConfig && saConfig.receivesTipout !== false) dailyHasSA = true;
      
      const barConfig = findActiveConfig(shift, 'bar');
      if (barConfig && barConfig.receivesTipout !== false) dailyHasBar = true; 
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
      // Calculate total tipouts paid by this pool's shifts
      pool.shifts.forEach(shiftInPool => {
        const shiftWithOriginalTips = {
          ...shiftInPool,
          cashTips: shiftInPool.originalCashTips,
          creditTips: shiftInPool.originalCreditTips
        };
        const { barTipout, hostTipout, saTipout } = calculateTipouts(shiftWithOriginalTips, dailyHasHost, dailyHasSA, dailyHasBar);
        if (rolePaysTipoutType(shiftInPool, 'bar')) pool.totalPaidBarTipout += barTipout;
        if (rolePaysTipoutType(shiftInPool, 'host')) pool.totalPaidHostTipout += hostTipout;
        if (rolePaysTipoutType(shiftInPool, 'sa')) pool.totalPaidSaTipout += saTipout;
      });

      // Calculate NET pool tips (assuming tipouts paid from credit)
      // Adjust this logic if cash tips also contribute to tipouts
      const poolNetCashTips = pool.totalCashTips; 
      const poolNetCreditTips = pool.totalCreditTips - pool.totalPaidBarTipout - pool.totalPaidHostTipout - pool.totalPaidSaTipout;

      if (pool.totalHours > 0) {
        const netPoolCashRate = poolNetCashTips / pool.totalHours;
        const netPoolCreditRate = poolNetCreditTips / pool.totalHours;

        // Adjust each shift's tips to reflect their NET share of the pool
        pool.shifts.forEach(shift => {
          shift.cashTips = Number(shift.hours) * netPoolCashRate;
          shift.creditTips = Number(shift.hours) * netPoolCreditRate;
          console.log(`Shift ${shift.id} (${shift.role.name}) NET adjusted tips: Cash=$${shift.cashTips.toFixed(2)}, Credit=$${shift.creditTips.toFixed(2)} from NET pool rate`);
        });
      } else {
         pool.shifts.forEach(shift => {
            shift.cashTips = 0;
            shift.creditTips = 0;
         });
      }
    });
    // Shifts NOT in a pool retain their original cashTips/creditTips at this stage
    // They will have tipouts calculated individually later.

    // --- 2. Calculate total daily tipout pools (paid INTO distribution pools) ---
    // This is for roles RECEIVING tipouts (Host, SA, Bar). It needs the total contributions
    // from ALL shifts (pooled or not), calculated based on their ORIGINAL performance.
    let dailyBarTipoutPool = 0;
    let dailyHostTipoutPool = 0;
    let dailySATipoutPool = 0;

    dailyShifts.forEach(shift => {
      // Use original tips/sales for calculating contributions to distribution pools
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
      shift.role?.configs.forEach(config => {
        if (config.receivesTipout && config.distributionGroup) {
          const currentHours = dailyDistributionGroupHours.get(config.distributionGroup) || 0;
          dailyDistributionGroupHours.set(config.distributionGroup, currentHours + Number(shift.hours));
        }
      });
    });

    // --- 5. Process each shift for the day: Calculate net received tipouts and final payroll tips ---
    dailyShifts.forEach(shift => {
      if (!shift.employee || !shift.role) return;

      const isInPool = !!getShiftTipPoolGroup(shift);
      let netBarTipout = 0;
      let netHostTipout = 0;
      let netSaTipout = 0;
      let payrollTips = 0;

      if (isInPool) {
        // Pooled shifts already have NET tips assigned.
        // Their contribution to/from distribution pools was handled at the pool level.
        // Their net tipout for the summary is 0.
        // Their payroll tips are simply their net pooled credit tips.
        netBarTipout = 0;
        netHostTipout = 0;
        netSaTipout = 0;
        payrollTips = shift.creditTips; // Use the already adjusted net credit tips
      } else {
        // NON-POOLED shifts: Calculate tipouts paid and received individually.
        const shiftWithOriginalTips = {
            ...shift,
            cashTips: shift.originalCashTips,
            creditTips: shift.originalCreditTips
        };
        const { barTipout: paidBar, hostTipout: paidHost, saTipout: paidSA } = calculateTipouts(shiftWithOriginalTips, dailyHasHost, dailyHasSA, dailyHasBar);

        let receivedBar = 0;
        let receivedHost = 0;
        let receivedSA = 0;

        // Calculate received amounts from *daily* distribution pools
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

        // Calculate NET tipouts for this non-pooled shift
        netBarTipout = (roleReceivesTipoutType(shift, 'bar') ? receivedBar : 0) - (rolePaysTipoutType(shift, 'bar') ? paidBar : 0);
        netHostTipout = (roleReceivesTipoutType(shift, 'host') ? receivedHost : 0) - (rolePaysTipoutType(shift, 'host') ? paidHost : 0);
        netSaTipout = (roleReceivesTipoutType(shift, 'sa') ? receivedSA : 0) - (rolePaysTipoutType(shift, 'sa') ? paidSA : 0);

        // Payroll Tips = Original Credit Tips + Net Tipouts Received/Paid
        payrollTips = shift.originalCreditTips + netBarTipout + netHostTipout + netSaTipout;
        
        // IMPORTANT: Assign the original tips back for aggregation if not pooled, 
        // as the pooling step might have overwritten them earlier if logic was different.
        // If pooling logic correctly only adjusts pooled shifts, this might not be needed,
        // but better safe. We use original tips + net tipouts for non-pooled rates.
        shift.cashTips = shift.originalCashTips;
        shift.creditTips = shift.originalCreditTips; // Use original for display/aggregation base
      }

      // Store the processed shift data for final aggregation
      dailyProcessedShifts.push({
        ...shift, // Includes original or net pooled cash/credit tips
        originalCashTips: shift.originalCashTips,
        originalCreditTips: shift.originalCreditTips,
        netBarTipout, // For non-pooled shifts, this is their net; for pooled, it's 0
        netHostTipout,
        netSaTipout,
        payrollTips, // Contains the final payroll-relevant tip amount
      });
    });
  }); // --- End of daily loop ---

  // --- 6. Aggregate Processed Shifts into Final Summaries ---
  const summaries = new Map<string, EmployeeRoleSummary>();
  dailyProcessedShifts.forEach(procShift => {
      const key = `${procShift.employee.id}-${procShift.role.name}`;
      const isInPool = !!getShiftTipPoolGroup(procShift);
      const existing = summaries.get(key) || {
        employeeId: procShift.employee.id,
        employeeName: procShift.employee.name,
        roleName: procShift.role.name,
        totalHours: 0,
        totalCashTips: 0,       // Accumulate NET cash tips (pooled or original)
        totalCreditTips: 0,      // Accumulate NET credit tips (pooled or original)
        totalBarTipout: 0,       // Accumulate NET amounts (0 for pooled)
        totalHostTipout: 0,      // Accumulate NET amounts (0 for pooled)
        totalSaTipout: 0,        // Accumulate NET amounts (0 for pooled)
        cashTipsPerHour: 0,
        creditTipsPerHour: 0,
        totalTipsPerHour: 0,
        basePayRate: Number(procShift.role.basePayRate),
        totalPayrollTips: 0,     // Accumulate final payrollTips amount
        totalLiquorSales: 0,
        payrollTotal: 0,
      };

      // Accumulate totals from the processed shift
      existing.totalHours += Number(procShift.hours);
      existing.totalCashTips += procShift.cashTips; // Use net pooled or original cash
      existing.totalCreditTips += isInPool ? 0 : procShift.creditTips; // For display, maybe show original credit for non-pooled? Or just use payroll tips? Let's use PayrollTips for credit/hr and TotalTips/hr
      existing.totalLiquorSales += Number(procShift.liquorSales);
      existing.totalBarTipout += procShift.netBarTipout;   // Will be 0 for pooled shifts
      existing.totalHostTipout += procShift.netHostTipout; // Will be 0 for pooled shifts
      existing.totalSaTipout += procShift.netSaTipout;   // Will be 0 for pooled shifts
      existing.totalPayrollTips += procShift.payrollTips; // Use the calculated payrollTips
      existing.basePayRate = Number(procShift.role.basePayRate);

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
  });

  return finalSummaries;
}; 