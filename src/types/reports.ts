/**
 * Core entity types
 */
export type Employee = {
  id: string;
  name: string;
};

/**
 * Role configuration type for managing tipout rules and rates
 */
export type RoleConfig = {
  id: string;
  tipoutType: TipoutType;    // 'bar', 'host', 'sa', etc.
  percentageRate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  receivesTipout?: boolean;  // Whether this role receives tipout of this type
  paysTipout?: boolean;      // Whether this role pays tipout of this type
  distributionGroup?: string; // For pooling tipouts (e.g., 'bartenders', 'hosts')
};

/**
 * Represents a single work shift with associated employee, role, and financial data
 */
export type Shift = {
  id: string;
  date: string;
  employee: Employee;
  role: {
    name: string;
    basePayRate: number;
    configs: RoleConfig[];
  };
  hours: number;
  cashTips: number;
  creditTips: number;
  liquorSales: number;
};

/**
 * Overall summary of financial metrics across multiple shifts
 */
export type ReportSummary = {
  totalShifts: number;
  totalHours: number;
  totalCashTips: number;
  totalCreditTips: number;
  totalLiquorSales: number;
  totalBarTipoutPaid: number; // Total paid *into* bar pool
  totalHostTipoutPaid: number;// Total paid *into* host pool
  totalSaTipoutPaid: number;  // Total paid *into* sa pool
  // Averages - Note: These might be less meaningful when calculated over a range if pooling is daily
  barTipsPerHour: number;
  serverTipsPerHour: number;
  barCashTipsPerHour: number;
  barCreditTipsPerHour: number;
  serverCashTipsPerHour: number;
  serverCreditTipsPerHour: number;
};

/**
 * Summary of financial metrics for a specific employee in a specific role
 */
export type EmployeeRoleSummary = {
  employeeId: string;
  employeeName: string;
  roleName: string;
  totalHours: number;
  totalCashTips: number;
  totalCreditTips: number;
  totalBarTipout: number;   // Net amount for this employee/role: +received / -paid
  totalHostTipout: number;  // Net amount for this employee/role: +received / -paid
  totalSaTipout: number;    // Net amount for this employee/role: +received / -paid
  cashTipsPerHour: number;
  creditTipsPerHour: number; // Based on totalPayrollTips / totalHours
  totalTipsPerHour: number;  // Based on (totalCashTips + totalPayrollTips) / totalHours
  basePayRate: number;
  totalPayrollTips: number;  // Represents the value used for payroll (CreditTips + Net Tipouts)
  totalLiquorSales: number;
  payrollTotal: number;      // Calculated total payroll amount (Base Pay + Payroll Tips)
};

/**
 * Valid tipout types in the system
 */
export type TipoutType = 'bar' | 'host' | 'sa';

/**
 * Daily role presence tracking
 */
export type DailyRolePresence = {
  hasHost: boolean;
  hasSA: boolean;
  hasBar: boolean;
}; 