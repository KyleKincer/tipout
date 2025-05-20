import { calculateEmployeeRoleSummariesDaily, calculateOverallSummary } from './reportCalculations';
import { Shift, EmployeeRoleSummary, RoleConfig, ReportSummary, TipoutType } from '@/types/reports'; // Assuming types are exported from here

// --- Mock Data Setup ---

const mockEmployee = (id: string, name: string): { id: string; name: string } => ({ id, name });

const mockRoleConfig = (
    id: string,
    tipoutType: string,
    percentageRate: number,
    options: Partial<RoleConfig> & { tipPoolGroup?: string | null, basePayRate?: number } = {}
): RoleConfig => ({
    id,
    tipoutType: tipoutType as TipoutType,
    percentageRate,
    effectiveFrom: options.effectiveFrom ?? '2024-01-01',
    effectiveTo: options.effectiveTo === undefined ? null : options.effectiveTo, // Allow explicit null for effectiveTo
    receivesTipout: options.receivesTipout ?? false,
    paysTipout: options.paysTipout ?? true,
    distributionGroup: options.distributionGroup ?? undefined,
    tipPoolGroup: options.tipPoolGroup ?? undefined,
    basePayRate: options.basePayRate ?? 0, // Add basePayRate, default to 0
});

const mockRole = ( // basePayRate is now part of configs
    id: string, 
    name: string,
    configs: RoleConfig[],
): Shift['role'] => ({
    name,
    // basePayRate is no longer directly on role, it's sourced from active config
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
    // The 'configs' parameter directly on mockShift was likely a leftover or misunderstanding.
    // Shift data should primarily rely on `shift.role.configs`.
    // We will remove the standalone `configs: RoleConfig[] = []` parameter from mockShift.
    // If a test needs to override configs for a specific shift, it should modify `shift.role.configs`.
): Shift => ({
    id,
    employee,
    role, // This role object now contains the configs array which holds basePayRate
    date,
    hours,
    cashTips,
    creditTips,
    liquorSales,
    // `configs` property removed from Shift type/mock as it's on `role.configs`
});

// --- Common Roles --- Updated to include basePayRate in configs
// For simplicity, giving a default basePayRate to the first config.
// If a test needs specific basePayRate for a role, it should customize configs.
const serverConfigs = [
    mockRoleConfig('cfgSrvBar', 'bar', 25, { paysTipout: true, tipPoolGroup: 'server_pool', basePayRate: 3, effectiveFrom: '2024-01-01', effectiveTo: null }),
    mockRoleConfig('cfgSrvHost', 'host', 7, { paysTipout: true, tipPoolGroup: 'server_pool', basePayRate: 3, effectiveFrom: '2024-01-01', effectiveTo: null }), 
    mockRoleConfig('cfgSrvSa', 'sa', 4, { paysTipout: true, tipPoolGroup: 'server_pool', basePayRate: 3, effectiveFrom: '2024-01-01', effectiveTo: null }),
];
const roleServer = mockRole('roleSrv', 'Server', serverConfigs);

const barConfigs = [
    mockRoleConfig('cfgBarBar', 'bar', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'bartenders', tipPoolGroup: 'bar_pool', basePayRate: 9, effectiveFrom: '2024-01-01', effectiveTo: null }),
    mockRoleConfig('cfgBarHost', 'host', 7, { paysTipout: true, tipPoolGroup: 'bar_pool', basePayRate: 9, effectiveFrom: '2024-01-01', effectiveTo: null }),
    mockRoleConfig('cfgBarSa', 'sa', 4, { paysTipout: true, tipPoolGroup: 'bar_pool', basePayRate: 9, effectiveFrom: '2024-01-01', effectiveTo: null }),
];
const roleBar = mockRole('roleBar', 'Bar', barConfigs);

const hostConfigs = [
     mockRoleConfig('cfgHostHost', 'host', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'hosts', basePayRate: 10, effectiveFrom: '2024-01-01', effectiveTo: null }),
];
const roleHost = mockRole('roleHost', 'Host', hostConfigs);

const saConfigs = [
     mockRoleConfig('cfgSaSa', 'sa', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'support', basePayRate: 8, effectiveFrom: '2024-01-01', effectiveTo: null }),
];
const roleSA = mockRole('roleSA', 'SA', saConfigs);


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
        
        it('Scenario: Simple Non-Pooled (Server pays, Host receives) - Adapted for basePayRate in config', () => {
            // Ensure the mockRoleConfig includes basePayRate and effective dates
            const simpleServerConfig = [ mockRoleConfig('cfgSimpleBar', 'bar', 10, { paysTipout: true, basePayRate: 3, effectiveFrom: '2024-01-01', effectiveTo: null }) ]; 
            const simpleHostConfig = [ mockRoleConfig('cfgSimpleHost', 'bar', 0, { receivesTipout: true, paysTipout: false, distributionGroup: 'hosts', basePayRate: 10, effectiveFrom: '2024-01-01', effectiveTo: null }) ]; 
            const roleSimpleServer = mockRole('roleSimpleSrv', 'Server', simpleServerConfig);
            const roleSimpleReceiver = mockRole('roleSimpleRec', 'Host', simpleHostConfig);
            
            const shifts: Shift[] = [
                // mockShift no longer takes a 9th 'configs' parameter. It uses shift.role.configs.
                mockShift('s1', empDylan, roleSimpleServer, '2024-03-15', 8, 50, 150, 400), 
                mockShift('s2', empChristina, roleSimpleReceiver, '2024-03-15', 8, 0, 0, 0), 
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
            // Bar Tipout: 10% of Liq Sales (paid by individual servers from their share of sales if not specified otherwise, or by pool)
            // Host Tipout: 7% of Original Tips (paid by pool before distribution or by individuals)
            // SA Tipout: 4% of Original Tips (paid by pool before distribution or by individuals)
            // Base pay for server is 3, for bar is 9, for host is 10, for SA is 8 (from updated global mocks)

            // The global roleServer, roleBar etc. already have basePayRate in their configs.
            // The mockShift no longer takes a 9th 'configs' parameter. It uses shift.role.configs.
            const shifts: Shift[] = [
                mockShift('s1', empDylan, roleServer, '2024-03-15', 8, 50, 150, 400), 
                mockShift('s2', empRegan, roleServer, '2024-03-15', 7, 50, 150, 300), 
                mockShift('s3', empBrigid, roleBar, '2024-03-15', 6, 0, 0, 0),    
                mockShift('s4', empChristina, roleHost, '2024-03-15', 5, 0, 0, 0), 
                mockShift('s5', empAlex, roleSA, '2024-03-15', 4, 0, 0, 0),       
            ];

            const summaries = calculateEmployeeRoleSummariesDaily(shifts);
            // Payroll expectations need to be updated based on the basePayRates from the global mocks:
            // Server: 3, Bar: 9, Host: 10, SA: 8
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
            expect(dylanSummary!.payrollTotal).toBeCloseTo((3 * 8) + 25.07); // Server base rate 3

            // Regan (Server Pool)
            expect(reganSummary!.tipPoolGroup).toBe('server_pool');
            expect(reganSummary!.totalCashTips).toBeCloseTo(7 * 6.6667); // 46.67
            expect(reganSummary!.totalCreditTips).toBeCloseTo(7 * 8.1333); // 56.93
            expect(reganSummary!.totalGrossCreditTips).toBeCloseTo(150);
            expect(reganSummary!.totalBarTipout).toBeCloseTo(-30); // Pays 10% of 300 liquor sales
            expect(reganSummary!.totalHostTipout).toBeCloseTo(0);
            expect(reganSummary!.totalSaTipout).toBeCloseTo(0);
            expect(reganSummary!.totalPayrollTips).toBeCloseTo(7 * 8.1333 - 30); // 56.93 - 30 = 26.93
            expect(reganSummary!.payrollTotal).toBeCloseTo((3 * 7) + 26.93); // Server base rate 3

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
        
        it('should handle zero hour shifts correctly (basePayRate from config)', () => {
             const shifts: Shift[] = [
                 mockShift('s1', empDylan, roleServer, '2024-03-15', 0, 50, 150, 400), 
                 mockShift('s2', empChristina, roleHost, '2024-03-15', 8, 0, 0, 0), 
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

        // --- New Tests for Base Pay Rate Logic ---
        describe('calculateEmployeeRoleSummariesDaily - Base Pay Rate Changes', () => {
            const empTest = mockEmployee('empTest', 'Tester');

            it('should use basePayRate from config active on shift date', () => {
                const roleWithChangingPay: Shift['role'] = mockRole('rolePayChange', 'PayRole', [
                    mockRoleConfig('cfgPay1', 'GENERAL', 0, { basePayRate: 10, effectiveFrom: '2024-01-01', effectiveTo: '2024-01-15' }),
                    mockRoleConfig('cfgPay2', 'GENERAL', 0, { basePayRate: 12, effectiveFrom: '2024-01-16', effectiveTo: '2024-01-31' }),
                ]);
                const shifts: Shift[] = [
                    mockShift('shift1', empTest, roleWithChangingPay, '2024-01-10', 8, 0, 100, 0), // Should use $10/hr
                    mockShift('shift2', empTest, roleWithChangingPay, '2024-01-20', 8, 0, 100, 0), // Should use $12/hr
                ];
                const summaries = calculateEmployeeRoleSummariesDaily(shifts);
                
                // Need to find summaries more reliably if order isn't guaranteed or other shifts exist
                // Since these are different days, they will be processed separately and then aggregated.
                // If they were the same day, they'd be one summary.
                // For this test, assuming they result in distinct summary entries due to different processing days or if we were to check daily results.
                // However, calculateEmployeeRoleSummariesDaily aggregates, so we expect ONE summary for empTest/PayRole.
                // The basePayRate on that summary will be from the LATEST shift processed for that employee-role combo.
                // The important part is that payrollTotal reflects the different base rates.
                
                const summary = summaries.find(s => s.employeeName === 'Tester');
                expect(summary).toBeDefined();
                expect(summary!.totalHours).toBe(16); // 8 + 8
                expect(summary!.basePayRate).toBe(12); // From the latest shift (Jan 20)
                expect(summary!.totalPayrollTips).toBe(200); // 100 + 100
                // Payroll: (10*8 + 100) + (12*8 + 100) = (80+100) + (96+100) = 180 + 196 = 376
                expect(summary!.payrollTotal).toBe(376);
            });

            it('should use correct basePayRate on effectiveFrom and effectiveTo dates', () => {
                 const roleWithChangingPay: Shift['role'] = mockRole('rolePayEdge', 'PayRoleEdge', [
                    mockRoleConfig('cfgPayEdge1', 'GENERAL', 0, { basePayRate: 10, effectiveFrom: '2024-02-01', effectiveTo: '2024-02-10' }),
                    mockRoleConfig('cfgPayEdge2', 'GENERAL', 0, { basePayRate: 12, effectiveFrom: '2024-02-11', effectiveTo: '2024-02-20' }),
                ]);
                const shifts: Shift[] = [
                    mockShift('sEdge1', empTest, roleWithChangingPay, '2024-02-10', 5, 0, 50, 0), // Uses $10 (on effectiveTo of first config)
                    mockShift('sEdge2', empTest, roleWithChangingPay, '2024-02-11', 5, 0, 50, 0), // Uses $12 (on effectiveFrom of second config)
                ];
                const summaries = calculateEmployeeRoleSummariesDaily(shifts);
                const summary = summaries.find(s => s.employeeName === 'Tester');
                expect(summary).toBeDefined();
                expect(summary!.totalHours).toBe(10);
                expect(summary!.basePayRate).toBe(12); // From latest shift (Feb 11)
                // Payroll: (10*5 + 50) + (12*5 + 50) = (50+50) + (60+50) = 100 + 110 = 210
                expect(summary!.payrollTotal).toBe(210);
            });
            
            it('should use default basePayRate (0) if no config has basePayRate defined or no config matches', () => {
                const roleNoPayConfig: Shift['role'] = mockRole('roleNoPay', 'NoPayRole', [
                    // Explicitly undefined basePayRate for the active period
                    mockRoleConfig('cfgNoPay', 'GENERAL', 0, { basePayRate: undefined, effectiveFrom: '2024-01-01', effectiveTo: null }),
                ]);
                 const shifts: Shift[] = [
                    mockShift('sNoPay', empTest, roleNoPayConfig, '2024-01-05', 8, 0, 100, 0),
                ];
                const summaries = calculateEmployeeRoleSummariesDaily(shifts);
                const summary = summaries[0];

                expect(summary.basePayRate).toBe(0); // Defaults to 0 because undefined in config
                expect(summary.payrollTotal).toBe((0 * 8) + 100); // 0 + 100 = 100

                // Test with no matching config at all for the shift date
                 const roleNoMatchingConfig: Shift['role'] = mockRole('roleNoMatch', 'NoMatchRole', [
                    mockRoleConfig('cfgNoMatchPay', 'GENERAL', 0, { basePayRate: 20, effectiveFrom: '2023-01-01', effectiveTo: '2023-12-31' }),
                ]);
                 const shifts2: Shift[] = [
                    mockShift('sNoMatchPay', empTest, roleNoMatchingConfig, '2024-01-10', 8, 0, 100, 0),
                ];
                const summaries2 = calculateEmployeeRoleSummariesDaily(shifts2);
                const summary2 = summaries2[0];
                expect(summary2.basePayRate).toBe(0); // Defaults to 0 as no config is active
                expect(summary2.payrollTotal).toBe((0 * 8) + 100);
            });

            it('should handle multiple shifts for the same employee/role across basePayRate changes (aggregation check)', () => {
                 const roleMultiPay: Shift['role'] = mockRole('roleMulti', 'MultiPay', [
                    mockRoleConfig('cfgMP1', 'GENERAL', 0, { basePayRate: 10, effectiveFrom: '2024-03-01', effectiveTo: '2024-03-10' }),
                    mockRoleConfig('cfgMP2', 'GENERAL', 0, { basePayRate: 15, effectiveFrom: '2024-03-11', effectiveTo: null }),
                ]);
                const shifts: Shift[] = [
                    // These shifts are on different days, so daily processing will handle them separately,
                    // then they are aggregated into one EmployeeRoleSummary.
                    mockShift('mShift1', empTest, roleMultiPay, '2024-03-05', 8, 0, 50, 0), // $10/hr -> Base Pay: 80, PayrollTips: 50
                    mockShift('mShift2', empTest, roleMultiPay, '2024-03-15', 6, 0, 30, 0), // $15/hr -> Base Pay: 90, PayrollTips: 30
                ];

                const summaries = calculateEmployeeRoleSummariesDaily(shifts);
                const summary = summaries.find(s => s.employeeName === 'Tester');

                expect(summary).toBeDefined();
                expect(summary!.totalHours).toBe(14);
                // The basePayRate on the summary object will be the one from the *last* shift processed for that employee/role
                // during the aggregation phase. This is an existing behavior of the summarization.
                expect(summary!.basePayRate).toBe(15); 
                expect(summary!.totalPayrollTips).toBeCloseTo(80); // 50 + 30
                expect(summary!.payrollTotal).toBeCloseTo((10 * 8) + 50 + (15 * 6) + 30); // 80 + 50 + 90 + 30 = 250
            });
            
            it('Role has only one RoleConfig for base pay', () => {
                const roleSinglePayConfig: Shift['role'] = mockRole('roleSingle', 'SinglePay', [
                    mockRoleConfig('cfgSingle1', 'GENERAL', 0, { basePayRate: 11, effectiveFrom: '2024-01-01', effectiveTo: null }),
                ]);
                const shifts: Shift[] = [
                    mockShift('sSingle1', empTest, roleSinglePayConfig, '2024-01-05', 7, 0, 70, 0),
                    mockShift('sSingle2', empTest, roleSinglePayConfig, '2024-02-05', 7, 0, 70, 0),
                ];
                const summaries = calculateEmployeeRoleSummariesDaily(shifts);
                const summary = summaries.find(s => s.employeeName === 'Tester');
                expect(summary).toBeDefined();
                expect(summary!.totalHours).toBe(14);
                expect(summary!.basePayRate).toBe(11);
                expect(summary!.totalPayrollTips).toBe(140);
                expect(summary!.payrollTotal).toBe((11 * 14) + 140); // 154 + 140 = 294
            });
        });
    });
}); 