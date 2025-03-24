'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'

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

// Helper function to calculate tipouts
const calculateTipouts = (shift: Shift, hasHost: boolean, hasSA: boolean) => {
  const totalTips = Number(shift.cashTips) + Number(shift.creditTips)
  let barTipout = 0
  let hostTipout = 0
  let saTipout = 0

  shift.role.configs.forEach(config => {
    switch (config.tipoutType) {
      case 'bar':
        barTipout = Number(shift.liquorSales) * (config.percentageRate / 100)
        break
      case 'host':
        if (hasHost) {
          hostTipout = totalTips * (config.percentageRate / 100)
        }
        break
      case 'sa':
        if (hasSA) {
          saTipout = totalTips * (config.percentageRate / 100)
        }
        break
    }
  })

  return { barTipout, hostTipout, saTipout }
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  })

  const fetchShifts = async () => {
    try {
      const queryParams = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
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
    const date = format(new Date(shift.date), 'yyyy-MM-dd')
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(shift)
    return acc
  }, {} as Record<string, Shift[]>)

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  if (shifts.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Shifts</h1>
              <p className="mt-2 text-sm text-gray-700">
                View and manage employee shifts and tipouts.
              </p>
            </div>
            <Link
              href="/shifts/new"
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              New Shift
            </Link>
          </div>

          <div className="mt-4 flex gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
                Start Date
              </label>
              <input
                type="date"
                id="startDate"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                type="date"
                id="endDate"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
          </div>
        </div>

        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
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
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No shifts found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filters.startDate === filters.endDate
              ? `No shifts were found for ${format(new Date(filters.startDate), 'MMMM d, yyyy')}.`
              : `No shifts were found between ${format(new Date(filters.startDate), 'MMMM d, yyyy')} and ${format(new Date(filters.endDate), 'MMMM d, yyyy')}.`}
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
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Shifts</h1>
            <p className="mt-2 text-sm text-gray-700">
              View and manage employee shifts and tipouts.
            </p>
          </div>
          <Link
            href="/shifts/new"
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            New Shift
          </Link>
        </div>

        <div className="mt-4 flex gap-4">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              type="date"
              id="startDate"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
              End Date
            </label>
            <input
              type="date"
              id="endDate"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl">
        <div className="px-4 py-6 sm:p-8">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Employee
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Hours
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Cash Tips
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Credit Tips
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Liquor Sales
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Bar Tipout
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Host Tipout
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    SA Tipout
                  </th>
                  <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {shifts.map((shift) => {
                  const date = format(new Date(shift.date), 'yyyy-MM-dd')
                  const dayShifts = shiftsByDate[date]
                  const hasHost = dayShifts.some(s => s.role.name.toLowerCase().includes('host'))
                  const hasSA = dayShifts.some(s => s.role.name.toLowerCase().includes('sa'))
                  const { barTipout, hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA)

                  return (
                    <tr key={shift.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                        {format(new Date(shift.date), 'MMM d, yyyy')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {shift.employee.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {shift.role.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {shift.hours.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${shift.cashTips.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${shift.creditTips.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${shift.liquorSales.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${barTipout.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${hostTipout.toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        ${saTipout.toFixed(2)}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <Link
                          href={`/shifts/${shift.id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900 mr-4"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(shift.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
} 