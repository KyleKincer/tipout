import { calculateEmployeeRoleSummariesDaily, calculateOverallSummary } from './reportCalculations';
import { Shift, EmployeeRoleSummary, RoleConfig, ReportSummary, TipoutType } from '@/types/reports'; // Assuming types are exported from here

// --- Mock Data Setup ---

const mockEmployee = (id: string, name: string): { id: string; name: string } => ({ id, name });

const mockRoleConfig = (
    id: string,
    tipoutType: string,
    percentageRate: number,
    { receivesTipout = false, paysTipout = true, distributionGroup = undefined, tipPoolGroup = undefined, effectiveFrom = '2024-01-01', effectiveTo = null }: Partial<RoleConfig> & { tipPoolGroup?: string | null } = {}
): RoleConfig => ({
    id,
    tipoutType: tipoutType as TipoutType,
    percentageRate,
    effectiveFrom,
    effectiveTo,
    receivesTipout,
    paysTipout,
    distributionGroup: distributionGroup ?? undefined, // Handle null vs undefined
    tipPoolGroup: tipPoolGroup ?? undefined,      // Handle null vs undefined
});

const mockRole = (
    id: string,
    name: string,
    basePayRate: number,
    configs: RoleConfig[],
): Shift['role'] => ({
    name,
    basePayRate,
    configs,
});

const mockShift = (
    id: string,
    employee: { id: string; name: string },
    role: Shift['role'],
    date: string, // YYYY-MM-DD
    hours: number,
    cashTips: number,
    creditTips: number,
    liquorSales: number,
    configs: RoleConfig[] = []
): Shift => ({
    id,
    employee,
    role,
    date,
    hours,
    cashTips,
    creditTips,
    liquorSales,
    configs,
});

// --- Common Roles ---
const serverConfigs = [
    mockRoleConfig('cfgSrvBar', 'bar', 25, { paysTipout: true, tipPoolGroup: 'server_pool' }),
    mockRoleConfig('cfgSrvHost', 'host', 7, { paysTipout: true, tipPoolGroup: 'server_pool' }),
    mockRoleConfig('cfgSrvSa', 'sa', 4, { paysTipout: true, tipPoolGroup: 'server_pool' }),
];
const roleServer = mockRole('roleSrv', 'Server', 3, serverConfigs);

const barConfigs = [
    mockRoleConfig('cfgBarBar', 'bar', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'bartenders', tipPoolGroup: 'bar_pool' }),
    mockRoleConfig('cfgBarHost', 'host', 7, { paysTipout: true, tipPoolGroup: 'bar_pool' }),
    mockRoleConfig('cfgBarSa', 'sa', 4, { paysTipout: true, tipPoolGroup: 'bar_pool' }),
];
const roleBar = mockRole('roleBar', 'Bar', 9, barConfigs);

const hostConfigs = [
     mockRoleConfig('cfgHostHost', 'host', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'hosts' }),
];
const roleHost = mockRole('roleHost', 'Host', 10, hostConfigs);

const saConfigs = [
     mockRoleConfig('cfgSaSa', 'sa', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'support' }),
];
const roleSA = mockRole('roleSA', 'SA', 8, saConfigs);


// --- Employees ---
const empDylan = mockEmployee('emp1', 'Dylan');
const empRegan = mockEmployee('emp2', 'Regan');
const empBrigid = mockEmployee('emp3', 'Brigid');
const empChristina = mockEmployee('emp4', 'Christina');
const empAlex = mockEmployee('emp5', 'Alex'); // SA


// --- Tests ---

describe('reportCalculations', () => {

    describe('calculateOverallSummary', () => {
        it('should calculate basic totals correctly', () => {
             const shifts: Shift[] = [
                mockShift('s1', empDylan, roleServer, '2024-03-15', 8, 50, 150, 400),
                mockShift('s2', empBrigid, roleBar, '2024-03-15', 7, 20, 80, 600),
            ];
            const summary = calculateOverallSummary(shifts);
            expect(summary.totalShifts).toBe(2);
            expect(summary.totalHours).toBeCloseTo(15);
            expect(summary.totalCashTips).toBeCloseTo(70);
            expect(summary.totalCreditTips).toBeCloseTo(230);
            expect(summary.totalLiquorSales).toBeCloseTo(1000);
        });

        it('should calculate total tipouts paid correctly (ignoring SA)', () => {
             // Server pays 25% Liq to Bar, 7% Tips to Host
             // Bar pays 7% Tips to Host
             const shifts: Shift[] = [
                mockShift('s1', empDylan, roleServer, '2024-03-15', 8, 50, 150, 400), // Tips=200, Liq=400 -> Pays Bar=100, Host=14
                mockShift('s2', empBrigid, roleBar, '2024-03-15', 7, 20, 80, 600),    // Tips=100, Liq=600 -> Pays Host=7
            ];
            const summary = calculateOverallSummary(shifts);
            // Total Paid *Into* Pools
            expect(summary.totalBarTipoutPaid).toBeCloseTo(100); // Only server pays bar
            expect(summary.totalHostTipoutPaid).toBeCloseTo(14 + 7); // Server + Bar pay host
            expect(summary.totalSaTipoutPaid).toBeCloseTo(0); // No SA shifts present
        });
        
        it('should calculate total tipouts paid correctly (with SA)', () => {
             // Server pays 25% Liq to Bar, 7% Tips to Host, 4% Tips to SA
             // Bar pays 7% Tips to Host, 4% Tips to SA
             const shifts: Shift[] = [
                mockShift('s1', empDylan, roleServer, '2024-03-15', 8, 50, 150, 400), // Tips=200, Liq=400 -> Pays Bar=100, Host=14, SA=8
                mockShift('s2', empBrigid, roleBar, '2024-03-15', 7, 20, 80, 600),    // Tips=100, Liq=600 -> Pays Host=7, SA=4
                mockShift('s3', empAlex, roleSA, '2024-03-15', 6, 0, 0, 0),        // SA present
            ];
            const summary = calculateOverallSummary(shifts);
            // Total Paid *Into* Pools
            expect(summary.totalBarTipoutPaid).toBeCloseTo(100); // Only server pays bar
            expect(summary.totalHostTipoutPaid).toBeCloseTo(14 + 7); // Server + Bar pay host
            expect(summary.totalSaTipoutPaid).toBeCloseTo(8 + 4); // Server + Bar pay SA
        });
        
        // Add more tests for average calculations if they become critical, 
        // but note they are less meaningful with daily pooling.
    });

    describe('calculateEmployeeRoleSummariesDaily', () => {
        
        it('Scenario: Simple Non-Pooled (Server pays, Host receives)', () => {
            const simpleServerConfig = [ mockRoleConfig('cfgSimpleBar', 'bar', 10, { paysTipout: true }) ]; // Pays 10% Liq to Bar
            const simpleHostConfig = [ mockRoleConfig('cfgSimpleHost', 'bar', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'hosts'}) ]; // Receives Bar Tipout
            const roleSimpleServer = mockRole('roleSimpleSrv', 'Server', 3, simpleServerConfig);
            const roleSimpleReceiver = mockRole('roleSimpleRec', 'Host', 10, simpleHostConfig);
            
            const shifts: Shift[] = [
                mockShift('s1', empDylan, roleSimpleServer, '2024-03-15', 8, 50, 150, 400), // Pays Bar = 40
                mockShift('s2', empChristina, roleSimpleReceiver, '2024-03-15', 8, 0, 0, 0), // Receives Bar = 40
            ];
            
            const summaries = calculateEmployeeRoleSummariesDaily(shifts);
            
            const dylanSummary = summaries.find(s => s.employeeName === 'Dylan');
            const christinaSummary = summaries.find(s => s.employeeName === 'Christina');

            expect(dylanSummary).toBeDefined();
            expect(christinaSummary).toBeDefined();

            // Dylan (Server) - Pays 40 Bar Tipout
            expect(dylanSummary!.totalGrossCreditTips).toBeCloseTo(150);
            expect(dylanSummary!.totalCreditTips).toBeCloseTo(150); // Original credit shown for non-pooled
            expect(dylanSummary!.totalBarTipout).toBeCloseTo(-40); // Net paid out
            expect(dylanSummary!.totalHostTipout).toBeCloseTo(0);
            expect(dylanSummary!.totalPayrollTips).toBeCloseTo(150 - 40); // 110
            expect(dylanSummary!.payrollTotal).toBeCloseTo((3 * 8) + 110); // 24 + 110 = 134

            // Christina (Host) - Receives 40 Bar Tipout
            expect(christinaSummary!.totalGrossCreditTips).toBeCloseTo(0);
            expect(christinaSummary!.totalCreditTips).toBeCloseTo(0); // Original credit shown
            expect(christinaSummary!.totalBarTipout).toBeCloseTo(40); // Net received
            expect(christinaSummary!.totalHostTipout).toBeCloseTo(0);
            expect(christinaSummary!.totalPayrollTips).toBeCloseTo(0 + 40); // 40
            expect(christinaSummary!.payrollTotal).toBeCloseTo((10 * 8) + 40); // 80 + 40 = 120
        });

        it('Scenario: Server Pool with Bar Tipout', () => {
            // Server Pool: Dylan (8h) + Regan (7h) = 15h total
            // Server Pool Tips: Cash=100, Credit=300
            // Server Pool Liq Sales: Dylan=400, Regan=300 = 700 total
            // Bar Tipout: 10% of Liq Sales (paid after pooling)
            // Host Tipout: 7% of Tips (paid before pooling)
            // SA Tipout: 4% of Tips (paid before pooling)
            const serverPoolConfig = [
                mockRoleConfig('cfgBar', 'bar', 10, { paysTipout: true }), // 10% of Liq to Bar
                mockRoleConfig('cfgHost', 'host', 7, { paysTipout: true }), // 7% of Tips to Host
                mockRoleConfig('cfgSA', 'sa', 4, { paysTipout: true }), // 4% of Tips to SA
            ];
            const shifts: Shift[] = [
                mockShift('s1', empDylan, roleServer, '2024-03-15', 8, 50, 150, 400, serverPoolConfig),
                mockShift('s2', empRegan, roleServer, '2024-03-15', 7, 50, 150, 300, serverPoolConfig),
                mockShift('s3', empBrigid, roleBar, '2024-03-15', 6, 0, 0, 0), // Bar present
                mockShift('s4', empChristina, roleHost, '2024-03-15', 5, 0, 0, 0), // Host present
                mockShift('s5', empAlex, roleSA, '2024-03-15', 4, 0, 0, 0), // SA present
            ];

            const summaries = calculateEmployeeRoleSummariesDaily(shifts);
            const dylanSummary = summaries.find(s => s.employeeId === empDylan.id);
            const reganSummary = summaries.find(s => s.employeeId === empRegan.id);
            const brigidSummary = summaries.find(s => s.employeeId === empBrigid.id);
            const christinaSummary = summaries.find(s => s.employeeId === empChristina.id);
            const alexSummary = summaries.find(s => s.employeeId === empAlex.id);

            // Dylan (Server Pool)
            expect(dylanSummary!.tipPoolGroup).toBe('server_pool');
            expect(dylanSummary!.totalCashTips).toBeCloseTo(8 * 6.6667); // 53.33
            expect(dylanSummary!.totalCreditTips).toBeCloseTo(8 * 8.1333); // 65.07
            expect(dylanSummary!.totalGrossCreditTips).toBeCloseTo(150);
            expect(dylanSummary!.totalBarTipout).toBeCloseTo(-40); // Pays 10% of 400 liquor sales
            expect(dylanSummary!.totalHostTipout).toBeCloseTo(0); // Pooled display
            expect(dylanSummary!.totalSaTipout).toBeCloseTo(0); // Pooled display
            expect(dylanSummary!.totalPayrollTips).toBeCloseTo(8 * 8.1333 - 40); // 65.07 - 40 = 25.07
            expect(dylanSummary!.payrollTotal).toBeCloseTo((3 * 8) + 25.07); // 24 + 25.07 = 49.07

            // Regan (Server Pool)
            expect(reganSummary!.tipPoolGroup).toBe('server_pool');
            expect(reganSummary!.totalCashTips).toBeCloseTo(7 * 6.6667); // 46.67
            expect(reganSummary!.totalCreditTips).toBeCloseTo(7 * 8.1333); // 56.93
            expect(reganSummary!.totalGrossCreditTips).toBeCloseTo(150);
            expect(reganSummary!.totalBarTipout).toBeCloseTo(-30); // Pays 10% of 300 liquor sales
            expect(reganSummary!.totalHostTipout).toBeCloseTo(0);
            expect(reganSummary!.totalSaTipout).toBeCloseTo(0);
            expect(reganSummary!.totalPayrollTips).toBeCloseTo(7 * 8.1333 - 30); // 56.93 - 30 = 26.93
            expect(reganSummary!.payrollTotal).toBeCloseTo((3 * 7) + 26.93); // 21 + 26.93 = 47.93

            // Brigid (Bar)
            expect(brigidSummary!.tipPoolGroup).toBeUndefined(); // Not pooled
            expect(brigidSummary!.totalCashTips).toBeCloseTo(0);
            expect(brigidSummary!.totalCreditTips).toBeCloseTo(0);
            expect(brigidSummary!.totalGrossCreditTips).toBeCloseTo(0);
            expect(brigidSummary!.totalBarTipout).toBeCloseTo(70); // Receives 10% of 700 total liquor sales
            expect(brigidSummary!.totalHostTipout).toBeCloseTo(0);
            expect(brigidSummary!.totalSaTipout).toBeCloseTo(0);
            expect(brigidSummary!.totalPayrollTips).toBeCloseTo(0 + 70); // 0 + 70 = 70
            expect(brigidSummary!.payrollTotal).toBeCloseTo((9 * 6) + 70); // 54 + 70 = 124

            // Christina (Host)
            expect(christinaSummary!.tipPoolGroup).toBeUndefined(); // Not pooled
            expect(christinaSummary!.totalCashTips).toBeCloseTo(0);
            expect(christinaSummary!.totalCreditTips).toBeCloseTo(0);
            expect(christinaSummary!.totalGrossCreditTips).toBeCloseTo(0);
            expect(christinaSummary!.totalBarTipout).toBeCloseTo(0);
            expect(christinaSummary!.totalHostTipout).toBeCloseTo(28); // Receives 7% of 400 total tips
            expect(christinaSummary!.totalSaTipout).toBeCloseTo(0);
            expect(christinaSummary!.totalPayrollTips).toBeCloseTo(0 + 28); // 0 + 28 = 28
            expect(christinaSummary!.payrollTotal).toBeCloseTo((5 * 5) + 28); // 25 + 28 = 53

            // Alex (SA)
            expect(alexSummary!.tipPoolGroup).toBeUndefined(); // Not pooled
            expect(alexSummary!.totalCashTips).toBeCloseTo(0);
            expect(alexSummary!.totalCreditTips).toBeCloseTo(0);
            expect(alexSummary!.totalGrossCreditTips).toBeCloseTo(0);
            expect(alexSummary!.totalBarTipout).toBeCloseTo(0);
            expect(alexSummary!.totalHostTipout).toBeCloseTo(0);
            expect(alexSummary!.totalSaTipout).toBeCloseTo(16); // Receives 4% of 400 total tips
            expect(alexSummary!.totalPayrollTips).toBeCloseTo(0 + 16); // 0 + 16 = 16
            expect(alexSummary!.payrollTotal).toBeCloseTo((4 * 4) + 16); // 16 + 16 = 32
        });
        
        it('should handle zero hour shifts correctly', () => {
             const shifts: Shift[] = [
                 mockShift('s1', empDylan, roleServer, '2024-03-15', 0, 50, 150, 400), // Zero hours
                 mockShift('s2', empChristina, roleHost, '2024-03-15', 8, 0, 0, 0), // Normal hours
            ];
            const summaries = calculateEmployeeRoleSummariesDaily(shifts);
            const dylanSummary = summaries.find(s => s.employeeName === 'Dylan');
            
            expect(dylanSummary).toBeDefined();
            expect(dylanSummary!.totalHours).toBe(0);
            expect(dylanSummary!.totalCashTips).toBeCloseTo(0); // Tips should be zeroed out due to pooling rate calc
            expect(dylanSummary!.totalCreditTips).toBeCloseTo(0);
            expect(dylanSummary!.totalGrossCreditTips).toBeCloseTo(150);
            expect(dylanSummary!.totalPayrollTips).toBeCloseTo(0);
            expect(dylanSummary!.cashTipsPerHour).toBe(0);
            expect(dylanSummary!.creditTipsPerHour).toBe(0);
            expect(dylanSummary!.totalTipsPerHour).toBe(0);
            expect(dylanSummary!.payrollTotal).toBeCloseTo(0);
        });

        it('should handle empty shifts array', () => {
            const summaries = calculateEmployeeRoleSummariesDaily([]);
            expect(summaries).toEqual([]);
        });

    });
}); 