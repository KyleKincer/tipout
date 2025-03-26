'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import { use } from 'react'
import { XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

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

  const handleInputChange = (field: keyof Employee, value: string | boolean | null) => {
    if (!employee) return

    setEmployee({
      id: employee.id,
      name: field === 'name' ? value as string : employee.name,
      active: field === 'active' ? value as boolean : employee.active,
      defaultRoleId: field === 'defaultRoleId' ? value as string | null : employee.defaultRoleId
    })
  }

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

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Edit Employee</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Update employee information and settings.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : error ? (
        <div className="mt-8 rounded-md bg-red-50 dark:bg-red-900/50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <XCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
            </div>
          </div>
        </div>
      ) : !employee ? (
        <div className="mt-8 rounded-md bg-yellow-50 dark:bg-yellow-900/50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Employee not found</h3>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="bg-white dark:bg-gray-900 shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="name"
                      id="name"
                      value={employee.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      placeholder="Enter employee name"
                      required
                    />
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Status <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1">
                    <select
                      name="status"
                      id="status"
                      value={employee.active ? 'active' : 'inactive'}
                      onChange={(e) => handleInputChange('active', e.target.value === 'active')}
                      className="block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      required
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor="defaultRole" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Default Role
                  </label>
                  <div className="mt-1">
                    <select
                      name="defaultRole"
                      id="defaultRole"
                      value={employee.defaultRoleId || ''}
                      onChange={(e) => handleInputChange('defaultRoleId', e.target.value || null)}
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
              </div>
            </div>
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 text-right sm:px-6">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
} 