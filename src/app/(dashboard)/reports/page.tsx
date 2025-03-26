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

    // Calculate total tipouts
    const allTipouts = shifts.map(shift => {
      return calculateTipouts(shift, true, true)
    })

    summary.totalBarTipout = allTipouts.reduce((sum, { barTipout }) => sum + barTipout, 0)
    summary.totalHostTipout = allTipouts.reduce((sum, { hostTipout }) => sum + hostTipout, 0)
    summary.totalSaTipout = allTipouts.reduce((sum, { saTipout }) => sum + saTipout, 0)

    // Helper function to check if a role receives a specific tipout type
    const roleReceivesTipoutType = (shift: Shift, tipoutType: string): boolean => {
      return shift.role.configs.some(config => 
        config.tipoutType === tipoutType && config.receivesTipout
      )
    }
    
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
      const { hostTipout, saTipout } = calculateTipouts(shift, true, true)
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
        const { hostTipout, saTipout } = calculateTipouts(shift, true, true)
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

    // Calculate total tipouts across all dates
    const totalBarTipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'bar')) {
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA)
        return sum + barTipout
      }
      return sum
    }, 0)

    const totalHostTipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'host')) {
        const { hostTipout } = calculateTipouts(shift, hasHost, hasSA)
        return sum + hostTipout
      }
      return sum
    }, 0)

    const totalSATipout = shifts.reduce((sum, shift) => {
      if (rolePaysTipoutType(shift, 'sa')) {
        const { saTipout } = calculateTipouts(shift, hasHost, hasSA)
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
      const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA)
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
      const { hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA)
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
      }

      existing.totalHours += Number(shift.hours)
      existing.totalCashTips += Number(shift.cashTips)
      existing.totalCreditTips += Number(shift.creditTips)
      
      // Calculate tipouts this role pays
      if (rolePaysTipoutType(shift, 'bar') && !roleReceivesTipoutType(shift, 'bar')) {
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA)
        existing.totalBarTipout -= barTipout
      }
      
      if (rolePaysTipoutType(shift, 'host') && !roleReceivesTipoutType(shift, 'host')) {
        const { hostTipout } = calculateTipouts(shift, hasHost, hasSA)
        existing.totalHostTipout -= hostTipout
      }
      
      if (rolePaysTipoutType(shift, 'sa') && !roleReceivesTipoutType(shift, 'sa')) {
        const { saTipout } = calculateTipouts(shift, hasHost, hasSA)
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
        const distributionGroup = getRoleDistributionGroup(shift, 'host')
        
        if (distributionGroup) {
          // This role shares the host tipout pool based on their distribution group
          const groupHours = distributionGroupHours.get(distributionGroup) || 0
          if (groupHours > 0) {
            const share = Number(shift.hours) / groupHours
            existing.totalHostTipout += share * totalHostTipout
          }
        }
        
        // Hosts don't generally have cash or credit tips directly
        existing.totalCashTips = 0
        existing.totalCreditTips = 0
      }
      
      if (roleReceivesTipoutType(shift, 'sa')) {
        const distributionGroup = getRoleDistributionGroup(shift, 'sa')
        
        if (distributionGroup) {
          // This role shares the SA tipout pool based on their distribution group
          const groupHours = distributionGroupHours.get(distributionGroup) || 0
          if (groupHours > 0) {
            const share = Number(shift.hours) / groupHours
            existing.totalSaTipout += share * totalSATipout
          }
        }
        
        // SAs don't generally have cash or credit tips directly
        existing.totalCashTips = 0
        existing.totalCreditTips = 0
      }
      
      // For servers, calculate their cash and credit tips per hour
      if (serverShifts.some(s => s.id === shift.id)) {
        existing.cashTipsPerHour = serverCashTipsPerHour
        
        // Calculate credit/payroll tips based on hours worked minus individual bar tipout
        // This matches the spreadsheet formula: (server credit/HR * hours) - bar tipout
        const { barTipout } = calculateTipouts(shift, hasHost, hasSA)
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

  if (isLoading) {
    return <LoadingSpinner />
  }

  const summary = calculateSummary()
  const employeeRoleSummaries = calculateEmployeeRoleSummaries()

  // Chart components
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
        <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Where Tips Go</h3>
        <div className="h-[calc(100%-2rem)] flex justify-center">
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

  const TipoutPerHourChart = () => {
    // Filter by roles that actually have data
    const roleData = employeeRoleSummaries.reduce((acc, summary) => {
      if (!acc[summary.roleName]) {
        acc[summary.roleName] = {
          count: 0,
          totalTipsPerHour: 0,
          cashTipsPerHour: 0,
          creditTipsPerHour: 0,
        }
      }
      acc[summary.roleName].count += 1
      acc[summary.roleName].totalTipsPerHour += summary.totalTipsPerHour
      acc[summary.roleName].cashTipsPerHour += summary.cashTipsPerHour
      acc[summary.roleName].creditTipsPerHour += summary.creditTipsPerHour
      return acc
    }, {} as Record<string, { count: number, totalTipsPerHour: number, cashTipsPerHour: number, creditTipsPerHour: number }>)

    const roles = Object.keys(roleData)
    const averages = roles.map(role => ({
      role,
      totalTipsPerHour: roleData[role].totalTipsPerHour / roleData[role].count,
      cashTipsPerHour: roleData[role].cashTipsPerHour / roleData[role].count,
      creditTipsPerHour: roleData[role].creditTipsPerHour / roleData[role].count,
    }))

    // Sort roles by total tips per hour (descending)
    averages.sort((a, b) => b.totalTipsPerHour - a.totalTipsPerHour);

    const data = {
      labels: averages.map(a => a.role),
      datasets: [
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
        <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Earnings Per Hour By Role</h3>
        <div className="h-[calc(100%-2rem)]">
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

  const TipoutContributionChart = () => {
    // Group tipout data by employee
    const employeeTipouts = employeeRoleSummaries.reduce((acc, summary) => {
      if (!acc[summary.employeeName]) {
        acc[summary.employeeName] = {
          paid: 0,
          received: 0
        };
      }
      
      // Calculate total tipout paid (negative values mean paying out)
      const tipoutPaid = Math.min(0, summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout);
      
      // Calculate total tipout received (positive values mean receiving)
      const tipoutReceived = Math.max(0, summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout);
      
      acc[summary.employeeName].paid += Math.abs(tipoutPaid);
      acc[summary.employeeName].received += tipoutReceived;
      
      return acc;
    }, {} as Record<string, { paid: number, received: number }>);
    
    const employees = Object.keys(employeeTipouts);
    
    // Sort employees by the amount they pay into the pool (descending)
    employees.sort((a, b) => employeeTipouts[b].paid - employeeTipouts[a].paid);
    
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
        <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Tipout Flow by Employee</h3>
        <div className="h-[calc(100%-2rem)]">
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
        <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Tipout Rates By Role</h3>
        <div className="h-[calc(100%-2rem)]">
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


  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Reports</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            View and analyze tipout data.
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

      <div className="mt-4 bg-[var(--background)] shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-sm text-gray-700 dark:text-gray-300">Single Date</span>
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
            <span className="text-sm text-gray-700 dark:text-gray-300">Date Range</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-[var(--foreground)]">
                {isDateRange ? 'Start Date' : 'Date'}
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
                  End Date
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
                Employee
              </label>
              <div className="mt-1">
                <select
                  id="employeeId"
                  value={filters.employeeId}
                  onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                  disabled={isFilterLoading}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">All employees</option>
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
          <h3 className="mt-2 text-sm font-semibold text-[var(--foreground)]">No data available</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {filters.startDate === filters.endDate
              ? `No shifts were found for ${format(new Date(filters.startDate), 'MMMM d, yyyy')}.`
              : `No shifts were found between ${format(new Date(filters.startDate), 'MMMM d, yyyy')} and ${format(new Date(filters.endDate), 'MMMM d, yyyy')}.`}
            {filters.employeeId && ' for the selected employee.'}
          </p>
          <div className="mt-6">
            <Link
              href="/shifts/new"
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Add a shift
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Shifts</dt>
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Tips</dt>
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Tipouts</dt>
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
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Hours</dt>
                      <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">{summary.totalHours.toFixed(1)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">Detailed Analysis</h2>
            <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Tips Per Hour Summary</h3>
                <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 sm:divide-x sm:divide-gray-200 dark:sm:divide-gray-700">
                  <div className="sm:pr-8">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Bar</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Cash Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Credit Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Total Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.barTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                </div>
                  <div className="sm:pl-8">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Servers</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Cash Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Credit Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Total Tips/Hour</dt>
                        <dd className="text-base sm:text-lg font-medium text-[var(--foreground)]">${summary.serverTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">Employee Breakdown</h2>
            
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
                        {summary.totalHours.toFixed(1)} hours
                      </p>
                    </div>
                  </div>

                  {/* Tips Section */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Cash Tips</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${summary.totalCashTips.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Credit Tips</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${summary.totalCreditTips.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total Tips</p>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        ${(summary.totalCashTips + summary.totalCreditTips).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Tipouts Section */}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Tipouts</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Bar</p>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">Host</p>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">SA</p>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">Tips/Hour</p>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          ${summary.totalTipsPerHour.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Base Rate</p>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          ${summary.basePayRate.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Total/Hour</p>
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">
                          ${(summary.totalTipsPerHour + summary.basePayRate).toFixed(2)}
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
                          Employee
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Role
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Hours
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Cash Tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Credit Tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Bar Tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Host Tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          SA Tipout
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Payroll Tips
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Total Tips/Hour
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Base Pay Rate
                        </th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                          Total $/Hour
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
                            {summary.totalHours.toFixed(1)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalCashTips.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalCreditTips.toFixed(2)}
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
                            ${summary.totalPayrollTips !== undefined ? summary.totalPayrollTips.toFixed(2) : 'N/A'}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 mb-8">
            <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">Visualization & Analytics</h2>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
                <TipoutBreakdownChart />
          </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
              <TipoutPerHourChart />
            </div>
          </div>

            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
              <TipoutRatesChart />
          </div>

              <div className="bg-white/50 dark:bg-gray-800/50 p-4 sm:p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md h-[300px] sm:h-[400px]">
              <TipoutContributionChart />
            </div>
            </div>
          </div>
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