'use client'

import { useEffect, useState, Suspense } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import { AdminOnly } from '@/components/RoleBasedUI'
import { calculateTipouts, roleReceivesTipoutType } from '@/utils/tipoutCalculations'

type Employee = {
  id: string
  name: string
}

type Role = {
  id: string
  name: string
  basePayRate: number
  configs: {
    id: string
    tipoutType: string
    percentageRate: number
    effectiveFrom: string
    effectiveTo: string | null
  }[]
}

type Shift = {
  id: string
  date: string
  employee: Employee
  role: Role
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

// Create a new client component for the shifts content
function ShiftsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
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
      role: searchParams.get('role') || '',
    }
  })

  // Update filters when search params change
  useEffect(() => {
    setFilters({
      startDate: searchParams.get('startDate') || format(new Date(), 'yyyy-MM-dd'),
      endDate: searchParams.get('endDate') || format(new Date(), 'yyyy-MM-dd'),
      employeeId: searchParams.get('employeeId') || '',
      role: searchParams.get('role') || '',
    })
  }, [searchParams])

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (isDateRange && filters.endDate) params.set('endDate', filters.endDate)
    if (filters.employeeId) params.set('employeeId', filters.employeeId)
    if (filters.role) params.set('role', filters.role)

    const newUrl = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`
    router.push(newUrl)
  }, [filters, pathname, router, isDateRange])

  const fetchShifts = async () => {
    try {
      setIsFilterLoading(true)
      const queryParams = new URLSearchParams({
        startDate: filters.startDate,
        ...(isDateRange && { endDate: filters.endDate }),
        ...(filters.employeeId && { employeeId: filters.employeeId }),
        ...(filters.role && { role: filters.role }),
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
  }

  useEffect(() => {
    fetchShifts()
  }, [filters])

  const handleDelete = async (shiftId: string) => {
    if (!confirm('Are you sure you want to delete this shift?')) {
      return
    }

    try {
      const response = await fetch(`/api/shifts/${shiftId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete shift')
      }

      // Refresh the shifts list
      fetchShifts()
    } catch (err) {
      console.error('Error deleting shift:', err)
      alert('Failed to delete shift')
    }
  }

  // Group shifts by date to determine if hosts/SAs worked each day
  const shiftsByDate = shifts.reduce((acc, shift) => {
    // Parse the date and adjust for timezone
    const date = new Date(shift.date)
    // Add timezone offset to get to local time
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset())
    const dateStr = format(date, 'yyyy-MM-dd')
    if (!acc[dateStr]) {
      acc[dateStr] = []
    }
    acc[dateStr].push(shift)
    return acc
  }, {} as Record<string, Shift[]>)

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">shifts</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            view and manage employee shifts and tipouts.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <Link
            href="/shifts/new"
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            New Shift
          </Link>
        </div>
      </div>

      <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
        <div className="px-4 py-5 sm:p-6">
          {/* Filter Section */}
          <div className="mb-8">
            <h3 className="text-base font-medium text-[var(--foreground)] mb-4">filter shifts</h3>
            <div className="space-y-6">
              <div className="flex items-center space-x-4">
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

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium text-[var(--foreground)]">
                    {isDateRange ? 'start date' : 'date'}
                  </label>
                  <div className="mt-2">
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
                    <div className="mt-2">
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
                  <div className="mt-2">
                    <select
                      id="employeeId"
                      value={filters.employeeId}
                      onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                      disabled={isFilterLoading}
                      className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">all employees</option>
                      {Object.values(
                        shifts.reduce((acc, shift) => {
                          acc[shift.employee.id] = shift.employee;
                          return acc;
                        }, {} as Record<string, Employee>)
                      ).map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="role" className="block text-sm font-medium text-[var(--foreground)]">
                    role
                  </label>
                  <div className="mt-2">
                    <select
                      id="role"
                      value={filters.role}
                      onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                      disabled={isFilterLoading}
                      className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">all roles</option>
                      {Object.values(
                        shifts.reduce((acc, shift) => {
                          acc[shift.role.name] = shift.role.name;
                          return acc;
                        }, {} as Record<string, string>)
                      ).map((roleName) => (
                        <option key={roleName} value={roleName}>
                          {roleName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
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
        <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 p-8">
          <div className="text-center">
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="mt-4 text-sm font-semibold text-[var(--foreground)]">no shifts found</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isDateRange
                ? `no shifts were found between ${format(new Date(filters.startDate + 'T00:00:00'), 'MMMM d, yyyy').toLowerCase()} and ${format(new Date(filters.endDate + 'T00:00:00'), 'MMMM d, yyyy').toLowerCase()}`
                : `no shifts were found for ${format(new Date(filters.startDate + 'T00:00:00'), 'MMMM d, yyyy').toLowerCase()}`}
              {filters.employeeId && ' for the selected employee'}
              {filters.role && ' for the selected role'}.
            </p>
            <div className="mt-6">
              <Link
                href="/shifts/new"
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                add a shift
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
              <thead className="bg-gray-50/75 dark:bg-gray-800/75">
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">
                    date
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
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
                  <AdminOnly>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      actions
                    </th>
                  </AdminOnly>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {shifts.map((shift) => {
                  // Parse the date and adjust for timezone
                  const date = new Date(shift.date)
                  // Add timezone offset to get to local time
                  date.setMinutes(date.getMinutes() + date.getTimezoneOffset())
                  const dateStr = format(date, 'yyyy-MM-dd')
                  const dayShifts = shiftsByDate[dateStr]
                  
                  // Check for role types based on role configurations rather than name matching
                  const hasHost = dayShifts.some(s => roleReceivesTipoutType(s, 'host'))
                  const hasSA = dayShifts.some(s => roleReceivesTipoutType(s, 'sa'))
                  const hasBar = dayShifts.some(s => roleReceivesTipoutType(s, 'bar'))
                  
                  const { barTipout, hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA, hasBar)

                  return (
                    <tr key={shift.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[var(--foreground)] sm:pl-6">
                        {format(date, 'MMM d, yyyy')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {shift.employee.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {shift.role.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {shift.hours.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        ${shift.cashTips.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        ${shift.creditTips.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                        ${shift.liquorSales.toFixed(2)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-4 text-sm ${barTipout !== 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        ${barTipout.toFixed(2)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-4 text-sm ${hostTipout !== 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        ${hostTipout.toFixed(2)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-4 text-sm ${saTipout !== 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        ${saTipout.toFixed(2)}
                      </td>
                      <AdminOnly>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <Link
                            href={`/shifts/${shift.id}/edit`}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                          >
                            edit
                          </Link>
                          <button
                            onClick={() => handleDelete(shift.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          >
                            delete
                          </button>
                        </td>
                      </AdminOnly>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Main page component
export default function ShiftsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ShiftsContent />
    </Suspense>
  )
} 