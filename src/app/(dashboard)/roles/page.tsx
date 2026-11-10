'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PlusIcon } from '@heroicons/react/24/outline'
import LoadingSpinner from '@/components/LoadingSpinner'
import { AdminOnly } from '@/components/RoleBasedUI'
import { formatDay } from '@/utils/dateLabels'

type RoleRow = {
  id: string
  name: string
  active: boolean
  summary: string
  settingsFrom: string | null
  upcomingChange: { effectiveFrom: string; summary: string } | null
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/roles')
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || 'Failed to load roles'))))
      .then(setRoles)
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) return <LoadingSpinner />

  const active = roles.filter(r => r.active)
  const archived = roles.filter(r => !r.active)

  const list = (rows: RoleRow[]) => (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {rows.map(role => (
        <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-[var(--foreground)]">{role.name}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{role.summary}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {role.settingsFrom ? `in effect since ${formatDay(role.settingsFrom)}` : 'no settings in effect today'}
              {role.upcomingChange && <> · changes on {formatDay(role.upcomingChange.effectiveFrom)}</>}
            </p>
          </div>
          <AdminOnly>
            <Link href={`/roles/${role.id}/edit`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              history &amp; settings
            </Link>
          </AdminOnly>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">roles</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            what each role pays, receives and pools today. Settings changes start on a date you choose, so past shifts keep the settings they were paid with.
          </p>
        </div>
        <AdminOnly>
          <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
            <Link href="/roles/new/edit" className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              <PlusIcon className="mr-1 h-5 w-5" /> add role
            </Link>
          </div>
        </AdminOnly>
      </div>

      {error && <div className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/50 dark:text-red-200">{error}</div>}

      <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">{list(active)}</div>

      {archived.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-gray-500 dark:text-gray-400">archived</h2>
          <div className="mt-2 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 opacity-80">{list(archived)}</div>
        </>
      )}
    </div>
  )
}
