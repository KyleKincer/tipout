'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'

type Employee = {
  id: string
  name: string
}

type RoleConfiguration = {
  tipoutType: string
  percentageRate: number
}

type Role = {
  id: string
  name: string
  configs: RoleConfiguration[]
}

type ShiftFormData = {
  employeeId: string
  roleId: string
  date: string
  hours: number
  cashTips: number
  creditTips: number
  liquorSales: number
}

type ShiftEntryFormProps = {
  initialData?: ShiftFormData
  onSubmit?: (data: ShiftFormData) => Promise<void>
}

export default function ShiftEntryForm({ initialData, onSubmit }: ShiftEntryFormProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<ShiftFormData>({
    defaultValues: initialData || {
      date: format(new Date(), 'yyyy-MM-dd'),
    },
  })

  const [isSubmitting, setIsSubmitting] = useState(false)

  // Watch for role changes to update selectedRole
  const roleId = watch('roleId')

  useEffect(() => {
    if (roleId) {
      const role = roles.find(r => r.id === roleId)
      setSelectedRole(role || null)
    } else {
      setSelectedRole(null)
    }
  }, [roleId, roles])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [employeesRes, rolesRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/roles'),
        ])

        if (!employeesRes.ok || !rolesRes.ok) {
          throw new Error('Failed to fetch data')
        }

        const [employeesData, rolesData] = await Promise.all([
          employeesRes.json(),
          rolesRes.json(),
        ])

        setEmployees(employeesData)
        setRoles(rolesData)
      } catch (err) {
        setError('Failed to load form data')
        console.error('Error loading form data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleFormSubmit = async (data: ShiftFormData) => {
    setIsSubmitting(true)
    try {
      if (onSubmit) {
        await onSubmit(data)
      } else {
        const response = await fetch('/api/shifts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          throw new Error('Failed to save shift')
        }

        const result = await response.json()
        console.log('Shift saved:', result)
        reset()
      }
    } catch (error) {
      console.error('Error submitting shift:', error)
      setError('Failed to save shift')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  // Helper function to check if a field is required based on role configurations
  const isFieldRequired = (field: keyof ShiftFormData) => {
    if (!selectedRole) return false

    switch (field) {
      case 'cashTips':
      case 'creditTips':
        return selectedRole.configs.some(config => 
          config.tipoutType === 'host' || config.tipoutType === 'sa'
        )
      case 'liquorSales':
        return selectedRole.configs.some(config => 
          config.tipoutType === 'bar'
        )
      case 'hours':
        return true // Hours are always required
      default:
        return false
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl md:col-span-2">
        <div className="px-4 py-6 sm:p-8">
          <div className="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label htmlFor="employeeId" className="block text-sm font-medium leading-6 text-gray-900">
                Employee
              </label>
              <div className="mt-2">
                <select
                  {...register('employeeId', { required: 'Employee is required' })}
                  id="employeeId"
                  className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:max-w-xs sm:text-sm sm:leading-6"
                >
                  <option value="">Select employee...</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
                {errors.employeeId && (
                  <p className="mt-2 text-sm text-red-600">{errors.employeeId.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="roleId" className="block text-sm font-medium leading-6 text-gray-900">
                Role
              </label>
              <div className="mt-2">
                <select
                  {...register('roleId', { required: 'Role is required' })}
                  id="roleId"
                  className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:max-w-xs sm:text-sm sm:leading-6"
                >
                  <option value="">Select role...</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                {errors.roleId && (
                  <p className="mt-2 text-sm text-red-600">{errors.roleId.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="date" className="block text-sm font-medium leading-6 text-gray-900">
                Date
              </label>
              <div className="mt-2">
                <input
                  {...register('date', { required: 'Date is required' })}
                  type="date"
                  id="date"
                  className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
                {errors.date && (
                  <p className="mt-2 text-sm text-red-600">{errors.date.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="hours" className="block text-sm font-medium leading-6 text-gray-900">
                Hours
              </label>
              <div className="mt-2">
                <input
                  {...register('hours', {
                    required: 'Hours are required',
                    min: { value: 0, message: 'Hours must be positive' },
                  })}
                  type="number"
                  step="0.01"
                  id="hours"
                  className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
                {errors.hours && (
                  <p className="mt-2 text-sm text-red-600">{errors.hours.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="cashTips" className="block text-sm font-medium leading-6 text-gray-900">
                Cash Tips
              </label>
              <div className="mt-2">
                <input
                  {...register('cashTips', {
                    required: isFieldRequired('cashTips') ? 'Cash tips amount is required' : false,
                    min: { value: 0, message: 'Cash tips must be positive' },
                  })}
                  type="number"
                  step="0.01"
                  id="cashTips"
                  disabled={!isFieldRequired('cashTips')}
                  className={`block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 ${
                    !isFieldRequired('cashTips') ? 'bg-gray-50 text-gray-500' : ''
                  }`}
                />
                {errors.cashTips && (
                  <p className="mt-2 text-sm text-red-600">{errors.cashTips.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="creditTips" className="block text-sm font-medium leading-6 text-gray-900">
                Credit Tips
              </label>
              <div className="mt-2">
                <input
                  {...register('creditTips', {
                    required: isFieldRequired('creditTips') ? 'Credit tips amount is required' : false,
                    min: { value: 0, message: 'Credit tips must be positive' },
                  })}
                  type="number"
                  step="0.01"
                  id="creditTips"
                  disabled={!isFieldRequired('creditTips')}
                  className={`block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 ${
                    !isFieldRequired('creditTips') ? 'bg-gray-50 text-gray-500' : ''
                  }`}
                />
                {errors.creditTips && (
                  <p className="mt-2 text-sm text-red-600">{errors.creditTips.message}</p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="liquorSales" className="block text-sm font-medium leading-6 text-gray-900">
                Liquor Sales
              </label>
              <div className="mt-2">
                <input
                  {...register('liquorSales', {
                    required: isFieldRequired('liquorSales') ? 'Liquor sales amount is required' : false,
                    min: { value: 0, message: 'Liquor sales must be positive' },
                  })}
                  type="number"
                  step="0.01"
                  id="liquorSales"
                  disabled={!isFieldRequired('liquorSales')}
                  className={`block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 ${
                    !isFieldRequired('liquorSales') ? 'bg-gray-50 text-gray-500' : ''
                  }`}
                />
                {errors.liquorSales && (
                  <p className="mt-2 text-sm text-red-600">{errors.liquorSales.message}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-x-6 border-t border-gray-900/10 px-4 py-4 sm:px-8">
          <button
            type="button"
            onClick={() => reset()}
            className="text-sm font-semibold leading-6 text-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  )
} 