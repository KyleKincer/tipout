// Type definitions
type Employee = {
  id: string;
  name: string;
};

type RoleConfig = {
  id: string;
  tipoutType: string;
  percentageRate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  paysTipout?: boolean;      // Whether this role pays tipout of this type
  receivesTipout?: boolean;  // Whether this role receives tipout of this type
  distributionGroup?: string; // For pooling tipouts (e.g., 'bartenders', 'hosts')
};

type Shift = {
  id: string;
  employee?: Employee;
  role?: {
    id?: string;
    name: string;
    basePayRate: number;
    configs: RoleConfig[];
  };
  date: string;
  hours: number;
  cashTips: number;
  creditTips: number;
  liquorSales: number;
};

import { isWithinInterval, parseISO, isBefore, isEqual } from 'date-fns';

// Helper function to find the active configuration for a specific type and date
const findActiveConfig = (shift: Shift, tipoutType: string): RoleConfig | null => {
  if (!shift.role?.configs) return null;
  
  const shiftDate = parseISO(shift.date); // Parse the shift date string once
  
  const activeConfig = shift.role.configs.find(config => {
    if (config.tipoutType !== tipoutType) return false;
    
    const effectiveFrom = parseISO(config.effectiveFrom);
    // Check if shift date is on or after effectiveFrom
    const isAfterOrOnFrom = isEqual(shiftDate, effectiveFrom) || isBefore(effectiveFrom, shiftDate);
    if (!isAfterOrOnFrom) return false;
    
    // Check effectiveTo
    if (config.effectiveTo) {
      const effectiveTo = parseISO(config.effectiveTo);
      // Check if shift date is on or before effectiveTo
      const isOnOrBeforeTo = isEqual(shiftDate, effectiveTo) || isBefore(shiftDate, effectiveTo);
      return isOnOrBeforeTo;
    } else {
      // If effectiveTo is null, it's active indefinitely from effectiveFrom
      return true;
    }
  });
  
  return activeConfig || null;
};

/**
 * Calculate tipouts for a shift based on ACTIVE role configurations for the shift's date
 * 
 * @param shift The shift to calculate tipouts for
 * @param hasHost Whether hosts worked that day (affects host tipouts)
 * @param hasSA Whether SAs worked that day (affects SA tipouts)
 * @param hasBar Whether bartenders worked that day (affects bar tipouts)
 * @returns Object containing calculated tipout amounts
 */
export const calculateTipouts = (shift: Shift, hasHost: boolean, hasSA: boolean, hasBar: boolean = false): { barTipout: number, hostTipout: number, saTipout: number } => {
  if (!shift.role?.configs) return { barTipout: 0, hostTipout: 0, saTipout: 0 };

  console.log('calculateTipouts input:', { 
    shiftId: shift.id,
    role: shift.role.name,
    configs: shift.role.configs.length,
    hasHost, 
    hasSA,
    hasBar
  });

  const totalTips = Number(shift.cashTips) + Number(shift.creditTips);
  let barTipout = 0;
  let hostTipout = 0;
  let saTipout = 0;

  // Find ACTIVE config for each tipout type
  const activeBarConfig = findActiveConfig(shift, 'bar');
  const activeHostConfig = findActiveConfig(shift, 'host');
  const activeSaConfig = findActiveConfig(shift, 'sa');

  // Calculate Bar Tipout
  if (hasBar && activeBarConfig && activeBarConfig.paysTipout !== false) {
    barTipout = Number(shift.liquorSales) * (activeBarConfig.percentageRate / 100);
    console.log(`Calculated bar tipout: ${barTipout} using rate ${activeBarConfig.percentageRate}%`);
  }

  // Calculate Host Tipout
  if (hasHost && activeHostConfig && activeHostConfig.paysTipout !== false) {
    hostTipout = totalTips * (activeHostConfig.percentageRate / 100);
    console.log(`Calculated host tipout: ${hostTipout} using rate ${activeHostConfig.percentageRate}%`);
  }

  // Calculate SA Tipout
  if (hasSA && activeSaConfig && activeSaConfig.paysTipout !== false) {
    saTipout = totalTips * (activeSaConfig.percentageRate / 100);
    console.log(`Calculated SA tipout: ${saTipout} using rate ${activeSaConfig.percentageRate}%`);
  }

  const result = { barTipout, hostTipout, saTipout };
  console.log('Final tipout calculation:', result);
  return result;
};

/**
 * Helper function to check if a role receives a specific tipout type based on ACTIVE config
 */
export const roleReceivesTipoutType = (shift: Shift, tipoutType: string): boolean => {
  const activeConfig = findActiveConfig(shift, tipoutType);
  return !!activeConfig && !!activeConfig.receivesTipout;
};

/**
 * Helper function to check if a role pays a specific tipout type based on ACTIVE config
 */
export const rolePaysTipoutType = (shift: Shift, tipoutType: string): boolean => {
  const activeConfig = findActiveConfig(shift, tipoutType);
  // Default paysTipout to true if undefined or null, explicitly check for false
  return !!activeConfig && activeConfig.paysTipout !== false;
};

/**
 * Helper function to get a role's distribution group for a tipout type based on ACTIVE config
 */
export const getRoleDistributionGroup = (shift: Shift, tipoutType: string): string | null => {
  const activeConfig = findActiveConfig(shift, tipoutType);
  if (activeConfig && activeConfig.receivesTipout && activeConfig.distributionGroup) {
    return activeConfig.distributionGroup;
  }
  return null;
}; 