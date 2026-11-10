'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline'
import LoadingSpinner from '@/components/LoadingSpinner'
import { AdminOnly } from '@/components/RoleBasedUI'
import { formatDay } from '@/utils/dateLabels'

type Period = {
  id: string
  startDate: string
  endDate: string
  lockedAt: string | null
  lockedBy: string | null
  shiftCount: number | null
  payrollTips: number | null
}

const input = 'block rounded-md border border-gray-300 shadow-sm px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white'
const secondary = 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700 disabled:opacity-50'

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Something went wrong')
  return response.json()
}

export default function PayPeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([])
  const [form, setForm] = useState({ startDate: '', endDate: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await call('/api/pay-periods', { method: 'GET' })
      setPeriods(data.periods)
      if (data.suggestion) setForm(f => (f.startDate ? f : data.suggestion))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pay periods')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong') }
    setBusy(false)
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => { await call('/api/pay-periods', { method: 'POST', body: JSON.stringify(form) }); setForm({ startDate: '', endDate: '' }) })
  }
  const lock = (p: Period) => {
    if (!confirm(`Lock payroll for ${formatDay(p.startDate)} – ${formatDay(p.endDate)}? The results are saved exactly as they are now, and shifts and role settings for those dates can't be changed until it's unlocked.`)) return
    run(() => call(`/api/pay-periods/${p.id}`, { method: 'POST', body: JSON.stringify({ action: 'lock' }) }))
  }
  const unlock = (p: Period) => {
    const reason = prompt(`Why does ${formatDay(p.startDate)} – ${formatDay(p.endDate)} need unlocking? This goes in the change log, along with the results as they were paid.`)
    if (!reason?.trim()) return
    run(() => call(`/api/pay-periods/${p.id}`, { method: 'POST', body: JSON.stringify({ action: 'unlock', reason }) }))
  }
  const remove = (p: Period) => {
    if (!confirm(`Remove the pay period ${formatDay(p.startDate)} – ${formatDay(p.endDate)}?`)) return
    run(() => call(`/api/pay-periods/${p.id}`, { method: 'DELETE' }))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-sm">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">pay periods</h1>
      <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
        Lock a pay period once payroll has been run. Locking saves every shift&apos;s numbers exactly as they were paid, and stops anyone from
        changing shifts or role settings that would alter them. Reports for locked dates always show the as-paid numbers.
      </p>

      {error && <div className="mt-4 rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-900/50 dark:text-red-200">{error}</div>}

      <AdminOnly>
        <form onSubmit={add} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <label>
            <span className="text-gray-600 dark:text-gray-300">first day</span>
            <input type="date" className={`mt-1 ${input}`} value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} required />
          </label>
          <label>
            <span className="text-gray-600 dark:text-gray-300">last day</span>
            <input type="date" className={`mt-1 ${input}`} value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} required />
          </label>
          <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">add pay period</button>
        </form>
      </AdminOnly>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white/50 dark:border-gray-700 dark:bg-gray-800/50">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
              <th className="px-4 py-2 font-medium">dates</th>
              <th className="px-4 py-2 font-medium">status</th>
              <th className="px-4 py-2 text-right font-medium">payroll tips as paid</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {periods.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">No pay periods yet.</td></tr>
            )}
            {periods.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <Link href={`/reports?startDate=${p.startDate}&endDate=${p.endDate}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {formatDay(p.startDate)} – {formatDay(p.endDate)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {p.lockedAt ? (
                    <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
                      <LockClosedIcon className="h-4 w-4" /> locked {formatDay(p.lockedAt.slice(0, 10))}{p.lockedBy ? ` by ${p.lockedBy}` : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400"><LockOpenIcon className="h-4 w-4" /> open</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.payrollTips !== null ? `$${p.payrollTips.toFixed(2)} · ${p.shiftCount} shifts` : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <AdminOnly>
                    <span className="inline-flex gap-2">
                      {p.lockedAt
                        ? <button className={secondary} disabled={busy} onClick={() => unlock(p)}>unlock</button>
                        : <>
                            <button className={secondary} disabled={busy} onClick={() => lock(p)}>lock</button>
                            <button className={secondary} disabled={busy} onClick={() => remove(p)}>remove</button>
                          </>}
                    </span>
                  </AdminOnly>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
