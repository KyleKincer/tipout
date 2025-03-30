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

/**
 * Calculate tipouts for a shift based on role configurations
 * 
 * @param shift The shift to calculate tipouts for
 * @param hasHost Whether hosts worked that day (affects host tipouts)
 * @param hasSA Whether SAs worked that day (affects SA tipouts)
 * @param hasBar Whether bartenders worked that day (affects bar tipouts)
 * @returns Object containing calculated tipout amounts
 */
export const calculateTipouts = (shift: Shift, hasHost: boolean, hasSA: boolean, hasBar: boolean = false) => {
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

  // Find the applicable configurations for this shift
  shift.role.configs.forEach(config => {
    // Only apply tipout if this role is configured to pay this type of tipout
    const paysTipout = config.paysTipout !== false; // default to true if not specified
    console.log('Config:', { 
      type: config.tipoutType, 
      rate: config.percentageRate, 
      paysTipout,
      totalTips,
      liquorSales: shift.liquorSales,
      would_apply_host: hasHost && config.tipoutType === 'host',
      would_apply_sa: hasSA && config.tipoutType === 'sa',
      would_apply_bar: hasBar && config.tipoutType === 'bar'
    });

    if (!paysTipout) return;

    switch (config.tipoutType) {
      case 'bar':
        // Bar tipout is calculated based on liquor sales
        // Only calculate if there are bartenders to receive the tipout
        if (hasBar) {
          barTipout = Number(shift.liquorSales) * (config.percentageRate / 100);
          console.log('Calculated bar tipout:', barTipout);
        }
        break;
      case 'host':
        // For debugging, temporarily ignore hasHost check
        // if (hasHost) {
          // Host tipout is calculated based on total tips
          hostTipout = totalTips * (config.percentageRate / 100);
          console.log('Calculated host tipout:', hostTipout);
        // }
        break;
      case 'sa':
        if (hasSA) {
          // SA tipout is calculated based on total tips
          saTipout = totalTips * (config.percentageRate / 100);
          console.log('Calculated SA tipout:', saTipout);
        }
        break;
    }
  });

  const result = { barTipout, hostTipout, saTipout };
  console.log('Final tipout calculation:', result);
  return result;
};

/**
 * Helper function to check if a role receives a specific tipout type
 */
export const roleReceivesTipoutType = (shift: Shift, tipoutType: string): boolean => {
  if (!shift.role?.configs) return false;
  
  return shift.role.configs.some(config => 
    config.tipoutType === tipoutType && config.receivesTipout
  );
};

/**
 * Helper function to check if a role pays a specific tipout type
 */
export const rolePaysTipoutType = (shift: Shift, tipoutType: string): boolean => {
  if (!shift.role?.configs) return false;
  
  return shift.role.configs.some(config => 
    config.tipoutType === tipoutType && config.paysTipout !== false
  );
};

/**
 * Helper function to get a role's distribution group for a tipout type
 */
export const getRoleDistributionGroup = (shift: Shift, tipoutType: string): string | null => {
  if (!shift.role?.configs) return null;
  
  const config = shift.role.configs.find(c => 
    c.tipoutType === tipoutType && c.receivesTipout && c.distributionGroup
  );
  return config?.distributionGroup || null;
}; 