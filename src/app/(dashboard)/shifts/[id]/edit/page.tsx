'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ShiftEntryForm from '@/components/ShiftEntryForm'
import { format } from 'date-fns'
import { use } from 'react'
import LoadingSpinner from '@/components/LoadingSpinner'

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

type ShiftFormData = {
  employeeId: string
  roleId: string
  date: string
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

type Shift = ShiftFormData & {
  id: string
  employee?: Employee
  role?: Role
}

// Helper function to calculate tipouts
const calculateTipouts = (shift: Shift, hasHost: boolean, hasSA: boolean) => {
  if (!shift.role?.configs) return { barTipout: 0, hostTipout: 0, saTipout: 0 }

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

export default function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [shift, setShift] = useState<Shift | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasHost, setHasHost] = useState(false)
  const [hasSA, setHasSA] = useState(false)

  useEffect(() => {
    const fetchShift = async () => {
      try {
        // Fetch the shift and all shifts for the same date to determine if hosts/SAs worked
        const response = await fetch(`/api/shifts/${resolvedParams.id}`)
        if (!response.ok) {
          throw new Error('Failed to fetch shift')
        }
        const data = await response.json()
        setShift(data)

        // Fetch all shifts for the same date
        const date = format(new Date(data.date), 'yyyy-MM-dd')
        const shiftsResponse = await fetch(`/api/shifts?startDate=${date}&endDate=${date}`)
        if (!shiftsResponse.ok) {
          throw new Error('Failed to fetch shifts')
        }
        const shiftsData = await shiftsResponse.json()

        // Check if hosts/SAs worked that day
        setHasHost(shiftsData.some((s: Shift) => s.role?.name.toLowerCase().includes('host')))
        setHasSA(shiftsData.some((s: Shift) => s.role?.name.toLowerCase().includes('sa')))
      } catch (err) {
        setError('Failed to load shift')
        console.error('Error loading shift:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchShift()
  }, [resolvedParams.id])

  const handleSubmit = async (data: ShiftFormData) => {
    try {
      const response = await fetch(`/api/shifts/${resolvedParams.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('Failed to update shift')
      }

      router.push('/shifts')
    } catch (err) {
      console.error('Error updating shift:', err)
      setError('Failed to update shift')
    }
  }

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  if (!shift) {
    return <div>Shift not found</div>
  }

  const { barTipout, hostTipout, saTipout } = calculateTipouts(shift, hasHost, hasSA)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Shift</h1>
        <p className="mt-2 text-sm text-gray-700">
          Update shift information and recalculate tipouts.
        </p>
      </div>

      <div className="mb-8 bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Calculated Tipouts</h3>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-gray-500">Bar Tipout</dt>
              <dd className="mt-1 text-sm text-gray-900">${barTipout.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Host Tipout</dt>
              <dd className="mt-1 text-sm text-gray-900">${hostTipout.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">SA Tipout</dt>
              <dd className="mt-1 text-sm text-gray-900">${saTipout.toFixed(2)}</dd>
            </div>
          </div>
        </div>
      </div>

      <ShiftEntryForm
        initialData={shift}
        onSubmit={handleSubmit}
      />
    </div>
  )
} 