'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from 'convex/react'
import { use } from 'react'
import { XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'

type EmployeeFormState = {
  id: Id<'employees'>
  name: string
  active: boolean
  defaultRoleId: Id<'roles'> | null
}

export default function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const employeeId = id as Id<'employees'>

  const employeeData = useQuery(api.employees.get, { id: employeeId })
  const roles = useQuery(api.roles.list)
  const updateEmployee = useMutation(api.employees.update)

  const [employee, setEmployee] = useState<EmployeeFormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (employeeData) {
      setEmployee({
        id: employeeData.id,
        name: employeeData.name,
        active: employeeData.active,
        defaultRoleId: employeeData.defaultRoleId,
      })
    }
  }, [employeeData])

  const handleInputChange = (field: keyof EmployeeFormState, value: string | boolean | null) => {
    if (!employee) return

    setEmployee({
      id: employee.id,
      name: field === 'name' ? (value as string) : employee.name,
      active: field === 'active' ? (value as boolean) : employee.active,
      defaultRoleId:
        field === 'defaultRoleId' ? (value as Id<'roles'> | null) : employee.defaultRoleId,
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee) return

    setIsSubmitting(true)
    try {
      await updateEmployee({
        id: employee.id,
        name: employee.name,
        active: employee.active,
        defaultRoleId: employee.defaultRoleId,
      })

      router.push('/employees')
      router.refresh()
    } catch (err) {
      setError('Failed to update employee')
      console.error('Error updating employee:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = employeeData === undefined || roles === undefined

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
      ) : !employee || employeeData === null ? (
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
                      onChange={(e) =>
                        handleInputChange(
                          'defaultRoleId',
                          e.target.value ? (e.target.value as Id<'roles'>) : null,
                        )
                      }
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
