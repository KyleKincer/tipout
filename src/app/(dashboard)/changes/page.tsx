'use client'

import { useCallback, useEffect, useState } from 'react'
import LoadingSpinner from '@/components/LoadingSpinner'

type Entry = { id: string; at: string; actorName: string | null; action: string; entityType: string; summary: string }

const TYPES = [
  { value: '', label: 'everything' },
  { value: 'role', label: 'role settings' },
  { value: 'shift', label: 'shifts' },
  { value: 'employee', label: 'employees' },
  { value: 'payPeriod', label: 'pay periods' },
]

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })

export default function ChangesPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ limit: '50' })
    if (type) params.set('entityType', type)
    if (before) params.set('before', before)
    const response = await fetch(`/api/audit?${params}`)
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error || 'Failed to load the change log')
    } else {
      const data = await response.json()
      setEntries(e => (before ? [...e, ...data.entries] : data.entries))
      setNext(data.next)
    }
    setLoading(false)
  }, [type])

  useEffect(() => { setLoading(true); load() }, [load])

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-sm">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">change log</h1>
      <p className="mt-2 text-gray-700 dark:text-gray-300">Every change to shifts, employees, role settings and pay periods, newest first.</p>
      <label className="mt-4 inline-flex items-center gap-2">
        <span className="text-gray-600 dark:text-gray-300">show</span>
        <select value={type} onChange={e => setType(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 dark:bg-gray-800 dark:border-gray-700 dark:text-white">
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      {error && <div className="mt-4 rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-900/50 dark:text-red-200">{error}</div>}
      {loading ? <LoadingSpinner /> : (
        <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white/50 dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800/50">
          {entries.length === 0 && <li className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">Nothing yet.</li>}
          {entries.map(e => (
            <li key={e.id} className="px-4 py-3">
              <p className="text-[var(--foreground)]">{e.summary}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{when.format(new Date(e.at))}{e.actorName ? ` · ${e.actorName}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button onClick={() => load(next)} className="mt-4 rounded-md px-3 py-1.5 ring-1 ring-gray-300 hover:bg-gray-50 dark:ring-gray-700 dark:hover:bg-gray-800">older</button>
      )}
    </div>
  )
}
