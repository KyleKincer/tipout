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
import { calculateTipouts, roleReceivesTipoutType, rolePaysTipoutType, getRoleDistributionGroup } from '@/utils/tipoutCalculations'

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

type Employee = {
  id: string
  name: string
}

type RoleConfig = {
  id: string
  tipoutType: string    // 'bar', 'host', 'sa', etc.
  percentageRate: number
  effectiveFrom: string
  effectiveTo: string | null
  receivesTipout?: boolean  // Whether this role receives tipout of this type
  paysTipout?: boolean      // Whether this role pays tipout of this type
  distributionGroup?: string // For pooling tipouts (e.g., 'bartenders', 'hosts')
}

type Shift = {
  id: string
  date: string
  employee: Employee
  role: {
    name: string
    basePayRate: number
    configs: RoleConfig[]
  }
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

type ReportSummary = {
  totalShifts: number
  totalHours: number
  totalCashTips: number
  totalCreditTips: number
  totalLiquorSales: number
  totalBarTipout: number
  totalHostTipout: number
  totalSaTipout: number
  barTipsPerHour: number
  serverTipsPerHour: number
  barCashTipsPerHour: number
  barCreditTipsPerHour: number
  serverCashTipsPerHour: number
  serverCreditTipsPerHour: number
}

type EmployeeRoleSummary = {
  employeeId: string
  employeeName: string
  roleName: string
  totalHours: number
  totalCashTips: number
  totalCreditTips: number
  totalBarTipout: number
  totalHostTipout: number
  totalSaTipout: number
  cashTipsPerHour: number
  creditTipsPerHour: number
  totalTipsPerHour: number
  basePayRate: number
  totalPayrollTips?: number  // For debugging
  totalLiquorSales: number   // Added liquor sales
  payrollTotal?: number      // Calculated total payroll amount
}

// Create a new client component for the reports content
function ReportsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFilterLoading, setIsFilterLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDateRange, setIsDateRange] = useState(false)
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null)
  const [filters, setFilters] = useState(() => {
    return {
      startDate: searchParams.get('startDate') || format(new Date(), 'yyyy-MM-dd'),
      endDate: searchParams.get('endDate') || format(new Date(), 'yyyy-MM-dd'),
      employeeId: searchParams.get('employeeId') || '',
    }
  })

  // Update filters when search params change
  useEffect(() => {
    setFilters({
      startDate: searchParams.get('startDate') || format(new Date(), 'yyyy-MM-dd'),
      endDate: searchParams.get('endDate') || format(new Date(), 'yyyy-MM-dd'),
      employeeId: searchParams.get('employeeId') || '',
    })
  }, [searchParams])

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)
    if (filters.employeeId) params.set('employeeId', filters.employeeId)

    const newUrl = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`
    router.push(newUrl)
  }, [filters, pathname, router])

  const fetchShifts = useCallback(async () => {
    try {
      setIsFilterLoading(true)
      const queryParams = new URLSearchParams({
        startDate: filters.startDate,
        endDate: isDateRange ? filters.endDate : filters.startDate,
        ...(filters.employeeId && { employeeId: filters.employeeId }),
      })

      const response = await fetch(`/api/shifts?${queryParams}`)
      if (!response.ok) {
        throw new Error('Failed to fetch shifts')
      }
      const data = await response.json()
      setShifts(data)
    } catch (err) {
      setError('Failed to load shifts')
      console.error('Error loading shifts:', err)
    } finally {
      setIsLoading(false)
      setIsFilterLoading(false)
    }
  }, [filters, isDateRange])

  useEffect(() => {
    fetchEmployees()
  }, [])

  useEffect(() => {
    fetchShifts()
  }, [fetchShifts])

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees')
      if (!response.ok) {
        throw new Error('Failed to fetch employees')
      }
      const data = await response.json()
      setEmployees(data)
    } catch (err) {
      setError('Failed to load employees')
      console.error('Error loading employees:', err)
    }
  }

  const calculateSummary = (): ReportSummary => {
    const summary: ReportSummary = {
      totalShifts: 0,
      totalHours: 0,
      totalCashTips: 0,
      totalCreditTips: 0,
      totalLiquorSales: 0,
      totalBarTipout: 0,
      totalHostTipout: 0,
      totalSaTipout: 0,
      barTipsPerHour: 0,
      serverTipsPerHour: 0,
      barCashTipsPerHour: 0,
      barCreditTipsPerHour: 0,
      serverCashTipsPerHour: 0,
      serverCreditTipsPerHour: 0,
    }

    // Process all shifts for basic totals
    shifts.forEach(shift => {
      summary.totalShifts += 1
      summary.totalHours += Number(shift.hours)
      summary.totalCashTips += Number(shift.cashTips)
      summary.totalCreditTips += Number(shift.creditTips)
      summary.totalLiquorSales += Number(shift.liquorSales)
    })

    // Check if there's at least one of each role type
    const hasBar = shifts.some(shift => roleReceivesTipoutType(shift, 'bar'))
    const hasHost = shifts.some(shift => roleReceivesTipoutType(shift, 'host'))
    const hasSA = shifts.some(shift => roleReceivesTipoutType(shift, 'sa'))

    // Calculate total tipouts
    const allTipouts = shifts.map(shift => {
      return calculateTipouts(shift, hasHost, hasSA, hasBar)
    })

    summary.totalBarTipout = allTipouts.reduce((sum, { barTipout }) => sum + barTipout, 0)
    summary.totalHostTipout = allTipouts.reduce((sum, { hostTipout }) => sum + hostTipout, 0)
    summary.totalSaTipout = allTipouts.reduce((sum, { saTipout }) => sum + saTipout, 0)
    
    // Get shifts by role category using configurations
    const barShifts = shifts.filter(shift => roleReceivesTipoutType(shift, 'bar'))
    const serverShifts = shifts.filter(shift => {
      // Servers typically pay tipouts but don't receive any
      const paysTipout = shift.role.configs.some(config => config.paysTipout !== false)
      const receivesTipout = shift.role.configs.some(config => config.receivesTipout)
      return paysTipout && !receivesTipout
    })

    const barHours = barShifts.reduce((acc, shift) => acc + Number(shift.hours), 0)
    const serverHours = serverShifts.reduce((acc, shift) => acc + Number(shift.hours), 0)

    // Calculate bar tips
    const barCashTips = barShifts.reduce((acc, shift) => acc + Number(shift.cashTips), 0)
    const barCreditTips = barShifts.reduce((acc, shift) => acc + Number(shift.creditTips), 0)
    
    // Calculate server tips
    const serverCashTips = serverShifts.reduce((acc, shift) => acc + Number(shift.cashTips), 0)
    const serverCreditTips = serverShifts.reduce((acc, shift) => acc + Number(shift.creditTips), 0)

    // Server tipouts breakdown
    
    const serverHostAndSATipouts = serverShifts.reduce((sum, shift) => {
      const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
      return sum + hostTipout + saTipout
    }, 0)
    
    // Spreadsheet calculation for server credit tips per hour:
    // (total server credit tips - host/SA tipouts) / total server hours
    const serverCreditTipsPerHour = serverHours > 0 ? 
      (serverCreditTips - serverHostAndSATipouts) / serverHours : 0
      
    // Total server payroll tips (excluding individual bar tipouts)
    const serverPayrollTips = serverCreditTips - serverHostAndSATipouts
    
    // Total bartender payroll tips = credit tips - tipout to hosts/SA + bar tipout received
    const barPayrollTips = barCreditTips - 
      barShifts.reduce((acc, shift) => {
        const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        return acc + hostTipout + saTipout
      }, 0) + 
      summary.totalBarTipout

    // Calculate per-hour rates
    summary.barCashTipsPerHour = barHours > 0 ? barCashTips / barHours : 0
    summary.barCreditTipsPerHour = barHours > 0 ? barPayrollTips / barHours : 0
    summary.barTipsPerHour = barHours > 0 ? (barCashTips + barPayrollTips) / barHours : 0

    summary.serverCashTipsPerHour = serverHours > 0 ? serverCashTips / serverHours : 0
    summary.serverCreditTipsPerHour = serverCreditTipsPerHour
    summary.serverTipsPerHour = serverHours > 0 ? 
      (serverCashTips + serverPayrollTips) / serverHours : 0

    return summary
  }

  const calculateEmployeeRoleSummaries = (): EmployeeRoleSummary[] => {
    const summaries = new Map<string, EmployeeRoleSummary>()
    
    // Group shifts by date to determine if hosts/SAs worked each day

    // Check if there's at least one host and SA
    const hasHost = shifts.some(shift => roleReceivesTipoutType(shift, 'host'))
    const hasSA = shifts.some(shift => roleReceivesTipoutType(shift, 'sa'))
    const hasBar = shifts.some(shift => roleReceivesTipoutType(shift, 'bar'))

    // Calculate total tipouts across all dates
    const totalBarTipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'bar')) {
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        return sum + barTipout
      }
      return sum
    }, 0)

    const totalHostTipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'host')) {
        const { hostTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        return sum + hostTipout
      }
      return sum
    }, 0)

    const totalSATipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'sa')) {
        const { saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        return sum + saTipout
      }
      return sum
    }, 0)

    // Determine which roles receive which tipouts
    const roleGroups = new Map<string, Shift[]>()
    
    // Group shifts by role distribution group
    shifts.forEach(shift => {
      shift.role.configs.forEach(config => {
        if (config.receivesTipout && config.distributionGroup) {
          if (!roleGroups.has(config.distributionGroup)) {
            roleGroups.set(config.distributionGroup, [])
          }
          roleGroups.get(config.distributionGroup)?.push(shift)
        }
      })
    })

    // Calculate hours by distribution group for pool distribution
    const distributionGroupHours = new Map<string, number>()
    
    Array.from(roleGroups.entries()).forEach(([group, groupShifts]) => {
      const totalHours = groupShifts.reduce((sum, s) => sum + Number(s.hours), 0)
      distributionGroupHours.set(group, totalHours)
    })

    // Group shifts by role for per-hour calculations
    const serverShifts = shifts.filter(shift => {
      // Servers typically pay tipouts but don't receive them
      return rolePaysTipoutType(shift, 'bar') && 
            !roleReceivesTipoutType(shift, 'bar') && 
            !roleReceivesTipoutType(shift, 'host') && 
            !roleReceivesTipoutType(shift, 'sa')
    })
    const bartenderShifts = shifts.filter(shift => roleReceivesTipoutType(shift, 'bar'))
    
    // Calculate total hours by role
    const serverHours = serverShifts.reduce((sum, shift) => sum + Number(shift.hours), 0)
    const bartenderHours = bartenderShifts.reduce((sum, shift) => sum + Number(shift.hours), 0)
    
    // Calculate server cash tips per hour rate 
    const serverCashTipsTotal = serverShifts.reduce((sum, shift) => sum + Number(shift.cashTips), 0)
    const serverCashTipsPerHour = serverHours > 0 ? serverCashTipsTotal / serverHours : 0
    
    // Calculate server credit tips per hour rate - following spreadsheet formula
    const serverCreditTipsTotal = serverShifts.reduce((sum, shift) => sum + Number(shift.creditTips), 0)
    const serverHostSATipoutsTotal = serverShifts.reduce((sum, shift) => {
      const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
      return sum + hostTipout + saTipout
    }, 0)
    const serverCreditTipsPerHour = serverHours > 0 ? 
      (serverCreditTipsTotal - serverHostSATipoutsTotal) / serverHours : 0
      
    // Calculate bartender cash tips per hour rate
    const bartenderCashTipsTotal = bartenderShifts.reduce((sum, shift) => sum + Number(shift.cashTips), 0)
    const bartenderCashTipsPerHour = bartenderHours > 0 ? bartenderCashTipsTotal / bartenderHours : 0
    
    // Calculate bartender credit tips per hour rate
    const bartenderCreditTipsTotal = bartenderShifts.reduce((sum, shift) => sum + Number(shift.creditTips), 0)
    const bartenderTipoutsTotal = bartenderShifts.reduce((sum, shift) => {
      const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
      return sum + hostTipout + saTipout
    }, 0)
    const bartenderCreditTipsPerHour = bartenderHours > 0 ? 
      (bartenderCreditTipsTotal - bartenderTipoutsTotal + totalBarTipout) / bartenderHours : 0

    // Process all shifts
    shifts.forEach(shift => {
      const key = `${shift.employee.id}-${shift.role.name}`
      const existing = summaries.get(key) || {
        employeeId: shift.employee.id,
        employeeName: shift.employee.name,
        roleName: shift.role.name,
        totalHours: 0,
        totalCashTips: 0,
        totalCreditTips: 0,
        totalBarTipout: 0,
        totalHostTipout: 0,
        totalSaTipout: 0,
        cashTipsPerHour: 0,
        creditTipsPerHour: 0,
        totalTipsPerHour: 0,
        basePayRate: Number(shift.role.basePayRate),
        totalLiquorSales: 0,
      }

      existing.totalHours += Number(shift.hours)
      existing.totalCashTips += Number(shift.cashTips)
      existing.totalCreditTips += Number(shift.creditTips)
      existing.totalLiquorSales = (existing.totalLiquorSales || 0) + Number(shift.liquorSales) // Accumulate liquor sales
      
      // Calculate tipouts this role pays
      if (rolePaysTipoutType(shift, 'bar') && !roleReceivesTipoutType(shift, 'bar')) {
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        existing.totalBarTipout -= barTipout
      }
      
      if (rolePaysTipoutType(shift, 'host') && !roleReceivesTipoutType(shift, 'host')) {
        const { hostTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        existing.totalHostTipout -= hostTipout
      }
      
      if (rolePaysTipoutType(shift, 'sa') && !roleReceivesTipoutType(shift, 'sa')) {
        const { saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        existing.totalSaTipout -= saTipout
      }
      
      // Calculate tipouts this role receives
      if (roleReceivesTipoutType(shift, 'bar')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'bar')
        
        if (distributionGroup) {
          // This role shares the bar tipout pool based on their distribution group
          const groupHours = distributionGroupHours.get(distributionGroup) || 0
          if (groupHours > 0) {
            const share = Number(shift.hours) / groupHours
            existing.totalBarTipout += share * totalBarTipout
          }
        }
        
        // For bartenders, calculate the normalized rate for distribution
        if (bartenderShifts.some(s => s.id === shift.id)) {
          existing.cashTipsPerHour = bartenderCashTipsPerHour
          existing.creditTipsPerHour = bartenderCreditTipsPerHour
        }
      }
      
      if (roleReceivesTipoutType(shift, 'host')) {
        console.log(`Host role detected for ${shift.employee.name}: role=${shift.role.name}, totalHostTipout=${existing.totalHostTipout}, hostTipoutPool=${totalHostTipout}`);
        
        const distributionGroup = getRoleDistributionGroup(shift, 'host')
        
        if (distributionGroup) {
          // This role shares the host tipout pool based on their distribution group
          const groupHours = distributionGroupHours.get(distributionGroup) || 0
          if (groupHours > 0) {
            const share = Number(shift.hours) / groupHours
            existing.totalHostTipout += share * totalHostTipout
            console.log(`  After distribution: totalHostTipout=${existing.totalHostTipout}, share=${share}, hours=${shift.hours}, groupHours=${groupHours}`);
          }
        }
        
        // Hosts don't generally have cash or credit tips directly
        existing.totalCashTips = 0
        existing.totalCreditTips = 0
        
        // Set payroll tips for hosts to be their host tipout
        existing.totalPayrollTips = existing.totalHostTipout
        console.log(`  Final host payroll tips=${existing.totalPayrollTips}`);
      }
      
      if (roleReceivesTipoutType(shift, 'sa')) {
        console.log(`SA role detected for ${shift.employee.name}: role=${shift.role.name}, totalSATipout=${existing.totalSaTipout}, saTipoutPool=${totalSATipout}`);
        
        const distributionGroup = getRoleDistributionGroup(shift, 'sa')
        
        if (distributionGroup) {
          // This role shares the SA tipout pool based on their distribution group
          const groupHours = distributionGroupHours.get(distributionGroup) || 0
          if (groupHours > 0) {
            const share = Number(shift.hours) / groupHours
            existing.totalSaTipout += share * totalSATipout
            console.log(`  After distribution: totalSATipout=${existing.totalSaTipout}, share=${share}, hours=${shift.hours}, groupHours=${groupHours}`);
          }
        }
        
        // SAs don't generally have cash or credit tips directly
        existing.totalCashTips = 0
        existing.totalCreditTips = 0
        
        // Set payroll tips for SAs to be their SA tipout
        existing.totalPayrollTips = existing.totalSaTipout
        console.log(`  Final SA payroll tips=${existing.totalPayrollTips}`);
      }
      
      // For servers, calculate their cash and credit tips per hour
      if (serverShifts.some(s => s.id === shift.id)) {
        existing.cashTipsPerHour = serverCashTipsPerHour
        
        // Calculate credit/payroll tips based on hours worked minus individual bar tipout
        // This matches the spreadsheet formula: (server credit/HR * hours) - bar tipout
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)
        const payrollTips = (serverCreditTipsPerHour * existing.totalHours) - barTipout
        existing.totalPayrollTips = payrollTips  // Store for debugging
        existing.creditTipsPerHour = existing.totalHours > 0 ? payrollTips / existing.totalHours : 0
      }
      
      // For bartenders, set their cash and credit tips per hour
      if (bartenderShifts.some(s => s.id === shift.id)) {
        existing.cashTipsPerHour = bartenderCashTipsPerHour
        existing.creditTipsPerHour = bartenderCreditTipsPerHour
        existing.totalPayrollTips = bartenderCreditTipsPerHour * existing.totalHours
      }
      
      // Calculate total tips per hour (excluding base pay rate)
      const totalTips = existing.totalCashTips + existing.totalCreditTips + 
                       existing.totalBarTipout + existing.totalHostTipout + 
                       existing.totalSaTipout
      
      // For servers and bartenders, use their calculated per-hour rates
      if (serverShifts.some(s => s.id === shift.id) || bartenderShifts.some(s => s.id === shift.id)) {
        existing.totalTipsPerHour = existing.cashTipsPerHour + existing.creditTipsPerHour
      } else {
        // For other roles (hosts, SAs), calculate based on total tipouts
        existing.totalTipsPerHour = existing.totalHours > 0 ? 
          totalTips / existing.totalHours : 0
      }
      
      // Calculate payroll total
      existing.payrollTotal = (existing.basePayRate * existing.totalHours) + (existing.totalPayrollTips ?? 0)
      
      summaries.set(key, existing)
    })

    // Apply role-based hourly normalization within distribution groups
    const summariesArray = Array.from(summaries.values())
    
    // Group summaries by distribution group for normalization
    const distributionGroups = new Map<string, EmployeeRoleSummary[]>()
    
    Array.from(roleGroups.keys()).forEach(group => {
      // Find all employees who are part of this distribution group
      const groupSummaries = summariesArray.filter(summary => {
        const shift = shifts.find(s => 
          s.employee.id === summary.employeeId && 
          s.role.name === summary.roleName
        )
        
        if (!shift) return false
        
        return shift.role.configs.some(config => 
          config.distributionGroup === group && config.receivesTipout
        )
      })
      
      if (groupSummaries.length > 0) {
        distributionGroups.set(group, groupSummaries)
      }
    })
    
    // Normalize hourly rates within each distribution group
    distributionGroups.forEach((groupSummaries) => {
      // Skip groups with only one member - no need to normalize
      if (groupSummaries.length <= 1) return
      
      // Calculate total tips and hours for the group
      const totalGroupTips = groupSummaries.reduce((sum, s) => {
        return sum + s.totalCashTips + s.totalCreditTips + 
               s.totalBarTipout + s.totalHostTipout + s.totalSaTipout
      }, 0)
      
      const totalGroupHours = groupSummaries.reduce((sum, s) => sum + s.totalHours, 0)
      
      // Calculate the normalized hourly rate for this group
      const normalizedHourlyRate = totalGroupHours > 0 ? totalGroupTips / totalGroupHours : 0
      
      // Apply the normalized rate to all members
      groupSummaries.forEach(summary => {
        const key = `${summary.employeeId}-${summary.roleName}`
        const entry = summaries.get(key)
        
        if (entry) {
          entry.totalTipsPerHour = normalizedHourlyRate
          summaries.set(key, entry)
        }
      })
    })

    return Array.from(summaries.values())
  }

  // TipoutBreakdownChart
  const TipoutBreakdownChart = () => {
    const data = {
      labels: ['Server Tips', 'Bar Tipout', 'Host Tipout'],
      datasets: [
        {
          label: 'Tip Distribution',
          data: [
            summary.totalCashTips + summary.totalCreditTips - 
            (summary.totalBarTipout + summary.totalHostTipout),
            summary.totalBarTipout,
            summary.totalHostTipout,
          ],
          backgroundColor: [
            'rgba(54, 162, 235, 0.7)',  // Blue for server tips
            'rgba(255, 99, 132, 0.7)',  // Red for bar tipout
            'rgba(255, 206, 86, 0.7)',  // Yellow for host tipout
          ],
          borderColor: [
            'rgba(54, 162, 235, 1)',
            'rgba(255, 99, 132, 1)',
            'rgba(255, 206, 86, 1)',
          ],
          borderWidth: 1,
        },
      ],
    }

    return (
      <div className="h-full">
        <div className="h-full flex justify-center">
          <div className="w-full max-w-lg">
          <Doughnut
            data={data}
            options={{
              responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.5,
              plugins: {
                legend: {
                  position: 'right',
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
                      const total = context.dataset.data.reduce((a, b) => (a as number) + (b as number), 0) as number;
                      const percentage = Math.round((value / total) * 100);
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

  // TipoutPerHourChart
  const TipoutPerHourChart = () => {
    // Filter by roles that actually have data
    const roleData = employeeRoleSummaries.reduce((acc, summary) => {
      if (!acc[summary.roleName]) {
        acc[summary.roleName] = {
          count: 0,
          totalTipsPerHour: 0,
          cashTipsPerHour: 0,
          creditTipsPerHour: 0,
          basePayRate: 0,
        }
      }
      acc[summary.roleName].count += 1
      acc[summary.roleName].totalTipsPerHour += summary.totalTipsPerHour
      acc[summary.roleName].cashTipsPerHour += summary.cashTipsPerHour
      acc[summary.roleName].creditTipsPerHour += summary.creditTipsPerHour
      acc[summary.roleName].basePayRate += summary.basePayRate
      return acc
    }, {} as Record<string, { count: number, totalTipsPerHour: number, cashTipsPerHour: number, creditTipsPerHour: number, basePayRate: number }>)

    const roles = Object.keys(roleData)
    const averages = roles.map(role => ({
      role,
      totalTipsPerHour: roleData[role].totalTipsPerHour / roleData[role].count,
      cashTipsPerHour: roleData[role].cashTipsPerHour / roleData[role].count,
      creditTipsPerHour: roleData[role].creditTipsPerHour / roleData[role].count,
      basePayRate: roleData[role].basePayRate / roleData[role].count,
      totalEarningsPerHour: (roleData[role].totalTipsPerHour / roleData[role].count) + (roleData[role].basePayRate / roleData[role].count)
    }))

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
          label: 'Credit Tips/Hour',
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

  // TipoutContributionChart
  const TipoutContributionChart = () => {
    // Group tipout data by employee
    const employeeTipouts = employeeRoleSummaries.reduce((acc, summary) => {
      if (!acc[summary.employeeName]) {
        acc[summary.employeeName] = {
          paid: 0,
          received: 0
        };
      }
      
      console.log(`Tipout calculation for ${summary.employeeName} (${summary.roleName}):`);
      console.log(`  Bar tipout: ${summary.totalBarTipout}`);
      console.log(`  Host tipout: ${summary.totalHostTipout}`);
      console.log(`  SA tipout: ${summary.totalSaTipout}`);
      
      // Calculate tipouts paid vs. received for each tipout type
      // Negative tipout values mean paying into pool
      if (summary.totalBarTipout < 0) {
        acc[summary.employeeName].paid += Math.abs(summary.totalBarTipout);
        console.log(`  Paid bar tipout: ${Math.abs(summary.totalBarTipout)}`);
      } else if (summary.totalBarTipout > 0) {
        acc[summary.employeeName].received += summary.totalBarTipout;
        console.log(`  Received bar tipout: ${summary.totalBarTipout}`);
      }
      
      if (summary.totalHostTipout < 0) {
        acc[summary.employeeName].paid += Math.abs(summary.totalHostTipout);
        console.log(`  Paid host tipout: ${Math.abs(summary.totalHostTipout)}`);
      } else if (summary.totalHostTipout > 0) {
        acc[summary.employeeName].received += summary.totalHostTipout;
        console.log(`  Received host tipout: ${summary.totalHostTipout}`);
      }
      
      if (summary.totalSaTipout < 0) {
        acc[summary.employeeName].paid += Math.abs(summary.totalSaTipout);
        console.log(`  Paid SA tipout: ${Math.abs(summary.totalSaTipout)}`);
      } else if (summary.totalSaTipout > 0) {
        acc[summary.employeeName].received += summary.totalSaTipout;
        console.log(`  Received SA tipout: ${summary.totalSaTipout}`);
      }
      
      console.log(`  Total paid: ${acc[summary.employeeName].paid}`);
      console.log(`  Total received: ${acc[summary.employeeName].received}`);
      
      return acc;
    }, {} as Record<string, { paid: number, received: number }>);
    
    const employees = Object.keys(employeeTipouts);
    
    // Sort employees by combined tipout activity (paid + received, descending)
    employees.sort((a, b) => {
      const totalA = employeeTipouts[a].paid + employeeTipouts[a].received;
      const totalB = employeeTipouts[b].paid + employeeTipouts[b].received;
      return totalB - totalA;
    });
    
    // Only include employees with significant tipout activity
    const significantEmployees = employees.filter(emp => 
      employeeTipouts[emp].paid > 0 || employeeTipouts[emp].received > 0
    ).slice(0, 10); // Limit to top 10 for readability

    const data = {
      labels: significantEmployees,
      datasets: [
        {
          label: 'Tipout Paid Into Pool',
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
              indexAxis: 'y',
              scales: {
                x: {
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

  // TipoutRatesChart
  const TipoutRatesChart = () => {
    // Find unique roles with tipout configurations
    const uniqueRoles = new Set<string>();
    const roleConfigs: Record<string, Record<string, number>> = {};
    
    shifts.forEach(shift => {
      const roleName = shift.role.name;
      if (!uniqueRoles.has(roleName)) {
        uniqueRoles.add(roleName);
        roleConfigs[roleName] = {};
        
        shift.role.configs.forEach(config => {
          // Only show rates for roles that pay tipouts (not receive)
          if (config.paysTipout !== false) {
            roleConfigs[roleName][config.tipoutType] = config.percentageRate;
          }
        });
      }
    });

    const roles = Array.from(uniqueRoles);
    // Filter to only roles that pay tipouts
    const rolesThatPayTipout = roles.filter(role => 
      Object.keys(roleConfigs[role]).length > 0
    );
    
    if (rolesThatPayTipout.length === 0) {
      return null;
    }

    const tipoutTypes = ['bar', 'host', 'sa'];
    const datasets = tipoutTypes.map((type, index) => {
      const colors = [
        'rgba(255, 99, 132, 0.7)',  // Red for bar
        'rgba(255, 206, 86, 0.7)',  // Yellow for host
        'rgba(75, 192, 192, 0.7)',   // Teal for SA
      ];
      
      const borderColors = [
        'rgba(255, 99, 132, 1)',
        'rgba(255, 206, 86, 1)',
        'rgba(75, 192, 192, 1)',
      ];
      
      return {
        label: `${type.charAt(0).toUpperCase() + type.slice(1)} Tipout %`,
        data: rolesThatPayTipout.map(role => roleConfigs[role][type] || 0),
        backgroundColor: colors[index],
        borderColor: borderColors[index],
        borderWidth: 1,
      };
    });

    const data = {
      labels: rolesThatPayTipout,
      datasets: datasets,
    };

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
                    text: 'Percentage (%)',
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
                      return `${context.dataset.label}: ${context.parsed.y}%`;
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

  // Add a function to get enhanced chart options for fullscreen mode
  const getFullscreenChartOptions = (chartId: string) => {
    // Common fullscreen enhancements
    const common = {
      responsive: true,
      maintainAspectRatio: true,
      animation: {
        duration: 500
      },
      plugins: {
        legend: {
          labels: {
            font: {
              size: 14
            },
            padding: 20,
            color: '#ffffff',
          }
        },
        tooltip: {
          bodyFont: {
            size: 14
          },
          titleFont: {
            size: 16
          },
          padding: 15,
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
        }
      }
    };

    // Chart-specific enhancements
    switch (chartId) {
      case 'tipout-breakdown':
        return {
          ...common,
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1, // Use a square aspect ratio in fullscreen
          plugins: {
            ...common.plugins,
            legend: {
              ...common.plugins.legend,
              position: 'right' as const,
              labels: {
                ...common.plugins.legend.labels,
                font: {
                  size: 16
                },
                boxWidth: 20,
                padding: 25,
              }
            }
          }
        };
      case 'tipout-per-hour':
      case 'tipout-rates':
        return {
          ...common,
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: {
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
              },
              ticks: {
                color: '#ffffff',
                font: {
                  size: 14
                }
              },
              title: {
                display: true,
                font: {
                  size: 16
                },
                color: '#ffffff',
              }
            },
            x: {
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
              },
              ticks: {
                color: '#ffffff',
                font: {
                  size: 14
                }
              }
            }
          }
        };
      case 'tipout-contribution':
        return {
          ...common,
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y' as const,
          scales: {
            x: {
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
              },
              ticks: {
                color: '#ffffff',
                font: {
                  size: 14
                }
              },
              title: {
                display: true,
                font: {
                  size: 16
                },
                color: '#ffffff',
              }
            },
            y: {
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
              },
              ticks: {
                color: '#ffffff',
                font: {
                  size: 14
                }
              }
            }
          }
        };
      default:
        return common;
    }
  };

  // Fullscreen chart component wrapper
  const FullscreenChart = ({ 
    id, 
    title, 
    children 
  }: { 
    id: string, 
    title: string, 
    children: React.ReactNode 
  }) => {
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
  const FullscreenModal = () => {
    // Add effect to handle keyboard events and focus management
    useEffect(() => {
      // Only run the effect logic if the modal is actually visible
      if (!fullscreenChart) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setFullscreenChart(null);
        }
      };

      // Add event listener
      document.addEventListener('keydown', handleKeyDown);

      // Focus management - store the active element and focus the modal
      const previousActiveElement = document.activeElement as HTMLElement;
      const modalContainer = document.getElementById('fullscreen-modal-container');
      if (modalContainer) modalContainer.focus();

      // Prevent scrolling on the body
      document.body.style.overflow = 'hidden';

      // Cleanup
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        // Restore focus to the previous element
        if (previousActiveElement) previousActiveElement.focus();
        // Restore scrolling
        document.body.style.overflow = '';
      };
    }, [fullscreenChart]); // Add fullscreenChart to dependency array

    if (!fullscreenChart) return null;

    // Get the fullscreen chart options
    const fullscreenOptions = getFullscreenChartOptions(fullscreenChart);

    const renderChartContent = () => {
      // Custom chart rendering for fullscreen view
      switch (fullscreenChart) {
        case 'tipout-breakdown': {
          const data = {
            labels: ['Server Tips', 'Bar Tipout', 'Host Tipout'],
            datasets: [
              {
                label: 'Tip Distribution',
                data: [
                  summary.totalCashTips + summary.totalCreditTips - 
                  (summary.totalBarTipout + summary.totalHostTipout),
                  summary.totalBarTipout,
                  summary.totalHostTipout,
                ],
                backgroundColor: [
                  'rgba(54, 162, 235, 0.7)',  // Blue for server tips
                  'rgba(255, 99, 132, 0.7)',  // Red for bar tipout
                  'rgba(255, 206, 86, 0.7)',  // Yellow for host tipout
                ],
                borderColor: [
                  'rgba(54, 162, 235, 1)',
                  'rgba(255, 99, 132, 1)',
                  'rgba(255, 206, 86, 1)',
                ],
                borderWidth: 1,
              }
            ]
          };
          
          return (
            <Doughnut 
              data={data} 
              options={{
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.2,
                plugins: {
                  legend: {
                    position: 'right',
                    labels: {
                      boxWidth: 20,
                      padding: 20,
                      color: '#ffffff',
                      font: {
                        size: 16
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
                        const total = context.dataset.data.reduce((a, b) => (a as number) + (b as number), 0) as number;
                        const percentage = Math.round((value / total) * 100);
                        return `${context.label}: $${value.toFixed(2)} (${percentage}%)`;
                      }
                    }
                  }
                }
              }}
            />
          );
        }
        case 'tipout-per-hour':
        case 'tipout-rates':
        case 'tipout-contribution': {
          // For other charts, use the original components
          // They will receive the full size from the container
          const Component = {
            'tipout-per-hour': TipoutPerHourChart,
            'tipout-rates': TipoutRatesChart,
            'tipout-contribution': TipoutContributionChart
          }[fullscreenChart];
          
          return <Component />;
        }
        default:
          return null;
      }
    };

    const getChartTitle = () => {
      switch (fullscreenChart) {
        case 'tipout-breakdown':
          return 'Where Tips Go';
        case 'tipout-per-hour':
          return 'Earnings Per Hour By Role';
        case 'tipout-rates':
          return 'Tipout Rates By Role';
        case 'tipout-contribution':
          return 'Tipout Flow By Employee';
        default:
          return '';
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
              <span className="text-sm text-gray-500 dark:text-gray-400">Press ESC to close</span>
              <button
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors"
                onClick={() => setFullscreenChart(null)}
                aria-label="Minimize chart"
                title="Exit fullscreen mode"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              </button>
              <button
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors"
                onClick={() => setFullscreenChart(null)}
                aria-label="Close"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
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

  if (isLoading) {
    return <LoadingSpinner />
  }

  const summary = calculateSummary()
  const employeeRoleSummaries = calculateEmployeeRoleSummaries()

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">reports</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            view and analyze tipout data.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/50 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-sm text-gray-700 dark:text-gray-300">single date</span>
            <button
              type="button"
              onClick={() => setIsDateRange(!isDateRange)}
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
      ) : shifts.length === 0 ? (
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
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">{summary.totalShifts}</dd>
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total tips</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">
                        ${(summary.totalCashTips + summary.totalCreditTips).toFixed(2)}
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">total tipouts</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">
                        ${(summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout).toFixed(2)}
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
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">{summary.totalHours.toFixed(1)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">detailed analysis</h2>
            <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">tips per hour summary</h3>
                <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 sm:divide-x sm:divide-gray-200 dark:sm:divide-gray-700">
                  <div className="sm:pr-8">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">bar</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">cash tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">credit tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">total tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                </div>
                  <div className="sm:pl-8">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">servers</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">cash tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">credit tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">total tips/hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">employee breakdown</h2>
            
            {/* Mobile card view */}
            <div className="block md:hidden space-y-4">
              {employeeRoleSummaries.map((summary) => (
                <div
                  key={`${summary.employeeId}-${summary.roleName}-mobile`}
                  className="bg-white/50 dark:bg-gray-800/50 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => {
                    const params = new URLSearchParams({
                      employeeId: summary.employeeId,
                      role: summary.roleName,
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
                      <p className="text-sm text-gray-500 dark:text-gray-400">{summary.roleName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        ${(summary.totalTipsPerHour + summary.basePayRate).toFixed(2)}/hr
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {summary.totalHours} hours
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
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          role
                        </th>
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
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          payroll tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          total tips/hour
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          base pay rate
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          total $/hour
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          payroll total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white/50 dark:bg-gray-800/50 divide-y divide-gray-200 dark:divide-gray-700">
                      {employeeRoleSummaries.map((summary) => (
                        <tr 
                          key={`${summary.employeeId}-${summary.roleName}`}
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          onClick={() => {
                            const params = new URLSearchParams({
                              employeeId: summary.employeeId,
                              role: summary.roleName,
                              startDate: filters.startDate,
                              endDate: isDateRange ? filters.endDate : filters.startDate,
                            })
                            window.location.href = `/shifts?${params.toString()}`
                          }}
                        >
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[var(--foreground)] sm:pl-6">
                            {summary.employeeName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {summary.roleName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {summary.totalHours}
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
                  <TipoutBreakdownChart />
                </FullscreenChart>
              </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-per-hour" title="earnings per hour by role">
                  <TipoutPerHourChart />
                </FullscreenChart>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-rates" title="tipout rates by role">
                  <TipoutRatesChart />
                </FullscreenChart>
              </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <FullscreenChart id="tipout-contribution" title="tipout flow by employee">
                  <TipoutContributionChart />
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