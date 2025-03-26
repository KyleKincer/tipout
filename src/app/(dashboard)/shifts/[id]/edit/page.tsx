'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ShiftEntryForm from '@/components/ShiftEntryForm'
import { format } from 'date-fns'
import { use } from 'react'
import LoadingSpinner from '@/components/LoadingSpinner'
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

export default function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [shift, setShift] = useState<Shift | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasHost, setHasHost] = useState(false)
  const [hasSA, setHasSA] = useState(false)
  const [isTipoutsExpanded, setIsTipoutsExpanded] = useState(true)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [isTipoutsExpanded])

  useEffect(() => {
    const fetchShift = async () => {
      try {
        // Fetch the shift and all shifts for the same date to determine if hosts/SAs worked
        const response = await fetch(`/api/shifts/${resolvedParams.id}`)
        if (!response.ok) {
          throw new Error('Failed to fetch shift')
        }
        const data = await response.json()
        // Format the date before setting the shift state, handling timezone properly
        const shiftDate = new Date(data.date)
        // Add timezone offset to get to local time
        shiftDate.setMinutes(shiftDate.getMinutes() + shiftDate.getTimezoneOffset())
        const formattedData = {
          ...data,
          date: format(shiftDate, 'yyyy-MM-dd')
        }
        setShift(formattedData)

        // Fetch all shifts for the same date
        const date = format(shiftDate, 'yyyy-MM-dd')
        const shiftsResponse = await fetch(`/api/shifts?startDate=${date}&endDate=${date}`)
        if (!shiftsResponse.ok) {
          throw new Error('Failed to fetch shifts')
        }
        const shiftsData = await shiftsResponse.json()

        // Check if hosts/SAs worked that day
        const hasAnyHost = shiftsData.some((s: Shift) => 
          s.role?.name?.toLowerCase().includes('host')
        );
        const hasAnySA = shiftsData.some((s: Shift) => 
          s.role?.name?.toLowerCase().includes('sa')
        );
        
        console.log('Found hosts/SAs by name?', { hasAnyHost, hasAnySA });
        
        setHasHost(hasAnyHost);
        setHasSA(hasAnySA);
        
        console.log('Shifts for date:', shiftsData.length, 'shifts found');
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
  
  // Debug logging
  console.log('Final values used for calculation:', { 
    hasHost, 
    hasSA,
    role: shift.role?.name,
    configCount: shift.role?.configs?.length,
    cashTips: shift.cashTips,
    creditTips: shift.creditTips,
    liquorSales: shift.liquorSales
  });
  
  // Check for host tipout config specifically
  const hasHostTipoutConfig = shift.role?.configs?.some(config => 
    config.tipoutType === 'host'
  );
  
  console.log('Host tipout configuration check:', {
    hasHostTipoutConfig,
    totalTips: Number(shift.cashTips) + Number(shift.creditTips),
    hostConfigDetails: shift.role?.configs
      ?.filter(config => config.tipoutType === 'host')
      ?.map(config => ({
        percentageRate: config.percentageRate,
        tipoutType: config.tipoutType
      }))
  });
  
  console.log('Calculated tipouts:', { barTipout, hostTipout, saTipout });

  return (
    <div className="space-y-6">
      <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">edit shift</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              update shift information and recalculate tipouts.
            </p>
          </div>

          <div>
            <button
              onClick={() => setIsTipoutsExpanded(!isTipoutsExpanded)}
              className="flex items-center justify-between w-full text-left mb-4"
            >
              <h3 className="text-base font-medium text-[var(--foreground)]">calculated tipouts</h3>
              <svg
                className={`w-5 h-5 transform transition-transform duration-200 ${isTipoutsExpanded ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            <div 
              className={`overflow-hidden transition-[height,opacity] duration-200 ease-in-out ${isTipoutsExpanded ? 'opacity-100' : 'opacity-0'}`}
              style={{ 
                height: isTipoutsExpanded ? (contentHeight ?? 'auto') : 0
              }}
            >
              <div ref={contentRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">bar tipout</dt>
                  <dd className="mt-1 text-2xl font-semibold text-[var(--foreground)]">${barTipout.toFixed(2)}</dd>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">host tipout</dt>
                  <dd className="mt-1 text-2xl font-semibold text-[var(--foreground)]">${hostTipout.toFixed(2)}</dd>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">sa tipout</dt>
                  <dd className="mt-1 text-2xl font-semibold text-[var(--foreground)]">${saTipout.toFixed(2)}</dd>
                </div>
              </div>
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