'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PieController,
  ArcElement,
  PointElement,
  LineElement
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
// Types will now likely come from the API response or a shared types file
// import { ReportSummary, EmployeeRoleSummary, Employee } from '@/utils/reportCalculations'; // Example if types are shared

// --- Type Definitions (Define based on API response structure) ---
// It's best practice to define these based on the actual API response shape
// or import from a shared types definition file (e.g., src/types.ts)

type Employee = {
  id: string
  name: string
}

type ReportSummary = {
  totalShifts: number
  totalHours: number
  totalCashTips: number
  totalCreditTips: number
  totalLiquorSales: number
  totalBarTipoutPaid: number
  totalHostTipoutPaid: number
  totalSaTipoutPaid: number
  // Add other fields if returned by calculateOverallSummary and needed by UI
  // barTipsPerHour?: number;
  // serverTipsPerHour?: number;
}

type EmployeeRoleSummary = {
  employeeId: string
  employeeName: string
  roleName: string
  totalHours: number
  totalCashTips: number
  totalCreditTips: number
  totalBarTipout: number   // Net amount
  totalHostTipout: number  // Net amount
  totalSaTipout: number    // Net amount
  cashTipsPerHour: number
  creditTipsPerHour: number
  totalTipsPerHour: number
  basePayRate: number
  totalPayrollTips: number
  totalLiquorSales: number
  payrollTotal: number
}

// API Response structure
type ReportData = {
    summary: ReportSummary | null;
    employeeSummaries: EmployeeRoleSummary[];
    roleConfigs: Record<string, {
        bar: number;
        host: number;
        sa: number;
    }>;
}

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PieController,
  ArcElement,
  PointElement,
  LineElement
)

// Create a new client component for the reports content
function ReportsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [employees, setEmployees] = useState<Employee[]>([])
  // State for the processed report data fetched from the API
  const [reportData, setReportData] = useState<ReportData | null>(null);
  // Removed allShiftsData and filteredShifts state
  const [isLoading, setIsLoading] = useState(true) // Main loading for initial fetch
  const [isFilterLoading, setIsFilterLoading] = useState(false) // Loading for subsequent filter changes
  const [error, setError] = useState<string | null>(null)
  const [isDateRange, setIsDateRange] = useState(() => {
      const start = searchParams.get('startDate');
      const end = searchParams.get('endDate');
      return !!(start && end && start !== end);
  });
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null)
  const [filters, setFilters] = useState(() => {
    const start = searchParams.get('startDate') || format(new Date(), 'yyyy-MM-dd');
    const end = searchParams.get('endDate') || start;
    return {
      startDate: start,
      endDate: end,
      employeeId: searchParams.get('employeeId') || '',
    }
  });
  const [groupByEmployee, setGroupByEmployee] = useState(true)

  // Update filters when search params change (e.g., back/forward navigation)
  useEffect(() => {
    const start = searchParams.get('startDate') || format(new Date(), 'yyyy-MM-dd');
    const end = searchParams.get('endDate') || start;
    setFilters({
      startDate: start,
      endDate: end,
      employeeId: searchParams.get('employeeId') || '',
    })
  }, [searchParams])

  // Function to fetch processed report data from the new API endpoint
  const fetchReportData = useCallback(async (currentFilters: typeof filters, rangeEnabled: boolean) => {
    setIsFilterLoading(true);
    setError(null);
    try {
        const queryParams = new URLSearchParams({
            startDate: currentFilters.startDate,
            // Use start date as end date if not in range mode
            endDate: rangeEnabled ? currentFilters.endDate : currentFilters.startDate,
            // We don't need to pass employeeId here, filtering happens client-side if needed
            // Or the API could handle it if preferred, but client-side is fine for display toggle
        });

        const response = await fetch(`/api/reports?${queryParams}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Failed to fetch report data' }));
            throw new Error(errorData.message || 'Failed to fetch report data');
        }
        const data: ReportData = await response.json();
        setReportData(data);
    } catch (err: unknown) {
        // Type guard for Error objects
        if (err instanceof Error) {
            setError(err.message || 'Failed to load report data');
        } else {
            setError('An unknown error occurred while fetching report data');
        }
        setReportData(null); // Clear data on error
        console.error('Error loading report data:', err);
    } finally {
        setIsLoading(false); // Turn off initial load indicator once first fetch attempt completes
        setIsFilterLoading(false);
    }
}, []); // No dependencies, relies on passed-in filters

  // Fetch employees for the filter dropdown (only once on mount)
  useEffect(() => {
    fetchEmployees();
  }, []);

  // Fetch report data when filters or date range mode change
  useEffect(() => {
    fetchReportData(filters, isDateRange);

    // Update URL to reflect current filters
    const params = new URLSearchParams()
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate && (isDateRange || filters.startDate !== filters.endDate)) params.set('endDate', filters.endDate)
    if (filters.employeeId) params.set('employeeId', filters.employeeId)
    const newUrl = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`
    // Use replace instead of push to avoid polluting browser history on every filter change
    router.replace(newUrl, { scroll: false });

  }, [filters, isDateRange, pathname, router, fetchReportData]);

  const fetchEmployees = async () => {
    // This remains the same, fetching the list for the dropdown
    try {
      const response = await fetch('/api/employees')
      if (!response.ok) {
        throw new Error('Failed to fetch employees')
      }
      const data = await response.json()
      setEmployees(data)
    } catch (err) {
      // Non-critical error, maybe just log it
      console.error('Error loading employees for filter:', err)
    }
  }

  // Removed calculateSummary and calculateEmployeeRoleSummaries functions
  // Calculations are now done on the server via the API route

  // Helper: Group EmployeeRoleSummaries by employeeId (remains on client for display toggle)
  function groupSummariesByEmployee(summaries: EmployeeRoleSummary[]): EmployeeRoleSummary[] {
    const grouped = new Map<string, EmployeeRoleSummary[]>()
    for (const summary of summaries) {
      const key = summary.employeeId
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(summary)
    }
    const result: EmployeeRoleSummary[] = []
    for (const [employeeId, summariesForEmployee] of grouped.entries()) {
      if (summariesForEmployee.length === 1) {
        result.push(summariesForEmployee[0])
      } else {
        const agg = {
          employeeId,
          employeeName: summariesForEmployee[0].employeeName,
          roleName: 'All Roles',
          totalHours: 0,
          totalCashTips: 0,
          totalCreditTips: 0,
          totalBarTipout: 0,
          totalHostTipout: 0,
          totalSaTipout: 0,
          cashTipsPerHour: 0,
          creditTipsPerHour: 0,
          totalTipsPerHour: 0,
          basePayRate: 0,
          totalPayrollTips: 0,
          totalLiquorSales: 0,
          payrollTotal: 0,
        } as EmployeeRoleSummary
        for (const summary of summariesForEmployee) {
          agg.totalHours += summary.totalHours
          agg.totalCashTips += summary.totalCashTips
          agg.totalCreditTips += summary.totalCreditTips
          agg.totalBarTipout += summary.totalBarTipout // Summing net amounts
          agg.totalHostTipout += summary.totalHostTipout // Summing net amounts
          agg.totalSaTipout += summary.totalSaTipout   // Summing net amounts
          agg.totalLiquorSales += summary.totalLiquorSales
          agg.basePayRate += summary.basePayRate * summary.totalHours // for weighted avg
          agg.totalPayrollTips = (agg.totalPayrollTips || 0) + (summary.totalPayrollTips || 0)
          agg.payrollTotal = (agg.payrollTotal || 0) + (summary.payrollTotal || 0)
        }
        // Re-calculate per-hour rates based on aggregated values
        agg.cashTipsPerHour = agg.totalHours > 0 ? agg.totalCashTips / agg.totalHours : 0;
        agg.creditTipsPerHour = agg.totalHours > 0 ? (agg.totalPayrollTips ?? 0) / agg.totalHours : 0;
        agg.totalTipsPerHour = agg.totalHours > 0
          ? (agg.totalCashTips + (agg.totalPayrollTips ?? 0)) / agg.totalHours
          : 0
        agg.basePayRate = agg.totalHours > 0 ? agg.basePayRate / agg.totalHours : 0
        result.push(agg)
      }
    }
    return result
  }

  // --- Chart Components --- 
  // Need to be updated to receive reportData or necessary parts of it as props
  // or access it via context if preferred.

  // Example: TipoutBreakdownChart (needs summary data)
  const TipoutBreakdownChart = ({ summary }: { summary: ReportSummary | null }) => {
      if (!summary) return <div className="text-center text-gray-500">No summary data</div>;

      // Use summary.totalHostTipoutPaid, etc.
      const serverTipsNet = summary.totalCashTips + summary.totalCreditTips -
                            (summary.totalBarTipoutPaid + summary.totalHostTipoutPaid + summary.totalSaTipoutPaid);

      const data = {
        labels: ['Net Server Tips', 'Bar Tipout Paid', 'Host Tipout Paid', 'SA Tipout Paid'],
        datasets: [
          {
            label: 'Tip Distribution',
            data: [
                serverTipsNet > 0 ? serverTipsNet : 0, // Ensure non-negative
                summary.totalBarTipoutPaid,
                summary.totalHostTipoutPaid,
                summary.totalSaTipoutPaid,
            ],
            backgroundColor: [
              'rgba(54, 162, 235, 0.7)',  // Blue for server tips
              'rgba(255, 99, 132, 0.7)',  // Red for bar tipout
              'rgba(255, 206, 86, 0.7)',  // Yellow for host tipout
              'rgba(75, 192, 192, 0.7)',   // Teal for SA tipout
            ],
            borderColor: [
              'rgba(54, 162, 235, 1)',
              'rgba(255, 99, 132, 1)',
              'rgba(255, 206, 86, 1)',
              'rgba(75, 192, 192, 1)',
            ],
            borderWidth: 1,
          },
        ],
      }
      // Filter out labels/data where value is zero or negligible
      const validIndices = data.datasets[0].data.map((val, i) => val > 0.01 ? i : -1).filter(i => i !== -1);
      const filteredLabels = validIndices.map(i => data.labels[i]);
      const filteredData = validIndices.map(i => data.datasets[0].data[i]);
      const filteredBgColors = validIndices.map(i => data.datasets[0].backgroundColor[i]);
      const filteredBorderColors = validIndices.map(i => data.datasets[0].borderColor[i]);

      const chartData = {
          labels: filteredLabels,
          datasets: [{
              ...data.datasets[0],
              data: filteredData,
              backgroundColor: filteredBgColors,
              borderColor: filteredBorderColors,
          }]
      }

    return (
      <div className="h-full">
        <div className="h-full flex justify-center">
          <div className="w-full max-w-lg">
          <Doughnut
            data={chartData} // Use filtered data
            options={{
              responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.5,
              plugins: {
                legend: {
                  position: 'right' as const,
                  labels: {
                    boxWidth: 15,
                    padding: 15,
                      color: '#ffffff',
                    font: {
                      size: 12
                    }
                  }
                },
                tooltip: {
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  callbacks: {
                    label: function(context) {
                      const value = context.raw as number;
                      // Calculate total from the *filtered* data
                      const total = context.dataset.data.reduce((a, b) => (a as number) + (b as number), 0) as number;
                      const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                      return `${context.label}: $${value.toFixed(2)} (${percentage}%)`;
                    }
                  }
                }
              },
            }}
          />
        </div>
        </div>
      </div>
    )
  }

  // Example: TipoutPerHourChart (needs employeeSummaries)
  const TipoutPerHourChart = ({ summaries }: { summaries: EmployeeRoleSummary[] }) => {
      if (!summaries || summaries.length === 0) return <div className="text-center text-gray-500">No employee data</div>;

       // Group summaries by roleName to calculate averages
      const roleData = summaries.reduce((acc, summary) => {
        if (!acc[summary.roleName]) {
          acc[summary.roleName] = {
            totalHours: 0,
            totalTipsPerHourSum: 0,
            cashTipsPerHourSum: 0,
            creditTipsPerHourSum: 0,
            basePayRateSum: 0,
            count: 0 // Count entries per role
          }
        }
        // Sum the already calculated per-hour rates for averaging
        acc[summary.roleName].totalHours += summary.totalHours;
        acc[summary.roleName].totalTipsPerHourSum += summary.totalTipsPerHour * summary.totalHours; // Weighted sum
        acc[summary.roleName].cashTipsPerHourSum += summary.cashTipsPerHour * summary.totalHours; // Weighted sum
        acc[summary.roleName].creditTipsPerHourSum += summary.creditTipsPerHour * summary.totalHours; // Weighted sum
        acc[summary.roleName].basePayRateSum += summary.basePayRate * summary.totalHours; // Weighted sum for avg base pay
        acc[summary.roleName].count += 1; // Simple count, but maybe weighted average is better?

        return acc
      }, {} as Record<string, { totalHours: number, totalTipsPerHourSum: number, cashTipsPerHourSum: number, creditTipsPerHourSum: number, basePayRateSum: number, count: number }>)

      const roles = Object.keys(roleData);
      const averages = roles.map(role => {
        const roleHours = roleData[role].totalHours;
        const avgTotalTips = roleHours > 0 ? roleData[role].totalTipsPerHourSum / roleHours : 0;
        const avgCashTips = roleHours > 0 ? roleData[role].cashTipsPerHourSum / roleHours : 0;
        const avgCreditTips = roleHours > 0 ? roleData[role].creditTipsPerHourSum / roleHours : 0;
        const avgBasePay = roleHours > 0 ? roleData[role].basePayRateSum / roleHours : 0;
        return {
          role,
          totalTipsPerHour: avgTotalTips,
          cashTipsPerHour: avgCashTips,
          creditTipsPerHour: avgCreditTips,
          basePayRate: avgBasePay,
          totalEarningsPerHour: avgTotalTips + avgBasePay
        }
      })

    // Sort roles by total earnings per hour (descending)
    averages.sort((a, b) => b.totalEarningsPerHour - a.totalEarningsPerHour);

    const data = {
      labels: averages.map(a => a.role),
      datasets: [
        {
          label: 'Total Earnings/Hour',
          data: averages.map(a => a.totalEarningsPerHour),
          backgroundColor: 'rgba(255, 159, 64, 0.7)',  // Orange for total earnings
          borderColor: 'rgba(255, 159, 64, 1)',
          borderWidth: 1,
        },
        {
          label: 'Base Pay/Hour',
          data: averages.map(a => a.basePayRate),
          backgroundColor: 'rgba(255, 206, 86, 0.7)',  // Yellow for base pay
          borderColor: 'rgba(255, 206, 86, 1)',
          borderWidth: 1,
        },
        {
          label: 'Total Tips/Hour',
          data: averages.map(a => a.totalTipsPerHour),
          backgroundColor: 'rgba(153, 102, 255, 0.7)',
          borderColor: 'rgba(153, 102, 255, 1)',
          borderWidth: 1,
        },
        {
          label: 'Cash Tips/Hour',
          data: averages.map(a => a.cashTipsPerHour),
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
        {
          label: 'Payroll Tips/Hour', // Renamed from Credit Tips/Hour for clarity
          data: averages.map(a => a.creditTipsPerHour),
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
        },
      ],
    }

    return (
      <div className="h-full">
        <div className="h-full">
          <Bar
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: true,
              scales: {
                y: {
                  beginAtZero: true,
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                  },
                  title: {
                    display: true,
                    text: '$ Per Hour',
                    color: '#ffffff',
                  }
                },
                x: {
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                  }
                }
              },
              plugins: {
                legend: {
                  labels: {
                    color: '#ffffff',
                    padding: 20,
                  }
                },
                tooltip: {
                  titleColor: '#ffffff',
                  bodyColor: '#ffffff',
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  padding: 12,
                  callbacks: {
                    label: function(context) {
                      return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
                    }
                  }
                }
              }
            }}
          />
        </div>
      </div>
    )
  }

  // Example: TipoutContributionChart (needs employeeSummaries)
  const TipoutContributionChart = ({ summaries }: { summaries: EmployeeRoleSummary[] }) => {
     if (!summaries || summaries.length === 0) return <div className="text-center text-gray-500">No employee data</div>;

    // Group tipout data by employee Name (using the summaries already processed)
    const employeeTipouts = summaries.reduce((acc, summary) => {
      if (!acc[summary.employeeName]) {
        acc[summary.employeeName] = {
          paid: 0,
          received: 0
        };
      }
      // Use the net tipout amounts calculated daily
      // Negative net means more paid out than received for that type
      // Positive net means more received than paid out for that type
      if (summary.totalBarTipout < 0) acc[summary.employeeName].paid += Math.abs(summary.totalBarTipout);
      else if (summary.totalBarTipout > 0) acc[summary.employeeName].received += summary.totalBarTipout;

      if (summary.totalHostTipout < 0) acc[summary.employeeName].paid += Math.abs(summary.totalHostTipout);
      else if (summary.totalHostTipout > 0) acc[summary.employeeName].received += summary.totalHostTipout;

      if (summary.totalSaTipout < 0) acc[summary.employeeName].paid += Math.abs(summary.totalSaTipout);
      else if (summary.totalSaTipout > 0) acc[summary.employeeName].received += summary.totalSaTipout;

      return acc;
    }, {} as Record<string, { paid: number, received: number }>);

    const employees = Object.keys(employeeTipouts);
    employees.sort((a, b) => {
      const totalA = employeeTipouts[a].paid + employeeTipouts[a].received;
      const totalB = employeeTipouts[b].paid + employeeTipouts[b].received;
      return totalB - totalA;
    });

    const significantEmployees = employees.filter(emp =>
      employeeTipouts[emp].paid > 0.01 || employeeTipouts[emp].received > 0.01
    ).slice(0, 10); // Limit to top 10

    const data = {
      labels: significantEmployees,
      datasets: [
        {
          label: 'Tipout Paid/Contributed', // Renamed
          data: significantEmployees.map(emp => employeeTipouts[emp].paid),
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
        {
          label: 'Tipout Received From Pool',
          data: significantEmployees.map(emp => employeeTipouts[emp].received),
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
      ],
    };

    return (
      <div className="h-full">
        <div className="h-full">
          <Bar
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: true,
              indexAxis: 'y' as const,
              scales: {
                x: {
                  stacked: false, // Show bars side-by-side
                  beginAtZero: true,
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                  },
                  title: {
                    display: true,
                    text: 'Amount ($)',
                    color: '#ffffff',
                  }
                },
                y: {
                  stacked: false,
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                  }
                }
              },
              plugins: {
                legend: {
                  labels: {
                    color: '#ffffff',
                    padding: 20,
                  }
                },
                tooltip: {
                  titleColor: '#ffffff',
                  bodyColor: '#ffffff',
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  padding: 12,
                  callbacks: {
                    label: function(context) {
                      return `${context.dataset.label}: $${context.parsed.x.toFixed(2)}`;
                    }
                  }
                }
              }
            }}
          />
        </div>
      </div>
    )
  }

  // Example: TipoutRatesChart (needs employeeSummaries for roles)
  const TipoutRatesChart = ({ summaries }: { summaries: EmployeeRoleSummary[] }) => {
    if (!summaries || summaries.length === 0) return <div className="text-center text-gray-500">No employee data</div>;

    // Get roleConfigs from reportData
    const roleConfigs = reportData?.roleConfigs || {};
    
    // Get the roles in a sorted array
    const roles = Object.keys(roleConfigs).sort();

    const data = {
      labels: roles,
      datasets: [
        {
          label: 'Bar Tipout (% of Liquor Sales)',
          data: roles.map(role => roleConfigs[role].bar),
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
        {
          label: 'Host Tipout (% of Tips)',
          data: roles.map(role => roleConfigs[role].host),
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
        {
          label: 'SA Tipout (% of Tips)',
          data: roles.map(role => roleConfigs[role].sa),
          backgroundColor: 'rgba(153, 102, 255, 0.7)',
          borderColor: 'rgba(153, 102, 255, 1)',
          borderWidth: 1,
        },
      ],
    };

    // If no rates found, show a more informative message
    if (roles.length === 0 || !roles.some(role => 
      roleConfigs[role].bar > 0 || roleConfigs[role].host > 0 || roleConfigs[role].sa > 0
    )) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <h3 className="text-lg font-medium mb-2">No Tipout Rates Found</h3>
            <p className="text-sm">
              Tipout rates are configured in the role settings.<br/>
              Visit the roles page to set up tipout rates.
            </p>
            <Link 
              href="/roles" 
              className="inline-flex items-center px-4 py-2 mt-4 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Configure Roles
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full">
        <div className="h-full">
          <Bar
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: true,
              scales: {
                y: {
                  beginAtZero: true,
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                    callback: function(value) {
                      return value + '%';
                    }
                  },
                  title: {
                    display: true,
                    text: 'Percentage',
                    color: '#ffffff',
                  }
                },
                x: {
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                  },
                  ticks: {
                    color: '#ffffff',
                  }
                }
              },
              plugins: {
                legend: {
                  labels: {
                    color: '#ffffff',
                    padding: 20,
                  }
                },
                tooltip: {
                  titleColor: '#ffffff',
                  bodyColor: '#ffffff',
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  callbacks: {
                    label: function(context) {
                      return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                    }
                  }
                }
              }
            }}
          />
        </div>
      </div>
    );
  };

  // Fullscreen chart component wrapper
  // This function remains largely the same
  const FullscreenChart: React.FC<{ id: string, title: string, children: React.ReactNode }> = ({ id, title, children }) => {
    // Return actual JSX for the component wrapper
    return (
      <div className="h-full relative">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium leading-6 text-[var(--foreground)]">{title}</h3>
          <button
            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => setFullscreenChart(id)}
            aria-label={`View ${title} in fullscreen mode`}
            title={`View ${title} in fullscreen mode`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
        <div className="h-[calc(100%-2rem)]">
          {children}
        </div>
      </div>
    );
  };

  // Fullscreen modal component
  // Needs to be updated to render charts with data from reportData state
  const FullscreenModal = () => {
    useEffect(() => {
      if (!fullscreenChart) return;
      const handleKeyDown = (e: KeyboardEvent) => { /* ... */ };
      document.addEventListener('keydown', handleKeyDown);
      const previousActiveElement = document.activeElement as HTMLElement;
      const modalContainer = document.getElementById('fullscreen-modal-container');
      if (modalContainer) modalContainer.focus();
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (previousActiveElement) previousActiveElement.focus();
        document.body.style.overflow = '';
      };
    }, [fullscreenChart]);

    if (!fullscreenChart || !reportData) return null;

    // Removed getFullscreenChartOptions call from here as options are handled within specific chart components

    const renderChartContent = () => {
      switch (fullscreenChart) {
        case 'tipout-breakdown': {
            // Pass the summary data to the chart component
            return <TipoutBreakdownChart summary={reportData.summary} />;
        }
        case 'tipout-per-hour':
        case 'tipout-contribution': {
          // Pass the employee summaries data to the chart component
          const Component = {
            'tipout-per-hour': TipoutPerHourChart,
            // 'tipout-rates': TipoutRatesChart, // Removed/Placeholder
            'tipout-contribution': TipoutContributionChart
          }[fullscreenChart];
          return Component ? <Component summaries={reportData.employeeSummaries} /> : null;
        }
         case 'tipout-rates': // Handle placeholder
           return <TipoutRatesChart summaries={reportData.employeeSummaries} />;
        default:
          return null;
      }
    };

    const getChartTitle = () => {
      switch (fullscreenChart) {
        case 'tipout-breakdown': return 'Where Tips Go';
        case 'tipout-per-hour': return 'Avg Earnings Per Hour By Role';
        case 'tipout-rates': return 'Tipout Rates By Role (Placeholder)';
        case 'tipout-contribution': return 'Tipout Flow By Employee';
        default: return '';
      }
    };

    return (
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => setFullscreenChart(null)}
      >
        <div
          id="fullscreen-modal-container"
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()} // Prevent clicks on the modal from closing it
          tabIndex={-1} // For focus management
        >
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h3 className="text-xl font-semibold text-[var(--foreground)]">{getChartTitle()}</h3>
            <div className="flex items-center gap-2">
              {/* ... close buttons ... */}
            </div>
          </div>
          <div className="p-4 h-[calc(100%-4.5rem)] flex items-center justify-center">
            <div className="w-[90%] h-[90%] flex items-center justify-center">
              <div className="w-full h-full">
                {renderChartContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Main Render --- 

  if (isLoading) {
    return <LoadingSpinner />
  }

  // Use reportData from state
  const summary = reportData?.summary;
  const allEmployeeRoleSummaries = reportData?.employeeSummaries || [];

  // Filter the fetched summaries for display if an employee filter is active
  let displayedEmployeeSummaries = filters.employeeId
    ? allEmployeeRoleSummaries.filter(s => s.employeeId === filters.employeeId)
    : allEmployeeRoleSummaries;

  // Grouping logic remains the same, operates on fetched summaries
  if (groupByEmployee) {
    displayedEmployeeSummaries = groupSummariesByEmployee(displayedEmployeeSummaries)
  }
  // Sorting logic remains the same
  displayedEmployeeSummaries = displayedEmployeeSummaries.slice().sort((a, b) => a.employeeName.localeCompare(b.employeeName))

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* ... Page Title ... */}

      {error && (
        <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/50 p-4">
          {/* ... Error display ... */}
        </div>
      )}

      {/* --- Filters --- */}
      <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-sm text-gray-700 dark:text-gray-300">single date</span>
            <button
              type="button"
              onClick={() => {
                const newIsDateRange = !isDateRange;
                setIsDateRange(newIsDateRange);
                // If switching to single date, set endDate to match startDate
                if (!newIsDateRange) {
                  setFilters(prev => ({ ...prev, endDate: prev.startDate }));
                }
              }}
              className={`${
                isDateRange ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  isDateRange ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">date range</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-[var(--foreground)]">
                {isDateRange ? 'start date' : 'date'}
              </label>
              <div className="mt-1">
                <input
                  type="date"
                  id="startDate"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  disabled={isFilterLoading}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>
            {isDateRange && (
              <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-[var(--foreground)]">
                  end date
                </label>
                <div className="mt-1">
                  <input
                    type="date"
                    id="endDate"
                    value={filters.endDate}
                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    disabled={isFilterLoading}
                    className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="employeeId" className="block text-sm font-medium text-[var(--foreground)]">
                employee
              </label>
              <div className="mt-1">
                <select
                  id="employeeId"
                  value={filters.employeeId}
                  onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                  disabled={isFilterLoading}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">all employees</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isFilterLoading ? (
        <div className="mt-8 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : !reportData || !reportData.summary || reportData.employeeSummaries.length === 0 ? (
        <div className="mt-8 text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-semibold text-[var(--foreground)]">no data available</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {filters.startDate === filters.endDate
              ? `no shifts were found for ${format(new Date(filters.startDate), 'MMMM d, yyyy').toLowerCase()}.`
              : `no shifts were found between ${format(new Date(filters.startDate), 'MMMM d, yyyy').toLowerCase()} and ${format(new Date(filters.endDate), 'MMMM d, yyyy').toLowerCase()}.`}
            {filters.employeeId && ' for the selected employee.'}
          </p>
          <div className="mt-6">
            <Link
              href="/shifts/new"
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              add a shift
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white/50 dark:bg-gray-800/50 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-indigo-500 p-2 sm:p-3">
                      <svg className="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4 sm:ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total shifts</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">{reportData.summary.totalShifts}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/50 dark:bg-gray-800/50 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-green-500 p-2 sm:p-3">
                      <svg className="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4 sm:ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total tips collected</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">
                         ${(reportData.summary.totalCashTips + reportData.summary.totalCreditTips).toFixed(2)}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/50 dark:bg-gray-800/50 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-yellow-500 p-2 sm:p-3">
                      <svg className="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4 sm:ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total tipouts paid</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">
                         ${(reportData.summary.totalBarTipoutPaid + reportData.summary.totalHostTipoutPaid + reportData.summary.totalSaTipoutPaid).toFixed(2)}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/50 dark:bg-gray-800/50 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-purple-500 p-2 sm:p-3">
                      <svg className="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4 sm:ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total hours</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">{reportData.summary.totalHours.toFixed(1)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <div className="flex items-center mb-4 gap-2">
              <h2 className="text-xl font-semibold text-[var(--foreground)] mb-0">employee breakdown</h2>
              <span className="text-sm text-gray-700 dark:text-gray-300 ml-4">by role</span>
              <button
                type="button"
                onClick={() => setGroupByEmployee(g => !g)}
                className={
                  (groupByEmployee
                    ? 'bg-indigo-600'
                    : 'bg-gray-200 dark:bg-gray-700') +
                  ' relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2'
                }
                aria-pressed={groupByEmployee}
                aria-label="Toggle between grouping by employee or by role"
              >
                <span
                  aria-hidden="true"
                  className={
                    (groupByEmployee
                      ? 'translate-x-5'
                      : 'translate-x-0') +
                    ' pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                  }
                />
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">by employee</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2" title="When grouped by employee, all roles and payroll are summed for each person.">
                {groupByEmployee ? 'All roles and payroll are summed for each employee.' : 'Each row is a unique employee/role combination.'}
              </span>
            </div>
            {/* Mobile card view */}
            <div className="block md:hidden space-y-4">
              {displayedEmployeeSummaries.map((summary) => (
                <div
                  key={`${summary.employeeId}-${groupByEmployee ? 'all' : summary.roleName}-mobile`}
                  className="bg-white/50 dark:bg-gray-800/50 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => {
                    const params = new URLSearchParams({
                      employeeId: summary.employeeId,
                      ...(groupByEmployee ? {} : { role: summary.roleName }),
                      startDate: filters.startDate,
                      endDate: isDateRange ? filters.endDate : filters.startDate,
                    })
                    window.location.href = `/shifts?${params.toString()}`
                  }}
                >
                  {/* Header Section */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-grow">
                      <h3 className="text-base font-medium text-[var(--foreground)]">{summary.employeeName}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{groupByEmployee ? 'All Roles' : summary.roleName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        ${(summary.totalTipsPerHour + summary.basePayRate).toFixed(2)}/hr
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {summary.totalHours.toFixed(2)} hours
                      </p>
                    </div>
                  </div>
                  {/* Tips Section */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">cash tips</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${summary.totalCashTips.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">credit tips</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${summary.totalCreditTips.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">liquor sales</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${summary.totalLiquorSales.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  {/* Tipouts Section */}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">tipouts</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">bar</p>
                        <p className={`text-sm font-medium ${
                          summary.totalBarTipout !== 0 
                            ? (summary.totalBarTipout < 0 
                                ? 'text-red-600 dark:text-red-400' 
                                : 'text-green-600 dark:text-green-400')
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          ${summary.totalBarTipout.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">host</p>
                        <p className={`text-sm font-medium ${
                          summary.totalHostTipout !== 0 
                            ? (summary.totalHostTipout < 0 
                                ? 'text-red-600 dark:text-red-400' 
                                : 'text-green-600 dark:text-green-400')
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          ${summary.totalHostTipout.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">sa</p>
                        <p className={`text-sm font-medium ${
                          summary.totalSaTipout !== 0 
                            ? (summary.totalSaTipout < 0 
                                ? 'text-red-600 dark:text-red-400' 
                                : 'text-green-600 dark:text-green-400')
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          ${summary.totalSaTipout.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Rates Section */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">tips/hour</p>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          ${summary.totalTipsPerHour.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">base rate</p>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          ${summary.basePayRate.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">total/hour</p>
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">
                          ${(summary.totalTipsPerHour + summary.basePayRate).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">payroll total</p>
                        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          ${summary.payrollTotal?.toFixed(2) ?? 'n/a'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table view */}
            <div className="hidden md:block overflow-hidden bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full align-middle">
                  <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <thead className="bg-gray-50/75 dark:bg-gray-800/75">
                      <tr>
                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">
                          employee
                        </th>
                        {/* Only show role column if not grouping by employee */}
                        {!groupByEmployee && (
                          <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                            role
                          </th>
                        )}
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          hours
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          cash tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          credit tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          liquor sales
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          bar tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          host tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          sa tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                          title="Total credit tips received by this employee/role after any applicable tipouts paid into pools (Host, SA, Bar). Note: This might differ from raw Credit Tips collected."
                        >
                          payroll tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                          title="For pooled roles (Bartender, Host, SA), this reflects the average earnings per hour from the pool(s). For non-pooled roles (Server), reflects individual cash + calculated payroll tips per hour."
                        >
                          total tips/hour
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          base pay rate
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          total $/hour
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                          title="Calculated as (Base Pay Rate * Hours) + Payroll Tips."
                        >
                          payroll total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white/50 dark:bg-gray-800/50 divide-y divide-gray-200 dark:divide-gray-700">
                      {displayedEmployeeSummaries.map((summary) => (
                        <tr 
                          key={`${summary.employeeId}-${groupByEmployee ? 'all' : summary.roleName}`}
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          onClick={() => {
                            const params = new URLSearchParams({
                              employeeId: summary.employeeId,
                              ...(groupByEmployee ? {} : { role: summary.roleName }),
                              startDate: filters.startDate,
                              endDate: isDateRange ? filters.endDate : filters.startDate,
                            })
                            window.location.href = `/shifts?${params.toString()}`
                          }}
                        >
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[var(--foreground)] sm:pl-6">
                            {summary.employeeName}
                          </td>
                          {/* Only show role cell if not grouping by employee */}
                          {!groupByEmployee && (
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                              {summary.roleName}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {summary.totalHours.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalCashTips.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalCreditTips.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalLiquorSales.toFixed(2)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-4 text-sm ${
                            summary.totalBarTipout !== 0 
                              ? (summary.totalBarTipout < 0 
                                  ? 'text-red-600 dark:text-red-400' 
                                  : 'text-green-600 dark:text-green-400')
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            ${summary.totalBarTipout.toFixed(2)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-4 text-sm ${
                            summary.totalHostTipout !== 0 
                              ? (summary.totalHostTipout < 0 
                                  ? 'text-red-600 dark:text-red-400' 
                                  : 'text-green-600 dark:text-green-400')
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            ${summary.totalHostTipout.toFixed(2)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-4 text-sm ${
                            summary.totalSaTipout !== 0 
                              ? (summary.totalSaTipout < 0 
                                  ? 'text-red-600 dark:text-red-400' 
                                  : 'text-green-600 dark:text-green-400')
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            ${summary.totalSaTipout.toFixed(2)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-4 text-sm ${
                            summary.totalPayrollTips !== undefined 
                              ? (summary.totalPayrollTips !== 0 
                                  ? (summary.totalPayrollTips < 0 
                                      ? 'text-red-600 dark:text-red-400' 
                                      : 'text-green-600 dark:text-green-400')
                                  : 'text-gray-500 dark:text-gray-400')
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            ${summary.totalPayrollTips !== undefined ? summary.totalPayrollTips.toFixed(2) : 'n/a'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalTipsPerHour.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.basePayRate.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-green-600 dark:text-green-400">
                            ${(summary.totalTipsPerHour + summary.basePayRate).toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-blue-600 dark:text-blue-400">
                            ${summary.payrollTotal?.toFixed(2) ?? 'n/a'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 mb-8">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">visualization & analytics</h2>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-breakdown" title="where tips go">
                  <TipoutBreakdownChart summary={reportData.summary} />
                </FullscreenChart>
              </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-per-hour" title="earnings per hour by role">
                  <TipoutPerHourChart summaries={reportData.employeeSummaries} />
                </FullscreenChart>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-rates" title="tipout rates by role">
                  <TipoutRatesChart summaries={reportData.employeeSummaries} />
                </FullscreenChart>
              </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-contribution" title="tipout flow by employee">
                  <TipoutContributionChart summaries={reportData.employeeSummaries} />
                </FullscreenChart>
              </div>
            </div>
          </div>

          {/* Render the fullscreen modal */}
          <FullscreenModal />
        </>
      )}
    </div>
  )
}

// Main page component
export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ReportsContent />
    </Suspense>
  )
}