'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { LoadingWrapper } from './components/LoadingWrapper'

export const SearchUsers = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    
    startTransition(() => {
      // Construct the new URL with the search param
      const params = new URLSearchParams(searchParams)
      if (searchValue) {
        params.set('search', searchValue)
      } else {
        params.delete('search')
      }
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  // Loading fallback for the search results
  const searchFallback = (
    <div className="mb-6">
      <form className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-grow relative">
          <label htmlFor="search-loading" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            search for users
          </label>
          <input 
            id="search-loading" 
            type="text" 
            value={searchValue}
            className="shadow-sm focus:ring-blue-500 focus:border-blue-500 px-2 py-1 block w-full sm:text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md cursor-not-allowed opacity-70"
            disabled
          />
          <div className="absolute right-3 top-[60%] transform -translate-y-1/2">
            <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        </div>
        <button 
          type="button" 
          className="inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-blue-600 opacity-70 cursor-not-allowed"
          disabled
        >
          searching...
        </button>
      </form>
    </div>
  )

  return (
    <LoadingWrapper isLoading={isPending} fallback={searchFallback}>
      <div className="mb-6">
        <form
          onSubmit={handleSearch}
          className="flex flex-col sm:flex-row gap-2 sm:items-end"
        >
          <div className="flex-grow relative">
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              search for users
            </label>
            <input 
              id="search" 
              name="search" 
              type="text" 
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 px-2 py-1 block w-full sm:text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md"
            />
          </div>
          <button 
            type="submit" 
            className="inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            search
          </button>
        </form>
      </div>
    </LoadingWrapper>
  )
} 