'use client'

import { useEffect, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { format } from 'date-fns'
import ShiftEntryForm from '@/components/ShiftEntryForm'
import LoadingSpinner from '@/components/LoadingSpinner'
import { calculateTipouts, roleReceivesTipoutType } from '@/lib/tipoutCalculations'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'

type ShiftDoc = NonNullable<FunctionReturnType<typeof api.shifts.get>>

type ShiftFormData = {
  employeeId: string
  roleId: string
  date: string
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

// The calculators under src/lib expect configs where `distributionGroup` is
// `string | undefined`; Convex returns `string | null`. Adapt without casts.
type CalcConfig = {
  id: string
  tipoutType: string
  percentageRate: number
  effectiveFrom: string
  effectiveTo: string | null
  paysTipout?: boolean
  receivesTipout?: boolean
  distributionGroup?: string
}
type CalcShift = {
  id: string
  date: string
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
  employee: { id: string; name: string }
  role: { name: string; basePayRate: number; configs: CalcConfig[] }
}
function toCalcShift(shift: ShiftDoc): CalcShift {
  return {
    id: shift.id,
    date: shift.date,
    hours: shift.hours,
    cashTips: shift.cashTips,
    creditTips: shift.creditTips,
    liquorSales: shift.liquorSales,
    employee: { id: shift.employee.id, name: shift.employee.name },
    role: {
      name: shift.role.name,
      basePayRate: shift.role.basePayRate,
      configs: shift.role.configs.map((c) => ({
        id: c.id,
        tipoutType: c.tipoutType,
        percentageRate: c.percentageRate,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        paysTipout: c.paysTipout,
        receivesTipout: c.receivesTipout,
        distributionGroup: c.distributionGroup ?? undefined,
      })),
    },
  }
}

export default function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const shiftId = resolvedParams.id as Id<'shifts'>

  const shiftData = useQuery(api.shifts.get, { id: shiftId })

  // Determine the local-time date string for the shift to use as the date filter
  // for same-day shifts. Use 'skip' until we have the shift loaded.
  const sameDayDateStr: string | null = shiftData
    ? (() => {
        const d = new Date(shiftData.date)
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset())
        return format(d, 'yyyy-MM-dd')
      })()
    : null

  const dayShifts = useQuery(
    api.shifts.list,
    sameDayDateStr ? { startDate: sameDayDateStr, endDate: sameDayDateStr } : 'skip',
  )

  const updateShift = useMutation(api.shifts.update)

  const [error, setError] = useState<string | null>(null)
  const [isTipoutsExpanded, setIsTipoutsExpanded] = useState(true)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [isTipoutsExpanded])

  const handleSubmit = async (data: ShiftFormData) => {
    try {
      await updateShift({
        id: shiftId,
        employeeId: data.employeeId as Id<'employees'>,
        roleId: data.roleId as Id<'roles'>,
        date: data.date,
        hours: Number(data.hours),
        cashTips: Number(data.cashTips) || 0,
        creditTips: Number(data.creditTips) || 0,
        liquorSales: Number(data.liquorSales) || 0,
      })

      router.push('/shifts')
    } catch (err) {
      console.error('Error updating shift:', err)
      setError('Failed to update shift')
    }
  }

  if (shiftData === undefined || dayShifts === undefined) {
    return <LoadingSpinner />
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  if (shiftData === null) {
    return <div>Shift not found</div>
  }

  // Build form initial data (date formatted for <input type="date" />)
  const shiftDate = new Date(shiftData.date)
  shiftDate.setMinutes(shiftDate.getMinutes() + shiftDate.getTimezoneOffset())
  const initialFormData: ShiftFormData = {
    employeeId: shiftData.employee.id,
    roleId: shiftData.role.id,
    date: format(shiftDate, 'yyyy-MM-dd'),
    hours: shiftData.hours,
    cashTips: shiftData.cashTips,
    creditTips: shiftData.creditTips,
    liquorSales: shiftData.liquorSales,
  }

  const calcShift = toCalcShift(shiftData)

  // Determine if hosts/SAs worked that day using role configurations
  const hasHost = dayShifts.some((s) => roleReceivesTipoutType(toCalcShift(s), 'host'))
  const hasSA = dayShifts.some((s) => roleReceivesTipoutType(toCalcShift(s), 'sa'))
  const hasBar = roleReceivesTipoutType(calcShift, 'bar')

  const { barTipout, hostTipout, saTipout } = calculateTipouts(calcShift, hasHost, hasSA, hasBar)

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
                height: isTipoutsExpanded ? (contentHeight ?? 'auto') : 0,
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
        initialData={initialFormData}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
