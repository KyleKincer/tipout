'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import LoadingSpinner from '@/components/LoadingSpinner'

type RoleConfig = {
  id?: string
  tipoutType: string
  percentageRate: number
  effectiveFrom: string
  effectiveTo: string | null
  receivesTipout: boolean
  paysTipout: boolean
  distributionGroup: string | null
}

export default function EditRolePage() {
  const params = useParams()
  const router = useRouter()
  const [role, setRole] = useState({
    id: '',
    name: '',
    basePayRate: 0
  })
  const [configs, setConfigs] = useState<RoleConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const tipoutTypes = ['bar', 'host', 'sa']
  const distributionGroups = ['bartenders', 'hosts', 'servers', 'support']

  useEffect(() => {
    if (params.id === 'new') {
      // Creating a new role
      setLoading(false)
      return
    }

    // Fetch existing role
    fetchRole()
    fetchConfigs()
  }, [params.id])

  const fetchRole = async () => {
    try {
      const response = await fetch(`/api/roles/${params.id}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to fetch role (Status: ${response.status})`;
        throw new Error(errorMessage);
      }
      
      const data = await response.json()
      setRole({
        id: data.id,
        name: data.name,
        basePayRate: Number(data.basePayRate)
      })
    } catch (err) {
      console.error('Error fetching role:', err)
      setError(`Failed to load role data: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const fetchConfigs = async () => {
    try {
      const response = await fetch(`/api/roles/${params.id}/config`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to fetch configurations (Status: ${response.status})`;
        throw new Error(errorMessage);
      }
      
      const data = await response.json()
      setConfigs(data.map((config: any) => ({
        ...config,
        percentageRate: Number(config.percentageRate),
        effectiveFrom: new Date(config.effectiveFrom).toISOString().split('T')[0],
        effectiveTo: config.effectiveTo ? new Date(config.effectiveTo).toISOString().split('T')[0] : null
      })))
    } catch (err) {
      console.error('Error fetching configs:', err)
      setError(`Failed to load role configurations: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleConfigChange = (index: number, field: string, value: any) => {
    const updatedConfigs = [...configs]
    // @ts-ignore: Needed to set dynamic field
    updatedConfigs[index][field] = value
    setConfigs(updatedConfigs)
  }

  const addConfig = () => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const newConfig: RoleConfig = {
      tipoutType: 'bar',
      percentageRate: 0,
      effectiveFrom: today,
      effectiveTo: null,
      receivesTipout: false,
      paysTipout: true,
      distributionGroup: null
    }
    setConfigs([...configs, newConfig])
  }

  const removeConfig = (index: number) => {
    const updatedConfigs = [...configs]
    updatedConfigs.splice(index, 1)
    setConfigs(updatedConfigs)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    try {
      // Save the role
      const roleResponse = await fetch(`/api/roles/${params.id === 'new' ? '' : params.id}`, {
        method: params.id === 'new' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(role),
      })
      
      if (!roleResponse.ok) {
        const errorData = await roleResponse.json().catch(() => ({}))
        const errorMessage = errorData.error || `Failed to save role (Status: ${roleResponse.status})`
        throw new Error(errorMessage)
      }
      
      const savedRole = await roleResponse.json()
      const roleId = savedRole.id
      
      // Save the configurations
      if (roleId) {
        const configResponse = await fetch(`/api/roles/${roleId}/config`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(configs),
        })
        
        if (!configResponse.ok) {
          const errorData = await configResponse.json().catch(() => ({}))
          const errorMessage = errorData.error || `Failed to save role configurations (Status: ${configResponse.status})`
          throw new Error(errorMessage)
        }
      }
      
      router.push('/roles')
    } catch (err) {
      console.error('Error saving role:', err)
      setError(`Failed to save role data: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  if (loading) {
    return <LoadingSpinner />
  }

  return (
    <div>
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-[var(--foreground)] sm:truncate sm:text-3xl sm:tracking-tight">
            {params.id === 'new' ? 'Create Role' : 'Edit Role'}
          </h2>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/50 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-8 divide-y divide-gray-200 dark:divide-gray-700">
        <div className="space-y-8 divide-y divide-gray-200 dark:divide-gray-700">
          <div>
            <div>
              <h3 className="text-lg font-medium leading-6 text-[var(--foreground)]">Role Information</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Basic information about the role.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
              <div className="sm:col-span-3">
                <label htmlFor="name" className="block text-sm font-medium text-[var(--foreground)]">
                  Role Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="name"
                    id="name"
                    value={role.name}
                    onChange={(e) => setRole({ ...role, name: e.target.value })}
                    required
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white px-3 py-2"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="basePayRate" className="block text-sm font-medium text-[var(--foreground)]">
                  Base Pay Rate
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="basePayRate"
                    id="basePayRate"
                    step="0.01"
                    min="0"
                    value={role.basePayRate}
                    onChange={(e) => setRole({ ...role, basePayRate: parseFloat(e.target.value) })}
                    required
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white px-3 py-2"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-8">
            <div>
              <h3 className="text-lg font-medium leading-6 text-[var(--foreground)]">Tipout Settings</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Configure how this role interacts with tipouts.
              </p>
            </div>

            {/* Tipouts This Role Pays */}
            <div className="mt-6 p-4 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <h4 className="text-md font-medium text-[var(--foreground)]">Tipouts This Role Pays</h4>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Configure what percentage this role pays to other roles.
              </p>

              <div className="mt-4 space-y-4">
                {['bar', 'host', 'sa'].map(type => {
                  const config = configs.find(c => 
                    c.tipoutType === type && c.paysTipout && !c.receivesTipout
                  ) || {
                    tipoutType: type,
                    percentageRate: 0,
                    paysTipout: false,
                    receivesTipout: false,
                    effectiveFrom: new Date().toISOString().split('T')[0],
                    effectiveTo: null,
                    distributionGroup: null
                  }

                  return (
                    <div key={type} className="flex items-center space-x-4">
                      <input
                        type="checkbox"
                        id={`pays-${type}`}
                        checked={config.paysTipout}
                        onChange={(e) => {
                          const updatedConfigs = [...configs]
                          const index = configs.findIndex(c => 
                            c.tipoutType === type && c.paysTipout && !c.receivesTipout
                          )
                          
                          if (e.target.checked) {
                            if (index === -1) {
                              updatedConfigs.push({
                                ...config,
                                paysTipout: true,
                                receivesTipout: false
                              })
                            } else {
                              updatedConfigs[index] = {
                                ...updatedConfigs[index],
                                paysTipout: true,
                                receivesTipout: false
                              }
                            }
                          } else if (index !== -1) {
                            updatedConfigs.splice(index, 1)
                          }
                          
                          setConfigs(updatedConfigs)
                        }}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded dark:border-gray-600"
                      />
                      <label htmlFor={`pays-${type}`} className="min-w-[120px] text-sm font-medium text-[var(--foreground)]">
                        {type === 'bar' ? 'Bar Tipout' : 
                         type === 'host' ? 'Host Tipout' : 
                         'SA Tipout'}
                      </label>
                      <div className={`flex items-center space-x-2 transition-opacity duration-200 ${config.paysTipout ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <input
                          type="number"
                          value={config.percentageRate}
                          onChange={(e) => {
                            const updatedConfigs = [...configs]
                            const index = configs.findIndex(c => 
                              c.tipoutType === type && c.paysTipout && !c.receivesTipout
                            )
                            
                            if (index !== -1) {
                              updatedConfigs[index] = {
                                ...updatedConfigs[index],
                                percentageRate: parseFloat(e.target.value)
                              }
                            } else {
                              updatedConfigs.push({
                                ...config,
                                percentageRate: parseFloat(e.target.value),
                                paysTipout: true,
                                receivesTipout: false
                              })
                            }
                            
                            setConfigs(updatedConfigs)
                          }}
                          step="0.1"
                          min="0"
                          max="100"
                          className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white px-3 py-2"
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-400">% of {type === 'bar' ? 'liquor sales' : 'total tips'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Tipouts This Role Receives */}
            <div className="mt-6 p-4 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <h4 className="text-md font-medium text-[var(--foreground)]">Tipouts This Role Receives</h4>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Configure which tipout pools this role receives from.
              </p>

              <div className="mt-4 space-y-4">
                {['bar', 'host', 'sa'].map(type => {
                  const config = configs.find(c => 
                    c.tipoutType === type && c.receivesTipout && !c.paysTipout
                  ) || {
                    tipoutType: type,
                    percentageRate: 0,
                    paysTipout: false,
                    receivesTipout: false,
                    effectiveFrom: new Date().toISOString().split('T')[0],
                    effectiveTo: null,
                    distributionGroup: null
                  }

                  return (
                    <div key={type} className="flex items-center space-x-4">
                      <input
                        type="checkbox"
                        id={`receives-${type}`}
                        checked={config.receivesTipout}
                        onChange={(e) => {
                          const updatedConfigs = [...configs]
                          const index = configs.findIndex(c => 
                            c.tipoutType === type && c.receivesTipout && !c.paysTipout
                          )
                          
                          if (e.target.checked) {
                            if (index === -1) {
                              updatedConfigs.push({
                                ...config,
                                receivesTipout: true,
                                paysTipout: false,
                                distributionGroup: type === 'bar' ? 'bartenders' :
                                                 type === 'host' ? 'hosts' :
                                                 'support'
                              })
                            } else {
                              updatedConfigs[index] = {
                                ...updatedConfigs[index],
                                receivesTipout: true,
                                paysTipout: false
                              }
                            }
                          } else if (index !== -1) {
                            updatedConfigs.splice(index, 1)
                          }
                          
                          setConfigs(updatedConfigs)
                        }}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded dark:border-gray-600"
                      />
                      <label htmlFor={`receives-${type}`} className="min-w-[120px] text-sm font-medium text-[var(--foreground)]">
                        {type === 'bar' ? 'Bar Tipout' : 
                         type === 'host' ? 'Host Tipout' : 
                         'SA Tipout'}
                      </label>
                      <div className={`flex items-center space-x-2 transition-opacity duration-200 ${config.receivesTipout ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <select
                          value={config.distributionGroup || ''}
                          onChange={(e) => {
                            const updatedConfigs = [...configs]
                            const index = configs.findIndex(c => 
                              c.tipoutType === type && c.receivesTipout && !c.paysTipout
                            )
                            
                            if (index !== -1) {
                              updatedConfigs[index] = {
                                ...updatedConfigs[index],
                                distributionGroup: e.target.value || null
                              }
                            } else {
                              updatedConfigs.push({
                                ...config,
                                distributionGroup: e.target.value || null,
                                receivesTipout: true,
                                paysTipout: false
                              })
                            }
                            
                            setConfigs(updatedConfigs)
                          }}
                          className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white px-3 py-2"
                        >
                          <option value="">No pool</option>
                          <option value="bartenders">Bartenders</option>
                          <option value="hosts">Hosts</option>
                          <option value="support">Support Staff</option>
                        </select>
                        <span className="text-sm text-gray-500 dark:text-gray-400">sharing pool</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 rounded-md bg-yellow-50 dark:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-800 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400 dark:text-yellow-300" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Important Notes</h3>
                  <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Bar tipout is calculated as a percentage of liquor sales</li>
                      <li>Host and SA tipouts are calculated as a percentage of total tips</li>
                      <li>Roles in the same sharing pool split their tipouts based on hours worked</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-5">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => router.push('/roles')}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ml-3 inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
} 