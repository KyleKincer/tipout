'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
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
import { Bar, Pie, Doughnut } from 'react-chartjs-2'

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

export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    employeeId: '',
  })
  const [isDateRange, setIsDateRange] = useState(false)

  const fetchShifts = useCallback(async () => {
    try {
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

  const calculateTipouts = (shift: Shift, hasHost: boolean, hasSA: boolean) => {
    const totalTips = Number(shift.cashTips) + Number(shift.creditTips)
    let barTipout = 0
    let hostTipout = 0
    let saTipout = 0

    // Find the applicable configurations for this shift
    shift.role.configs.forEach(config => {
      // Only apply tipout if this role is configured to pay this type of tipout
      const paysTipout = config.paysTipout !== false // default to true if not specified

      if (!paysTipout) return

      switch (config.tipoutType) {
        case 'bar':
          // Bar tipout is calculated based on liquor sales
          barTipout = Number(shift.liquorSales) * (config.percentageRate / 100)
          break
        case 'host':
          if (hasHost) {
            // Host tipout is calculated based on total tips
            hostTipout = totalTips * (config.percentageRate / 100)
          }
          break
        case 'sa':
          if (hasSA) {
            // SA tipout is calculated based on total tips
            saTipout = totalTips * (config.percentageRate / 100)
          }
          break
      }
    })

    return { barTipout, hostTipout, saTipout }
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
    const serverBarTipouts = serverShifts.reduce((sum, shift) => {
      const { barTipout } = calculateTipouts(shift, true, true)
      return sum + barTipout
    }, 0)
    
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
    const shiftsByDate = shifts.reduce((acc, shift) => {
      const date = format(new Date(shift.date), 'yyyy-MM-dd')
      if (!acc[date]) {
        acc[date] = []
      }
      acc[date].push(shift)
      return acc
    }, {} as Record<string, Shift[]>)

    // Check if there's at least one host and SA
    const hasHost = shifts.some(shift => roleReceivesTipoutType(shift, 'host'))
    const hasSA = shifts.some(shift => roleReceivesTipoutType(shift, 'sa'))

    // Helper function to check if a role receives a specific tipout type
    function roleReceivesTipoutType(shift: Shift, tipoutType: string): boolean {
      return shift.role.configs.some(config => 
        config.tipoutType === tipoutType && config.receivesTipout
      )
    }
    
    // Helper function to check if a role pays a specific tipout type
    function rolePaysTipoutType(shift: Shift, tipoutType: string): boolean {
      return shift.role.configs.some(config => 
        config.tipoutType === tipoutType && config.paysTipout !== false
      )
    }

    // Helper function to get a role's distribution group for a tipout type
    function getRoleDistributionGroup(shift: Shift, tipoutType: string): string | null {
      const config = shift.role.configs.find(c => 
        c.tipoutType === tipoutType && c.receivesTipout && c.distributionGroup
      )
      return config?.distributionGroup || null
    }

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
    distributionGroups.forEach((groupSummaries, groupName) => {
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
    return <div>Loading...</div>
  }

  const summary = calculateSummary()
  const employeeRoleSummaries = calculateEmployeeRoleSummaries()

  // Chart components
  const TipoutBreakdownChart = () => {
    const data = {
      labels: ['Server Tips', 'Bar Tipout', 'Host Tipout', 'SA Tipout'],
      datasets: [
        {
          label: 'Tip Distribution',
          data: [
            summary.totalCashTips + summary.totalCreditTips - 
            (summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout),
            summary.totalBarTipout,
            summary.totalHostTipout,
            summary.totalSaTipout
          ],
          backgroundColor: [
            'rgba(54, 162, 235, 0.7)',
            'rgba(255, 99, 132, 0.7)',
            'rgba(255, 206, 86, 0.7)',
            'rgba(75, 192, 192, 0.7)',
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

    return (
      <div className="h-64">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Where Server Tips Go</h3>
        <Doughnut
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'right',
                labels: {
                  boxWidth: 15,
                  padding: 15,
                  font: {
                    size: 12
                  }
                }
              },
              tooltip: {
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

    const data = {
      labels: averages.map(a => a.role),
      datasets: [
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
        {
          label: 'Total Tips/Hour',
          data: averages.map(a => a.totalTipsPerHour),
          backgroundColor: 'rgba(153, 102, 255, 0.7)',
          borderColor: 'rgba(153, 102, 255, 1)',
          borderWidth: 1,
        },
      ],
    }

    return (
      <div className="h-64">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Tips Per Hour By Role</h3>
        <Bar
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: '$ Per Hour'
                }
              }
            },
            plugins: {
              tooltip: {
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
    )
  }

  const ServerTipFlowChart = () => {
    // For servers only
    const serverSummaries = employeeRoleSummaries.filter(summary => {
      return summary.totalBarTipout < 0; // Servers pay tipout
    });

    if (serverSummaries.length === 0) {
      return null;
    }

    const serverData = serverSummaries.map(server => ({
      name: server.employeeName,
      grossTips: server.totalCashTips + server.totalCreditTips,
      netTips: server.totalCashTips + server.totalCreditTips + server.totalBarTipout + server.totalHostTipout + server.totalSaTipout,
      tipouts: Math.abs(server.totalBarTipout + server.totalHostTipout + server.totalSaTipout),
    }));

    const data = {
      labels: serverData.map(s => s.name),
      datasets: [
        {
          label: 'Gross Tips',
          data: serverData.map(s => s.grossTips),
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
        },
        {
          label: 'Tipouts',
          data: serverData.map(s => s.tipouts),
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
        {
          label: 'Net Tips',
          data: serverData.map(s => s.netTips),
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
      ],
    };

    return (
      <div className="h-64">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Server Tip Flow</h3>
        <Bar
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                stacked: false,
                title: {
                  display: true,
                  text: 'Dollars'
                }
              },
              x: {
                stacked: false,
              }
            },
            plugins: {
              tooltip: {
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
      <div className="h-64">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Tipout Rates By Role</h3>
        <Bar
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Percentage (%)'
                }
              }
            },
            plugins: {
              tooltip: {
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
    
    const data = {
      labels: employees,
      datasets: [
        {
          label: 'Tipout Paid Into Pool',
          data: employees.map(emp => employeeTipouts[emp].paid),
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
        {
          label: 'Tipout Received From Pool',
          data: employees.map(emp => employeeTipouts[emp].received),
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
      ],
    };
    
    return (
      <div className="h-80">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Tipout Flow by Employee</h3>
        <p className="text-sm text-gray-600 mb-4">
          This chart shows how much each employee contributes to the tipout pool and how much they receive from it.
        </p>
        <Bar
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal bar chart
            scales: {
              x: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Amount ($)'
                }
              }
            },
            plugins: {
              tooltip: {
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
    )
  }

  const TipoutCalculationExplainer = () => {
    // Find an example server shift to use for demonstration
    const serverShift = shifts.find(shift => {
      return shift.role.configs.some(config => 
        config.paysTipout !== false && config.receivesTipout !== true
      );
    });
    
    if (!serverShift) {
      return null;
    }
    
    // Find real tipout rates from the example shift
    let barTipoutRate = 0;
    let hostTipoutRate = 0;
    let saTipoutRate = 0;
    
    serverShift.role.configs.forEach(config => {
      if (config.tipoutType === 'bar') barTipoutRate = config.percentageRate;
      if (config.tipoutType === 'host') hostTipoutRate = config.percentageRate;
      if (config.tipoutType === 'sa') saTipoutRate = config.percentageRate;
    });
    
    // Calculate example values
    const exampleTotalTips = 100; // $100 in total tips
    const exampleLiquorSales = 400; // $400 in liquor sales
    
    const exampleBarTipout = (exampleLiquorSales * barTipoutRate / 100).toFixed(2);
    const exampleHostTipout = (exampleTotalTips * hostTipoutRate / 100).toFixed(2);
    const exampleSATipout = (exampleTotalTips * saTipoutRate / 100).toFixed(2);
    
    const exampleTotalTipout = (
      parseFloat(exampleBarTipout) + 
      parseFloat(exampleHostTipout) + 
      parseFloat(exampleSATipout)
    ).toFixed(2);
    
    const exampleNetTips = (exampleTotalTips - parseFloat(exampleTotalTipout)).toFixed(2);
    
    return (
      <div id="tipout-explainer" className="bg-white p-6 rounded-lg shadow mt-8 scroll-mt-16">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">How Tipouts Are Calculated</h3>
        
        <div className="space-y-6">
          <div>
            <h4 className="text-base font-medium text-gray-800">Example Scenario</h4>
            <p className="text-sm text-gray-600 mt-1">
              Let's say you had a great shift with the following:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>Total tips: <span className="font-medium">${exampleTotalTips.toFixed(2)}</span></li>
              <li>Liquor sales: <span className="font-medium">${exampleLiquorSales.toFixed(2)}</span></li>
            </ul>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h5 className="text-sm font-medium text-gray-800">Bar Tipout</h5>
              <p className="text-xs text-gray-600 mt-1">
                Bar tipout is calculated as <span className="font-medium">{barTipoutRate}%</span> of your total liquor sales.
              </p>
              <div className="mt-2 bg-white p-3 rounded border border-gray-200">
                <p className="text-xs">
                  ${exampleLiquorSales.toFixed(2)} × {barTipoutRate}% = <span className="font-medium text-red-600">${exampleBarTipout}</span>
                </p>
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <h5 className="text-sm font-medium text-gray-800">Host Tipout</h5>
              <p className="text-xs text-gray-600 mt-1">
                Host tipout is calculated as <span className="font-medium">{hostTipoutRate}%</span> of your total tips.
              </p>
              <div className="mt-2 bg-white p-3 rounded border border-gray-200">
                <p className="text-xs">
                  ${exampleTotalTips.toFixed(2)} × {hostTipoutRate}% = <span className="font-medium text-red-600">${exampleHostTipout}</span>
                </p>
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <h5 className="text-sm font-medium text-gray-800">SA Tipout</h5>
              <p className="text-xs text-gray-600 mt-1">
                SA tipout is calculated as <span className="font-medium">{saTipoutRate}%</span> of your total tips.
              </p>
              <div className="mt-2 bg-white p-3 rounded border border-gray-200">
                <p className="text-xs">
                  ${exampleTotalTips.toFixed(2)} × {saTipoutRate}% = <span className="font-medium text-red-600">${exampleSATipout}</span>
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-indigo-50 p-4 rounded-lg">
            <h4 className="text-base font-medium text-indigo-800">Total Calculation</h4>
            <div className="mt-2 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Total Tips:</span>
                <span className="text-sm font-medium">${exampleTotalTips.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Bar Tipout:</span>
                <span className="text-sm font-medium text-red-600">- ${exampleBarTipout}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Host Tipout:</span>
                <span className="text-sm font-medium text-red-600">- ${exampleHostTipout}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">SA Tipout:</span>
                <span className="text-sm font-medium text-red-600">- ${exampleSATipout}</span>
              </div>
              <div className="pt-2 border-t border-indigo-200 flex justify-between">
                <span className="text-sm font-medium">Net Tips:</span>
                <span className="text-sm font-medium text-green-600">${exampleNetTips}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="text-base font-medium text-gray-800">Special Note on Credit Tips</h4>
            <p className="text-sm text-gray-600 mt-1">
              Credit card tips appear on your paycheck with tipouts already deducted. 
              Cash tips are received directly, and you'll need to pay out the appropriate 
              tipouts from your cash at the end of your shift.
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Reports</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            View and analyze tipout data.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <a 
            href="#tipout-explainer"
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
            How Tipouts Work
          </a>
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
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
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
                    className="block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
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
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
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

      {shifts.length === 0 ? (
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
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Add a shift
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[var(--background)] overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-indigo-500 p-3">
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Shifts</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">{summary.totalShifts}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[var(--background)] overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-green-500 p-3">
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Tips</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">
                        ${(summary.totalCashTips + summary.totalCreditTips).toFixed(2)}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[var(--background)] overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-yellow-500 p-3">
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Tipouts</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">
                        ${(summary.totalBarTipout + summary.totalHostTipout + summary.totalSaTipout).toFixed(2)}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[var(--background)] overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="rounded-md bg-purple-500 p-3">
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Hours</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">{summary.totalHours.toFixed(1)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-[var(--background)] shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium leading-6 text-[var(--foreground)]">Tips Per Hour Summary</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Bar</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Cash Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.barCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Credit Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.barCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Total Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.barTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Servers</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Cash Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.serverCashTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Credit Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.serverCreditTipsPerHour.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500 dark:text-gray-400">Total Tips/Hour</dt>
                      <dd className="text-lg font-medium text-[var(--foreground)]">${summary.serverTipsPerHour.toFixed(2)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flow-root">
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
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
                    <tbody className="divide-y divide-gray-200 bg-white dark:bg-gray-900 dark:divide-gray-700">
                      {employeeRoleSummaries.map((summary) => (
                        <tr key={`${summary.employeeId}-${summary.roleName}`}>
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
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalBarTipout.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalHostTipout.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalSaTipout.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalPayrollTips !== undefined ? summary.totalPayrollTips.toFixed(2) : 'N/A'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.totalTipsPerHour.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                            ${summary.basePayRate.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400 font-medium">
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

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutBreakdownChart />
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutPerHourChart />
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <ServerTipFlowChart />
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutRatesChart />
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutContributionChart />
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutCalculationExplainer />
            </div>
          </div>
        </>
      )}

      {/* Add a detailed visual explanation section when there's data */}
      {shifts.length > 0 && (
        <div className="mt-16">
          <div className="sm:flex sm:items-center mb-6">
            <div className="sm:flex-auto">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Visual Tip Distribution</h2>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                Visual breakdown of where tips go and how they're distributed.
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutBreakdownChart />
            </div>
            
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutPerHourChart />
            </div>
          </div>
          
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <ServerTipFlowChart />
            </div>
            
            <div className="bg-[var(--background)] p-6 rounded-lg shadow">
              <TipoutRatesChart />
            </div>
          </div>
          
          <div className="mt-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium leading-6 text-[var(--foreground)] mb-4">Understanding Your Tipouts</h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Bar Tipout</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Bar tipout is calculated as a percentage of your liquor sales. 
                  It goes to bartenders who prepare drinks for your tables.
                </p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Host Tipout</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Host tipout is calculated as a percentage of your total tips. 
                  It compensates hosts who seat and organize tables.
                </p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">SA (Server Assistant) Tipout</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  SA tipout is calculated as a percentage of your total tips. 
                  It goes to server assistants who help run food, bus tables, and support the floor.
                </p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Credit Tips vs. Cash Tips</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Credit tips appear on your paycheck with tipouts already deducted.
                  Cash tips are received directly and tipouts must be paid separately.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 