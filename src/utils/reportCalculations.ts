import { calculateTipouts, roleReceivesTipoutType, rolePaysTipoutType, getRoleDistributionGroup } from './tipoutCalculations';
import {
  Shift,
  ReportSummary,
  EmployeeRoleSummary,
} from '@/types/reports';

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
  const summaries = new Map<string, EmployeeRoleSummary>();

  // Get unique dates from the shifts to process
  const uniqueDates = Array.from(new Set(shiftsToProcess.map(shift => shift.date.slice(0, 10))));

  // Iterate through each day to calculate pools and distribute tips daily
  uniqueDates.forEach(date => {
    const dailyShifts = shiftsToProcess.filter(shift => shift.date.slice(0, 10) === date);
    if (dailyShifts.length === 0) return; // Skip if no shifts on this date

    // 1. Determine daily role presence
    let dailyHasHost = false;
    let dailyHasSA = false;
    let dailyHasBar = false;
    dailyShifts.forEach(shift => {
      if (roleReceivesTipoutType(shift, 'host')) dailyHasHost = true;
      if (roleReceivesTipoutType(shift, 'sa')) dailyHasSA = true;
      if (roleReceivesTipoutType(shift, 'bar')) dailyHasBar = true;
    });

    // 2. Calculate total daily tipout pools (paid INTO pools)
    let dailyBarTipoutPool = 0;
    let dailyHostTipoutPool = 0;
    let dailySATipoutPool = 0;

    dailyShifts.forEach(shift => {
      const { barTipout, hostTipout, saTipout } = calculateTipouts(shift, dailyHasHost, dailyHasSA, dailyHasBar);
      if (rolePaysTipoutType(shift, 'bar')) dailyBarTipoutPool += barTipout;
      if (rolePaysTipoutType(shift, 'host')) dailyHostTipoutPool += hostTipout;
      if (rolePaysTipoutType(shift, 'sa')) dailySATipoutPool += saTipout;
    });

    // 3. Calculate daily hours for roles within distribution groups
    const dailyDistributionGroupHours = new Map<string, number>();
    dailyShifts.forEach(shift => {
      shift.role?.configs.forEach(config => {
        if (config.receivesTipout && config.distributionGroup) {
          const currentHours = dailyDistributionGroupHours.get(config.distributionGroup) || 0;
          dailyDistributionGroupHours.set(config.distributionGroup, currentHours + Number(shift.hours));
        }
      });
    });

    // 4. Process each shift for the day: Accumulate stats, paid tipouts, and distribute received tipouts
    dailyShifts.forEach(shift => {
      if (!shift.employee || !shift.role) return; // Should not happen with valid data

      const key = `${shift.employee.id}-${shift.role.name}`;
      // Initialize or get existing summary for the employee/role combo
      const existing = summaries.get(key) || {
        employeeId: shift.employee.id,
        employeeName: shift.employee.name,
        roleName: shift.role.name,
        totalHours: 0,
        totalCashTips: 0,
        totalCreditTips: 0,
        totalBarTipout: 0,   // Net amount: +received / -paid
        totalHostTipout: 0,  // Net amount: +received / -paid
        totalSaTipout: 0,    // Net amount: +received / -paid
        cashTipsPerHour: 0,    // Will calculate at the end
        creditTipsPerHour: 0,   // Will calculate at the end
        totalTipsPerHour: 0,   // Will calculate at the end
        basePayRate: Number(shift.role.basePayRate), // Use shift's rate, assumes consistency
        totalPayrollTips: 0, // Will calculate at the end
        totalLiquorSales: 0,
        payrollTotal: 0,     // Will calculate at the end
      };

      // Accumulate basic stats from this shift
      existing.totalHours += Number(shift.hours);
      existing.totalCashTips += Number(shift.cashTips);
      existing.totalCreditTips += Number(shift.creditTips);
      existing.totalLiquorSales += Number(shift.liquorSales);
      existing.basePayRate = Number(shift.role.basePayRate); // Update base rate (usually consistent)

      // Calculate tipouts this specific shift pays out
      const { barTipout: paidBar, hostTipout: paidHost, saTipout: paidSA } = calculateTipouts(shift, dailyHasHost, dailyHasSA, dailyHasBar);

      // Accumulate PAID amounts as negative values to the net total
      if (rolePaysTipoutType(shift, 'bar')) existing.totalBarTipout -= paidBar;
      if (rolePaysTipoutType(shift, 'host')) existing.totalHostTipout -= paidHost;
      if (rolePaysTipoutType(shift, 'sa')) existing.totalSaTipout -= paidSA;

      // Distribute RECEIVED amounts from *daily* pools
      if (roleReceivesTipoutType(shift, 'bar')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'bar');
        const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
        if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailyBarTipoutPool > 0) {
          const share = Number(shift.hours) / groupTotalHours;
          existing.totalBarTipout += share * dailyBarTipoutPool;
        }
      }
      if (roleReceivesTipoutType(shift, 'host')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'host');
        const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
        if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailyHostTipoutPool > 0) {
          const share = Number(shift.hours) / groupTotalHours;
          existing.totalHostTipout += share * dailyHostTipoutPool;
        }
      }
      if (roleReceivesTipoutType(shift, 'sa')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'sa');
        const groupTotalHours = distributionGroup ? dailyDistributionGroupHours.get(distributionGroup) : 0;
        if (distributionGroup && groupTotalHours && groupTotalHours > 0 && dailySATipoutPool > 0) {
          const share = Number(shift.hours) / groupTotalHours;
          existing.totalSaTipout += share * dailySATipoutPool;
        }
      }

      // Update the summary map
      summaries.set(key, existing);
    });
  }); // End of daily loop

  // 5. Final calculations after processing all days and aggregating
  const finalSummaries = Array.from(summaries.values());
  finalSummaries.forEach(summary => {
    // Calculate totalPayrollTips (CreditTips collected + Net Received/Paid Tipouts)
    summary.totalPayrollTips = summary.totalCreditTips + summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout;

    // Calculate final per-hour rates based on aggregated totals
    summary.cashTipsPerHour = summary.totalHours > 0 ? summary.totalCashTips / summary.totalHours : 0;
    // Use totalPayrollTips for credit/hr as it reflects the distributed/net amount
    summary.creditTipsPerHour = summary.totalHours > 0 ? summary.totalPayrollTips / summary.totalHours : 0;
    // Total tips per hour is cash + payroll tips component
    summary.totalTipsPerHour = summary.totalHours > 0 ? (summary.totalCashTips + summary.totalPayrollTips) / summary.totalHours : 0;

    // Calculate final payroll total
    summary.payrollTotal = (summary.basePayRate * summary.totalHours) + summary.totalPayrollTips;
  });

  return finalSummaries;
}; 