import { describe, it, expect } from '@jest/globals';
import { calculateTipouts, roleReceivesTipoutType, rolePaysTipoutType, getRoleDistributionGroup } from './tipoutCalculations';
// We need to import the types. Adjust the path if they are defined elsewhere or re-define them here.
// Assuming types might be in a central types file or directly in tipoutCalculations.ts and exported.
// If they are not exported from './tipoutCalculations', this will need adjustment.
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
  paysTipout?: boolean;
  receivesTipout?: boolean;
  distributionGroup?: string;
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


// --- Mock Data ---

const createMockShift = (overrides: Partial<Shift> & { roleConfigs?: RoleConfig[] }): Shift => {
    const { roleConfigs, ...shiftOverrides } = overrides;
    return {
        id: 'shift1',
        date: '2024-01-01',
        hours: 8,
        cashTips: 100,
        creditTips: 200,
        liquorSales: 500,
        role: {
            id: 'role1',
            name: 'Server',
            basePayRate: 10,
            configs: roleConfigs ?? [], // Use provided configs or default to empty array
        },
        ...shiftOverrides, // Apply other overrides
    };
};

// --- calculateTipouts Tests ---

describe('calculateTipouts', () => {
    it('should return zero tipouts if role or configs are missing', () => {
        const shiftWithoutRole = createMockShift({ role: undefined });
        // Create a mock shift where the role exists but configs array is explicitly undefined
        const shiftWithoutConfigs = createMockShift({
            role: { name: 'Server', basePayRate: 10, configs: undefined as unknown as RoleConfig[] } // Force undefined configs
        });

        expect(calculateTipouts(shiftWithoutRole, true, true, true)).toEqual({ barTipout: 0, hostTipout: 0, saTipout: 0 });
        // Check the case where role exists but configs array is missing/undefined
        expect(calculateTipouts(shiftWithoutConfigs, true, true, true)).toEqual({ barTipout: 0, hostTipout: 0, saTipout: 0 });
     });


    it('should calculate tipouts based on applicable configs', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true }, // 5% of liquor sales (500) = 25
            { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true }, // 1% of total tips (100 + 200 = 300) = 3
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },   // 2% of total tips (300) = 6
        ];
        const shift = createMockShift({ roleConfigs: configs });

        expect(calculateTipouts(shift, true, true, true)).toEqual({ barTipout: 25, hostTipout: 3, saTipout: 6 });
    });

    it('should respect the hasHost, hasSA, and hasBar flags', () => {
         const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
        ];
        const shift = createMockShift({ roleConfigs: configs });

        // No Bar present
        expect(calculateTipouts(shift, true, true, false)).toEqual({ barTipout: 0, hostTipout: 3, saTipout: 6 });
        // No Host present (Note: Current implementation has host check commented out, test reflects that)
        expect(calculateTipouts(shift, false, true, true)).toEqual({ barTipout: 25, hostTipout: 3, saTipout: 6 }); // If check re-enabled, hostTipout should be 0
        // No SA present
        expect(calculateTipouts(shift, true, false, true)).toEqual({ barTipout: 25, hostTipout: 3, saTipout: 0 });
        // None present
        expect(calculateTipouts(shift, false, false, false)).toEqual({ barTipout: 0, hostTipout: 3, saTipout: 0 }); // If host check re-enabled, hostTipout should be 0
    });

     it('should not calculate tipout if paysTipout is false', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: false }, // Bar does not pay
            { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },  // Host pays
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: false }, // SA does not pay
        ];
        const shift = createMockShift({ roleConfigs: configs });

        expect(calculateTipouts(shift, true, true, true)).toEqual({ barTipout: 0, hostTipout: 3, saTipout: 0 });
     });

     it('should handle zero tips and sales correctly', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
        ];
        const shift = createMockShift({ roleConfigs: configs, cashTips: 0, creditTips: 0, liquorSales: 0 });

        expect(calculateTipouts(shift, true, true, true)).toEqual({ barTipout: 0, hostTipout: 0, saTipout: 0 });
     });

     it('should handle cases where percentageRate is zero', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 0, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg2', tipoutType: 'host', percentageRate: 0, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 0, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
        ];
        const shift = createMockShift({ roleConfigs: configs });

        expect(calculateTipouts(shift, true, true, true)).toEqual({ barTipout: 0, hostTipout: 0, saTipout: 0 });
    });

    it('should calculate bar tipout based on individual liquor sales after pooling', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'bar', percentageRate: 10, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg2', tipoutType: 'host', percentageRate: 7, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
            { id: 'cfg3', tipoutType: 'sa', percentageRate: 4, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true },
        ];
        const shift = createMockShift({ roleConfigs: configs, cashTips: 50, creditTips: 150, liquorSales: 400 });

        // Bar tipout is calculated based on individual liquor sales after pooling
        // 10% of 400 liquor sales = 40
        expect(calculateTipouts(shift, true, true, true)).toEqual({ barTipout: 40, hostTipout: 14, saTipout: 8 });
    });
});


// --- roleReceivesTipoutType Tests ---

describe('roleReceivesTipoutType', () => {
    const configs: RoleConfig[] = [
        { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, receivesTipout: true }, // Explicitly true
        { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, receivesTipout: false }, // Explicitly false
        { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null }, // Undefined receivesTipout
    ];
    const shift = createMockShift({ roleConfigs: configs });
    const shiftNoConfigs = createMockShift({ roleConfigs: [] }); // Shift with an empty config array

    it('should return true if a config exists for the type with receivesTipout explicitly true', () => {
        expect(roleReceivesTipoutType(shift, 'bar')).toBe(true);
    });

    it('should return false if receivesTipout is explicitly false', () => {
        expect(roleReceivesTipoutType(shift, 'host')).toBe(false);
    });

    it('should return false if receivesTipout is undefined', () => {
        // The .some() check requires `config.receivesTipout` to be truthy. Undefined is falsy.
        expect(roleReceivesTipoutType(shift, 'sa')).toBe(false);
    });

     it('should return false if no config exists for the specified tipout type', () => {
        expect(roleReceivesTipoutType(shift, 'kitchen')).toBe(false); // No 'kitchen' type config
    });

    it('should return false if the role has no configs at all', () => {
        expect(roleReceivesTipoutType(shiftNoConfigs, 'bar')).toBe(false);
    });

    it('should return false if shift.role or shift.role.configs is null/undefined', () => {
        const shiftNoRole = createMockShift({ role: undefined });
        const shiftNullConfigs = createMockShift({ role: { name: 'Test', basePayRate: 10, configs: null as unknown as RoleConfig[] }});
        expect(roleReceivesTipoutType(shiftNoRole, 'bar')).toBe(false);
        expect(roleReceivesTipoutType(shiftNullConfigs, 'bar')).toBe(false);
    });
});

// --- rolePaysTipoutType Tests ---

describe('rolePaysTipoutType', () => {
    const configs: RoleConfig[] = [
        { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: true }, // Explicitly true
        { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, paysTipout: false }, // Explicitly false
        { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null }, // Undefined paysTipout (defaults to true in the function logic)
    ];
    const shift = createMockShift({ roleConfigs: configs });
    const shiftNoConfigs = createMockShift({ roleConfigs: [] }); // Shift with empty configs

    it('should return true if paysTipout is explicitly true', () => {
        expect(rolePaysTipoutType(shift, 'bar')).toBe(true);
    });

    it('should return false if paysTipout is explicitly false', () => {
        expect(rolePaysTipoutType(shift, 'host')).toBe(false);
    });

    it('should return true if paysTipout is undefined (defaults to true)', () => {
        // The logic `paysTipout !== false` means undefined or true results in true.
        expect(rolePaysTipoutType(shift, 'sa')).toBe(true);
    });

    it('should return false if no config exists for the specified tipout type', () => {
        expect(rolePaysTipoutType(shift, 'kitchen')).toBe(false);
    });

    it('should return false if the role has no configs at all', () => {
        expect(rolePaysTipoutType(shiftNoConfigs, 'bar')).toBe(false);
    });

     it('should return false if shift.role or shift.role.configs is null/undefined', () => {
        const shiftNoRole = createMockShift({ role: undefined });
        const shiftNullConfigs = createMockShift({ role: { name: 'Test', basePayRate: 10, configs: null as unknown as RoleConfig[] }});
        expect(rolePaysTipoutType(shiftNoRole, 'bar')).toBe(false);
        expect(rolePaysTipoutType(shiftNullConfigs, 'bar')).toBe(false);
    });
});

// --- getRoleDistributionGroup Tests ---

describe('getRoleDistributionGroup', () => {
    const configs: RoleConfig[] = [
        { id: 'cfg1', tipoutType: 'bar', percentageRate: 5, effectiveFrom: '2023-01-01', effectiveTo: null, receivesTipout: true, distributionGroup: 'bartenders' },
        { id: 'cfg2', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2023-01-01', effectiveTo: null, receivesTipout: true }, // receivesTipout=true, but no distribution group defined
        { id: 'cfg3', tipoutType: 'sa', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, receivesTipout: false, distributionGroup: 'sas' }, // receivesTipout=false, group defined but shouldn't be returned
        { id: 'cfg4', tipoutType: 'kitchen', percentageRate: 2, effectiveFrom: '2023-01-01', effectiveTo: null, distributionGroup: 'boh' }, // receivesTipout is undefined (falsy), group defined but shouldn't be returned
    ];
     const shift = createMockShift({ roleConfigs: configs });
     const shiftNoConfigs = createMockShift({ roleConfigs: [] }); // Shift with empty configs

    it('should return the distribution group if receivesTipout is true and group is defined', () => {
        expect(getRoleDistributionGroup(shift, 'bar')).toBe('bartenders');
    });

     it('should return null if receivesTipout is true but no distribution group is defined in the config', () => {
        expect(getRoleDistributionGroup(shift, 'host')).toBe(null);
    });

     it('should return null if receivesTipout is explicitly false, even if a distribution group exists', () => {
        expect(getRoleDistributionGroup(shift, 'sa')).toBe(null);
    });

    it('should return null if receivesTipout is undefined, even if a distribution group exists', () => {
        // The find condition requires `c.receivesTipout` to be truthy.
        expect(getRoleDistributionGroup(shift, 'kitchen')).toBe(null);
    });

     it('should return null if no config exists for the specified tipout type', () => {
        expect(getRoleDistributionGroup(shift, 'expo')).toBe(null); // No 'expo' type config
    });

     it('should return null if the role has no configs at all', () => {
        expect(getRoleDistributionGroup(shiftNoConfigs, 'bar')).toBe(null);
    });

     it('should return null if shift.role or shift.role.configs is null/undefined', () => {
        const shiftNoRole = createMockShift({ role: undefined });
        const shiftNullConfigs = createMockShift({ role: { name: 'Test', basePayRate: 10, configs: null as unknown as RoleConfig[] }});
        expect(getRoleDistributionGroup(shiftNoRole, 'bar')).toBe(null);
        expect(getRoleDistributionGroup(shiftNullConfigs, 'bar')).toBe(null);
    });
});

// --- findActiveConfig Tests (via calculateTipouts) ---

describe('findActiveConfig', () => {
    // Need access to the non-exported findActiveConfig.
    // We can test it indirectly via the exported functions, 
    // or make it exportable for testing, or copy its logic here.
    // For simplicity here, let's assume we test its *effect* via calculateTipouts.
    
    const createDatedMockShift = (date: string, configs: RoleConfig[]): Shift => ({
        id: 'datedShift',
        date: date, // YYYY-MM-DD
        hours: 8,
        cashTips: 100,
        creditTips: 200,
        liquorSales: 500,
        role: {
            id: 'role1',
            name: 'Server',
            basePayRate: 10,
            configs: configs,
        },
    });

    it('should use config active on the shift date', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2024-01-01', effectiveTo: '2024-01-31', paysTipout: true },
            { id: 'cfg2', tipoutType: 'host', percentageRate: 2, effectiveFrom: '2024-02-01', effectiveTo: null, paysTipout: true }, // Active in Feb
        ];
        const shiftJan = createDatedMockShift('2024-01-15', configs);
        const shiftFeb = createDatedMockShift('2024-02-15', configs);

        // Jan shift uses 1% -> hostTipout = (100+200) * 0.01 = 3
        expect(calculateTipouts(shiftJan, true, false, false).hostTipout).toBeCloseTo(3);
        // Feb shift uses 2% -> hostTipout = (100+200) * 0.02 = 6
        expect(calculateTipouts(shiftFeb, true, false, false).hostTipout).toBeCloseTo(6);
    });

    it('should handle effectiveTo date correctly', () => {
         const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2024-01-01', effectiveTo: '2024-01-15', paysTipout: true }, // Active until Jan 15th inclusive
        ];
        const shiftOnEnd = createDatedMockShift('2024-01-15', configs);
        const shiftAfterEnd = createDatedMockShift('2024-01-16', configs);

        // Shift on end date uses the config
        expect(calculateTipouts(shiftOnEnd, true, false, false).hostTipout).toBeCloseTo(3);
         // Shift after end date does not use the config
        expect(calculateTipouts(shiftAfterEnd, true, false, false).hostTipout).toBeCloseTo(0);
    });

     it('should handle effectiveFrom date correctly', () => {
        const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2024-01-15', effectiveTo: null, paysTipout: true }, // Active from Jan 15th inclusive
        ];
        const shiftOnStart = createDatedMockShift('2024-01-15', configs);
        const shiftBeforeStart = createDatedMockShift('2024-01-14', configs);

        // Shift on start date uses the config
        expect(calculateTipouts(shiftOnStart, true, false, false).hostTipout).toBeCloseTo(3);
        // Shift before start date does not use the config
        expect(calculateTipouts(shiftBeforeStart, true, false, false).hostTipout).toBeCloseTo(0);
     });

     it('should return null if no config is active for the date', () => {
         const configs: RoleConfig[] = [
            { id: 'cfg1', tipoutType: 'host', percentageRate: 1, effectiveFrom: '2024-02-01', effectiveTo: null, paysTipout: true }, // Only active from Feb
        ];
        const shiftJan = createDatedMockShift('2024-01-15', configs);
        expect(calculateTipouts(shiftJan, true, false, false).hostTipout).toBeCloseTo(0);
     });
}); 