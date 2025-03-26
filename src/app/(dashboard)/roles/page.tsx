'use client'

import { useState, useEffect } from 'react'
import { PlusIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import LoadingSpinner from '@/components/LoadingSpinner'

type Role = {
  id: string
  name: string
  basePayRate: number
  configs: RoleConfiguration[]
}

type RoleConfiguration = {
  id: string
  tipoutType: string
  percentageRate: number
  effectiveFrom: string
  effectiveTo: string | null
}

const TIPOUT_TYPES = [
  { id: 'bar', name: 'Bar Tipout', description: 'Percentage of liquor sales' },
  { id: 'host', name: 'Host Tipout', description: 'Percentage of total tips' },
  { id: 'sa', name: 'Server Assistant Tipout', description: 'Percentage of total tips' },
]

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAddingRole, setIsAddingRole] = useState(false)
  const [newRole, setNewRole] = useState({ name: '', basePayRate: '' })
  const [editingConfig, setEditingConfig] = useState<{
    roleId: string
    tipoutType: string
    percentageRate: string
  } | null>(null)
  const [editingRole, setEditingRole] = useState<{
    roleId: string
    basePayRate: string
  } | null>(null)

  useEffect(() => {
    fetchRoles()
  }, [])

  const fetchRoles = async () => {
    try {
      const response = await fetch('/api/roles')
      if (!response.ok) {
        throw new Error('Failed to fetch roles')
      }
      const data = await response.json()
      setRoles(data)
    } catch (err) {
      setError('Failed to load roles')
      console.error('Error loading roles:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRole.name.trim() || !newRole.basePayRate) return

    try {
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newRole.name.trim(),
          basePayRate: Number(newRole.basePayRate),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to add role')
      }

      const newRoleData = await response.json()
      setRoles([...roles, newRoleData])
      setNewRole({ name: '', basePayRate: '' })
      setIsAddingRole(false)
    } catch (err) {
      setError('Failed to add role')
      console.error('Error adding role:', err)
    }
  }

  const handleAddConfig = async (e: React.FormEvent, roleId: string, tipoutType: string) => {
    e.preventDefault()
    if (!editingConfig?.percentageRate) return

    try {
      const response = await fetch(`/api/roles/${roleId}/configurations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tipoutType,
          percentageRate: parseFloat(editingConfig.percentageRate),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to add configuration')
      }

      const newConfigData = await response.json()
      
      setRoles(roles.map(role => {
        if (role.id === roleId) {
          const updatedConfigs = role.configs.map(config => {
            if (config.tipoutType === tipoutType && config.effectiveTo === null) {
              return { ...config, effectiveTo: format(new Date(), 'yyyy-MM-dd') };
            }
            return config;
          });
          
          return {
            ...role,
            configs: [...updatedConfigs, newConfigData],
          }
        }
        return role
      }))
      
      setEditingConfig(null)
    } catch (err) {
      setError('Failed to add configuration')
      console.error('Error adding configuration:', err)
    }
  }

  const handleRemoveConfig = async (roleId: string, tipoutType: string) => {
    if (!confirm('Are you sure you want to remove this tipout configuration?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/roles/${roleId}/configurations?tipoutType=${tipoutType}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove configuration');
      }

      setRoles(roles.map(role => {
        if (role.id === roleId) {
          const updatedConfigs = role.configs.map(config => {
            if (config.tipoutType === tipoutType && config.effectiveTo === null) {
              return { ...config, effectiveTo: format(new Date(), 'yyyy-MM-dd') };
            }
            return config;
          });
          
          return {
            ...role,
            configs: updatedConfigs,
          };
        }
        return role;
      }));
    } catch (err) {
      setError('Failed to remove configuration');
      console.error('Error removing configuration:', err);
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!confirm('Are you sure you want to delete this role and all its tipout configurations? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete role');
      }
      
      setRoles(roles.filter(role => role.id !== roleId));
    } catch (err) {
      setError('Failed to delete role');
      console.error('Error deleting role:', err);
    }
  };

  const getActiveConfig = (role: Role, tipoutType: string) => {
    return role.configs.find(config => 
      config.tipoutType === tipoutType && config.effectiveTo === null
    )
  }

  const handleUpdateRolePayRate = async (e: React.FormEvent, roleId: string) => {
    e.preventDefault()
    if (!editingRole?.basePayRate) return
    
    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          basePayRate: parseFloat(editingRole.basePayRate),
        }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to update role')
      }
      
      const updatedRole = await response.json()
      
      setRoles(roles.map(role => 
        role.id === roleId ? updatedRole : role
      ))
      
      setEditingRole(null)
    } catch (err) {
      setError('Failed to update role')
      console.error('Error updating role:', err)
    }
  }

  if (isLoading) {
    return <LoadingSpinner />
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">roles</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            a list of all roles and their tipout configurations.
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            use the <span className="font-medium">edit role</span> button to access advanced configuration options including whether roles pay or receive tipouts.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <button
            type="button"
            onClick={() => setIsAddingRole(true)}
            className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <PlusIcon className="h-5 w-5 inline-block mr-1" />
            add role
          </button>
        </div>
      </div>

      {error && (
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
      )}

      {isAddingRole && (
        <div className="mt-8 bg-white dark:bg-gray-900 shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4">add new role</h3>
            <form onSubmit={handleAddRole} className="space-y-4">
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    name <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="name"
                      id="name"
                      value={newRole.name}
                      onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      placeholder="enter role name"
                      required
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="basePayRate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    base pay rate ($/hr) <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1">
                    <input
                      type="number"
                      name="basePayRate"
                      id="basePayRate"
                      value={newRole.basePayRate}
                      onChange={(e) => setNewRole({ ...newRole, basePayRate: e.target.value })}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      placeholder="enter base pay rate"
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAddingRole(false)}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="mt-8 bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-4 md:p-0">
          {/* Table view for larger screens */}
          <div className="hidden md:block">
            <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th scope="col" className="py-3 pl-6 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                    role
                  </th>
                  <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                    base pay rate
                  </th>
                  {TIPOUT_TYPES.map((type) => (
                    <th key={type.id} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                      {type.name.toLowerCase()}
                    </th>
                  ))}
                  <th scope="col" className="relative py-3 pl-3 pr-6">
                    <span className="sr-only">actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {roles.map((role) => (
                  <tr key={role.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="whitespace-nowrap py-3 pl-6 pr-3 text-sm font-medium text-gray-900 dark:text-white">
                      {role.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {editingRole?.roleId === role.id ? (
                        <form onSubmit={(e) => handleUpdateRolePayRate(e, role.id)} className="flex items-center space-x-2">
                          <input
                            type="number"
                            value={editingRole.basePayRate}
                            onChange={(e) => setEditingRole({ ...editingRole, basePayRate: e.target.value })}
                            className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                            placeholder="Pay rate"
                            step="0.01"
                            min="0"
                          />
                          <button
                            type="submit"
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                          >
                            save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingRole(null)}
                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          >
                            cancel
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span>${role.basePayRate.toFixed(2)}/hr</span>
                          <button
                            onClick={() => setEditingRole({
                              roleId: role.id,
                              basePayRate: role.basePayRate.toString(),
                            })}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 ml-2"
                          >
                            edit
                          </button>
                        </div>
                      )}
                    </td>
                    {TIPOUT_TYPES.map((type) => {
                      const config = getActiveConfig(role, type.id)
                      return (
                        <td key={type.id} className="whitespace-nowrap px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {editingConfig?.roleId === role.id && editingConfig?.tipoutType === type.id ? (
                            <form onSubmit={(e) => handleAddConfig(e, role.id, type.id)} className="flex items-center space-x-2">
                              <input
                                type="number"
                                value={editingConfig.percentageRate}
                                onChange={(e) => setEditingConfig({ ...editingConfig, percentageRate: e.target.value })}
                                className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                                placeholder="rate %"
                                step="0.01"
                                min="0"
                                max="100"
                              />
                              <button
                                type="submit"
                                className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                              >
                                save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingConfig(null)}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                              >
                                cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center space-x-2">
                              {config ? (
                                <>
                                  <span className="mr-2">{config.percentageRate}%</span>
                                  <div className="flex space-x-2">
                                    <button
                                      onClick={() => setEditingConfig({
                                        roleId: role.id,
                                        tipoutType: type.id,
                                        percentageRate: config.percentageRate.toString(),
                                      })}
                                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                      edit
                                    </button>
                                    <button
                                      onClick={() => handleRemoveConfig(role.id, type.id)}
                                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                    >
                                      remove
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <button
                                  onClick={() => setEditingConfig({
                                    roleId: role.id,
                                    tipoutType: type.id,
                                    percentageRate: '',
                                  })}
                                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                                >
                                  add
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="relative whitespace-nowrap py-3 pl-3 pr-6 text-right text-sm font-medium">
                      <a
                        href={`/roles/${role.id}/edit`}
                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                      >
                        edit role
                      </a>
                      <button
                        onClick={() => handleDeleteRole(role.id)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card view for mobile screens */}
          <div className="md:hidden space-y-4 pb-4">
            {roles.map((role) => (
              <div
                key={role.id}
                className="bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <div className="px-4 py-4">
                  <div className="flex justify-between items-start">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {role.name}
                    </h3>
                    <div className="flex space-x-2">
                      <a
                        href={`/roles/${role.id}/edit`}
                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium"
                      >
                        edit role
                      </a>
                      <button
                        onClick={() => handleDeleteRole(role.id)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium"
                      >
                        delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-gray-200 dark:border-gray-700">
                    <dl className="divide-y divide-gray-200 dark:divide-gray-700">
                      <div className="py-4">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          base pay rate
                        </dt>
                        <dd className="mt-1 flex justify-between items-center">
                          {editingRole?.roleId === role.id ? (
                            <form onSubmit={(e) => handleUpdateRolePayRate(e, role.id)} className="flex items-center space-x-2">
                              <input
                                type="number"
                                value={editingRole.basePayRate}
                                onChange={(e) => setEditingRole({ ...editingRole, basePayRate: e.target.value })}
                                className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                                placeholder="Pay rate"
                                step="0.01"
                                min="0"
                              />
                              <button
                                type="submit"
                                className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                              >
                                save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingRole(null)}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                              >
                                cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center justify-between w-full">
                              <span className="text-sm text-gray-900 dark:text-white">${role.basePayRate.toFixed(2)}/hr</span>
                              <button
                                onClick={() => setEditingRole({
                                  roleId: role.id,
                                  basePayRate: role.basePayRate.toString(),
                                })}
                                className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium"
                              >
                                edit
                              </button>
                            </div>
                          )}
                        </dd>
                      </div>

                      {TIPOUT_TYPES.map((type) => {
                        const config = getActiveConfig(role, type.id)
                        return (
                          <div key={type.id} className="py-4">
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              {type.name.toLowerCase()}
                              <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                {type.description}
                              </span>
                            </dt>
                            <dd className="mt-1">
                              {editingConfig?.roleId === role.id && editingConfig?.tipoutType === type.id ? (
                                <form onSubmit={(e) => handleAddConfig(e, role.id, type.id)} className="flex items-center space-x-2">
                                  <input
                                    type="number"
                                    value={editingConfig.percentageRate}
                                    onChange={(e) => setEditingConfig({ ...editingConfig, percentageRate: e.target.value })}
                                    className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                                    placeholder="rate %"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                  />
                                  <button
                                    type="submit"
                                    className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                                  >
                                    save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingConfig(null)}
                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                                  >
                                    cancel
                                  </button>
                                </form>
                              ) : (
                                <div className="flex items-center justify-between">
                                  {config ? (
                                    <>
                                      <span className="text-sm text-gray-900 dark:text-white">{config.percentageRate}%</span>
                                      <div className="flex space-x-2">
                                        <button
                                          onClick={() => setEditingConfig({
                                            roleId: role.id,
                                            tipoutType: type.id,
                                            percentageRate: config.percentageRate.toString(),
                                          })}
                                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium"
                                        >
                                          edit
                                        </button>
                                        <button
                                          onClick={() => handleRemoveConfig(role.id, type.id)}
                                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium"
                                        >
                                          remove
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="flex justify-end w-full">
                                      <button
                                        onClick={() => setEditingConfig({
                                          roleId: role.id,
                                          tipoutType: type.id,
                                          percentageRate: '',
                                        })}
                                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium"
                                      >
                                        add
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
} 