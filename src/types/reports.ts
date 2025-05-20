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
  distributionGroup?: string; // For pooling tipouts RECEIVED FROM others (e.g., 'bartenders', 'hosts')
  tipPoolGroup?: string;     // For pooling tips COLLECTED BY this role WITH others (e.g. "server_pool", "bartender_pool")
  basePayRate?: number; // Optional because it might not be on all configs initially, though migration sets it.
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
    // basePayRate: number; // Removed from here
    configs: RoleConfig[];
  };
  hours: number;
  cashTips: number;
  creditTips: number;
  liquorSales: number;
  configs?: RoleConfig[]; // Add optional configs property
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
  totalGrossCreditTips: number; // Gross credit tips before pooling
  /**
   * Net amount for this employee/role: Positive=Received, Negative=Paid.
   * For pooled roles, this is now (received from pool - paid to pool), so can be negative or positive.
   */
  totalBarTipout: number;
  totalHostTipout: number;  // Net amount for this employee/role: +received / -paid
  totalSaTipout: number;    // Net amount for this employee/role: +received / -paid
  cashTipsPerHour: number;
  creditTipsPerHour: number; // Based on totalPayrollTips / totalHours
  totalTipsPerHour: number;  // Based on (totalCashTips + totalPayrollTips) / totalHours
  basePayRate: number;
  totalPayrollTips: number;  // Represents the value used for payroll (CreditTips + Net Tipouts)
  totalLiquorSales: number;
  payrollTotal: number;      // Calculated total payroll amount (Base Pay + Payroll Tips)
  tipPoolGroup?: string | null; // Name of the tip pool group, if any
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