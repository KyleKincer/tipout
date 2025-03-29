'use client'

import { useState, useEffect } from 'react'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import LoadingSpinner from '@/components/LoadingSpinner'
import { AdminOnly } from '@/components/RoleBasedUI'

type Role = {
  id: string
  name: string
}

type Employee = {
  id: string
  name: string
  active: boolean
  defaultRoleId: string | null
  defaultRole?: Role
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAddingEmployee, setIsAddingEmployee] = useState(false)
  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null)

  useEffect(() => {
    fetchEmployees()
  }, [])

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees')
      if (!response.ok) {
        throw new Error('Failed to fetch employees')
      }
      const data = await response.json()
      setEmployees(data)
    } catch (err) {
      setError('Failed to load employees')
      console.error('Error loading employees:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmployeeName.trim()) return

    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newEmployeeName.trim() }),
      })

      if (!response.ok) {
        throw new Error('Failed to add employee')
      }

      const newEmployee = await response.json()
      setEmployees([...employees, newEmployee])
      setNewEmployeeName('')
      setIsAddingEmployee(false)
    } catch (err) {
      setError('Failed to add employee')
      console.error('Error adding employee:', err)
    }
  }

  const handleDeleteEmployee = async () => {
    if (!employeeToDelete) return

    try {
      const response = await fetch(`/api/employees/${employeeToDelete.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete employee')
      }

      setEmployees(employees.filter(emp => emp.id !== employeeToDelete.id))
      setShowDeleteConfirm(false)
      setEmployeeToDelete(null)
    } catch (err) {
      setError('Failed to delete employee')
      console.error('Error deleting employee:', err)
    }
  }

  if (isLoading) {
    return <LoadingSpinner />
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">employees</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            a list of all employees in your restaurant.
          </p>
        </div>
        <AdminOnly>
          <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
            <button
              type="button"
            onClick={() => setIsAddingEmployee(true)}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <PlusIcon className="h-5 w-5 inline-block mr-1" />
              add employee
            </button>
          </div>
        </AdminOnly>
      </div>

      {error && (
        <div className="mt-8 rounded-md bg-red-50 dark:bg-red-900/50 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
            </div>
          </div>
        </div>
      )}

      {isAddingEmployee && (
        <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-base font-medium text-[var(--foreground)] mb-4">add new employee</h3>
            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-[var(--foreground)]">
                  name <span className="text-red-500">*</span>
                </label>
                <div className="mt-2">
                  <input
                    type="text"
                    name="name"
                    id="name"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    placeholder="enter employee name"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAddingEmployee(false)}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && employeeToDelete && (
        <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-base font-medium text-[var(--foreground)] mb-4">
              delete employee
            </h3>
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              <p>are you sure you want to delete {employeeToDelete.name}? this action cannot be undone.</p>
            </div>
            <div className="mt-5 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setEmployeeToDelete(null)
                }}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEmployee}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
            <thead className="bg-gray-50/75 dark:bg-gray-800/75">
              <tr>
                <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">
                  name
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                  status
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                  default role
                </th>
                <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                  <span className="sr-only">actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {employees.map((employee) => (
                <tr key={employee.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[var(--foreground)] sm:pl-6">
                    {employee.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                      employee.active
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                    }`}>
                      {employee.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {employee.defaultRole?.name || 'none'}
                  </td>
                  <AdminOnly>
                  <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                    <Link
                      href={`/employees/${employee.id}/edit`}
                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                    >
                      edit
                    </Link>
                    <button
                      onClick={() => {
                        setEmployeeToDelete(employee)
                        setShowDeleteConfirm(true)
                      }}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                    >
                      delete
                    </button>
                  </td>
                  </AdminOnly>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
} 