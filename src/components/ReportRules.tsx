'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LockClosedIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { formatDay, formatSpan } from '@/utils/dateLabels'

export type ReportRulesData = {
  rules?: {
    roleId: string
    roleName: string
    versions: { id: string; effectiveFrom: string; effectiveTo: string | null; summary: string; changes: string[] }[]
  }[]
  lockedPeriods?: { id: string; startDate: string; endDate: string; lockedAt: string; lockedBy: string | null }[]
  drift?: { shiftId: string; date: string; employeeName: string; roleName: string; paid: number | null; now: number | null }[]
}

const money = (n: number | null) => (n === null ? '—' : `$${n.toFixed(2)}`)

/** What rules a report used, which days are locked as paid, and anything that would calculate differently now. */
export default function ReportRules({ data, startDate, endDate }: { data: ReportRulesData; startDate: string; endDate: string }) {
  const [open, setOpen] = useState(false)
  const rules = data.rules ?? []
  const changed = rules.filter(r => r.versions.length > 1)
  const locked = data.lockedPeriods ?? []
  const drift = data.drift ?? []
  if (rules.length === 0 && locked.length === 0) return null

  return (
    <div className="mt-6 space-y-3 text-sm">
      {locked.length > 0 && (
        <div className="flex gap-2 rounded-md border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <LockClosedIcon className="h-5 w-5 flex-none text-gray-500" />
          <p className="text-[var(--foreground)]">
            {locked.map((p, i) => (
              <span key={p.id}>
                {i > 0 && '; '}
                {formatDay(p.startDate)} – {formatDay(p.endDate)} is locked{p.lockedBy ? ` (by ${p.lockedBy})` : ''}
              </span>
            ))}
            . Numbers for those dates are exactly as paid. <Link href="/pay-periods" className="text-indigo-600 hover:underline dark:text-indigo-400">pay periods</Link>
          </p>
        </div>
      )}

      {drift.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          <p className="flex items-center gap-2 font-medium"><ExclamationTriangleIcon className="h-5 w-5" /> {drift.length} locked {drift.length === 1 ? 'shift calculates' : 'shifts calculate'} differently today than {drift.length === 1 ? 'it was' : 'they were'} paid</p>
          <p className="mt-1">This page shows the as-paid numbers. The difference usually means data was changed directly in the database or the calculation itself changed.</p>
          <ul className="mt-2 space-y-0.5">
            {drift.slice(0, 10).map(d => (
              <li key={d.shiftId}>{formatDay(d.date)} · {d.employeeName} ({d.roleName}): paid {money(d.paid)}, now {money(d.now)}</li>
            ))}
          </ul>
        </div>
      )}

      {rules.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
            <span className="font-medium text-[var(--foreground)]">
              rules in effect {startDate === endDate ? `on ${formatDay(startDate)}` : `${formatDay(startDate)} – ${formatDay(endDate)}`}
            </span>
            <span className="text-indigo-600 dark:text-indigo-400">{open ? 'hide' : 'show'}</span>
          </button>
          {changed.length > 0 && (
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              Settings changed during this range for {changed.map(r => r.roleName).join(', ')}. Each shift uses the settings for its own date.
            </p>
          )}
          {open && (
            <dl className="mt-3 space-y-3">
              {rules.map(r => (
                <div key={r.roleId}>
                  <dt className="font-medium text-[var(--foreground)]">{r.roleName}</dt>
                  {r.versions.map((v, i) => (
                    <dd key={v.id} className="mt-0.5 text-gray-600 dark:text-gray-300">
                      <span className="text-gray-500 dark:text-gray-400">{formatSpan(v.effectiveFrom, v.effectiveTo)}:</span>{' '}
                      {i > 0 && v.changes.length > 0 ? <>{v.changes.join('; ')}. </> : null}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{v.summary}</span>
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}
