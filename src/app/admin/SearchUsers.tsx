'use client'

import { usePathname, useRouter } from 'next/navigation'

export const SearchUsers = () => {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="mb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const formData = new FormData(form)
          const queryTerm = formData.get('search') as string
          router.push(pathname + '?search=' + queryTerm)
        }}
        className="flex gap-2 items-end"
      >
        <div>
          <label htmlFor="search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            search for users
          </label>
          <input 
            id="search" 
            name="search" 
            type="text" 
            className="shadow-sm focus:ring-blue-500 focus:border-blue-500 px-2 py-1 block w-full sm:text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md"
          />
        </div>
        <button 
          type="submit" 
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          search
        </button>
      </form>
    </div>
  )
} 