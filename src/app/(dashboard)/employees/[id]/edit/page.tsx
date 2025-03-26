'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import { use } from 'react'

type Role = {
  id: string
  name: string
}

type Employee = {
  id: string
  name: string
  active: boolean
  defaultRoleId: string | null
}

export default function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { id } = use(params)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [employeeRes, rolesRes] = await Promise.all([
          fetch(`/api/employees/${id}`),
          fetch('/api/roles')
        ])

        if (!employeeRes.ok || !rolesRes.ok) {
          throw new Error('Failed to fetch data')
        }

        const [employeeData, rolesData] = await Promise.all([
          employeeRes.json(),
          rolesRes.json()
        ])

        setEmployee(employeeData)
        setRoles(rolesData)
      } catch (err) {
        setError('Failed to load data')
        console.error('Error loading data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee) return

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: employee.name,
          active: employee.active,
          defaultRoleId: employee.defaultRoleId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update employee')
      }

      router.push('/employees')
      router.refresh()
    } catch (err) {
      setError('Failed to update employee')
      console.error('Error updating employee:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-900/50 p-4">
        <div className="flex">
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
          </div>
        </div>
      </div>
    )
  }

  if (!employee) {
    return <div>Employee not found</div>
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Edit Employee</h1>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          Update employee information.
        </p>
      </div>

      <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-[var(--foreground)]">
                Name
              </label>
              <div className="mt-1">
                <input
                  type="text"
                  name="name"
                  id="name"
                  value={employee.name}
                  onChange={(e) => setEmployee({ ...employee, name: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Status
              </label>
              <div className="mt-1">
                <select
                  value={employee.active ? 'active' : 'inactive'}
                  onChange={(e) => setEmployee({ ...employee, active: e.target.value === 'active' })}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="defaultRole" className="block text-sm font-medium text-[var(--foreground)]">
                Default Role
              </label>
              <div className="mt-1">
                <select
                  id="defaultRole"
                  value={employee.defaultRoleId || ''}
                  onChange={(e) => setEmployee({ ...employee, defaultRoleId: e.target.value || null })}
                  className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="">No default role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => router.push('/employees')}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
} 