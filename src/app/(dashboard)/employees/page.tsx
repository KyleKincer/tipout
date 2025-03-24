'use client'

import { useState, useEffect } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type Employee = {
  id: string
  name: string
  active: boolean
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAddingEmployee, setIsAddingEmployee] = useState(false)
  const [isEditingEmployee, setIsEditingEmployee] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
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

  const handleEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEmployee) return

    try {
      const response = await fetch(`/api/employees/${editingEmployee.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editingEmployee.name,
          active: editingEmployee.active,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update employee')
      }

      const updatedEmployee = await response.json()
      setEmployees(employees.map(emp => 
        emp.id === updatedEmployee.id ? updatedEmployee : emp
      ))
      setIsEditingEmployee(false)
      setEditingEmployee(null)
    } catch (err) {
      setError('Failed to update employee')
      console.error('Error updating employee:', err)
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
    return <div>Loading...</div>
  }

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Employees</h1>
          <p className="mt-2 text-sm text-gray-700">
            A list of all employees in your restaurant.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <button
            type="button"
            onClick={() => setIsAddingEmployee(true)}
            className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <PlusIcon className="h-5 w-5 inline-block mr-1" />
            Add employee
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">{error}</h3>
            </div>
          </div>
        </div>
      )}

      {isAddingEmployee && (
        <div className="mt-4 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="name"
                    id="name"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="Enter employee name"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAddingEmployee(false)}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditingEmployee && editingEmployee && (
        <div className="mt-4 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <form onSubmit={handleEditEmployee} className="space-y-4">
              <div>
                <label htmlFor="edit-name" className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="edit-name"
                    id="edit-name"
                    value={editingEmployee.name}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Status
                </label>
                <div className="mt-1">
                  <select
                    value={editingEmployee.active ? 'active' : 'inactive'}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, active: e.target.value === 'active' })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingEmployee(false)
                    setEditingEmployee(null)
                  }}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && employeeToDelete && (
        <div className="mt-4 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              Delete Employee
            </h3>
            <div className="mt-2 max-w-xl text-sm text-gray-500">
              <p>Are you sure you want to delete {employeeToDelete.name}? This action cannot be undone.</p>
            </div>
            <div className="mt-5 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setEmployeeToDelete(null)
                }}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEmployee}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Status
                    </th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {employees.map((employee) => (
                    <tr key={employee.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                        {employee.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                          employee.active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {employee.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button
                          onClick={() => {
                            setEditingEmployee(employee)
                            setIsEditingEmployee(true)
                          }}
                          className="text-indigo-600 hover:text-indigo-900 mr-4"
                        >
                          <PencilIcon className="h-5 w-5" />
                          <span className="sr-only">Edit</span>
                        </button>
                        <button
                          onClick={() => {
                            setEmployeeToDelete(employee)
                            setShowDeleteConfirm(true)
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          <TrashIcon className="h-5 w-5" />
                          <span className="sr-only">Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 