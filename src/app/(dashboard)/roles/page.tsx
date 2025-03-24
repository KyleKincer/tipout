'use client'

import { useState, useEffect } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'

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
    return <div>Loading...</div>
  }

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Roles</h1>
          <p className="mt-2 text-sm text-gray-700">
            A list of all roles and their tipout configurations.
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Use the <span className="font-medium">Edit Role</span> button to access advanced configuration options including whether roles pay or receive tipouts.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <button
            type="button"
            onClick={() => setIsAddingRole(true)}
            className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <PlusIcon className="h-5 w-5 inline-block mr-1" />
            Add role
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

      {isAddingRole && (
        <div className="mt-4 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <form onSubmit={handleAddRole} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="name"
                    id="name"
                    value={newRole.name}
                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="Enter role name"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="basePayRate" className="block text-sm font-medium text-gray-700">
                  Base Pay Rate ($/hr)
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="basePayRate"
                    id="basePayRate"
                    value={newRole.basePayRate}
                    onChange={(e) => setNewRole({ ...newRole, basePayRate: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="Enter base pay rate"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAddingRole(false)}
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

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                      Role
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Base Pay Rate
                    </th>
                    {TIPOUT_TYPES.map((type) => (
                      <th key={type.id} scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        {type.name}
                      </th>
                    ))}
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                        {role.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {editingRole?.roleId === role.id ? (
                          <form onSubmit={(e) => handleUpdateRolePayRate(e, role.id)} className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={editingRole.basePayRate}
                              onChange={(e) => setEditingRole({ ...editingRole, basePayRate: e.target.value })}
                              className="block w-24 rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                              placeholder="Pay rate"
                              step="0.01"
                              min="0"
                            />
                            <button
                              type="submit"
                              className="text-indigo-600 hover:text-indigo-900"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingRole(null)}
                              className="text-gray-500 hover:text-gray-700"
                            >
                              Cancel
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
                              className="text-indigo-600 hover:text-indigo-900 ml-2"
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </td>
                      {TIPOUT_TYPES.map((type) => {
                        const config = getActiveConfig(role, type.id)
                        return (
                          <td key={type.id} className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                            {editingConfig?.roleId === role.id && editingConfig?.tipoutType === type.id ? (
                              <form onSubmit={(e) => handleAddConfig(e, role.id, type.id)} className="flex items-center space-x-2">
                                <input
                                  type="number"
                                  value={editingConfig.percentageRate}
                                  onChange={(e) => setEditingConfig({ ...editingConfig, percentageRate: e.target.value })}
                                  className="block w-20 rounded-md border-gray-300 shadow-sm px-3 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                  placeholder="Rate %"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                />
                                <button
                                  type="submit"
                                  className="text-indigo-600 hover:text-indigo-900"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingConfig(null)}
                                  className="text-gray-500 hover:text-gray-700"
                                >
                                  Cancel
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
                                        className="text-indigo-600 hover:text-indigo-900"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => handleRemoveConfig(role.id, type.id)}
                                        className="text-red-600 hover:text-red-900"
                                      >
                                        Remove
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
                                    className="text-gray-500 hover:text-gray-700"
                                  >
                                    Add
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <a
                          href={`/roles/${role.id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900 mr-4"
                        >
                          Edit Role
                        </a>
                        <button
                          onClick={() => handleDeleteRole(role.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
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