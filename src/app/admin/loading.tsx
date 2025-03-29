import React from 'react'

export default function Loading() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
      {/* Invitation Management Loading Skeleton */}
      <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 mt-8 animate-pulse">
        <div className="px-4 py-5 sm:p-6">
          <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="h-4 w-full max-w-xl bg-gray-200 dark:bg-gray-700 rounded mb-5"></div>
          
          <div className="mt-5 sm:flex sm:items-center">
            <div className="w-full sm:max-w-xs">
              <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
            <div className="mt-3 sm:mt-0 sm:ml-3 sm:w-auto">
              <div className="h-10 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>

          <div className="mt-6">
            <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
            <div className="hidden sm:block overflow-x-auto">
              <div className="min-w-full bg-gray-200 dark:bg-gray-700 h-10 rounded-t-md mb-1"></div>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="min-w-full bg-gray-200 dark:bg-gray-700 h-16 mb-1 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Users Management Loading Skeleton */}
      <div className="mt-8">
        <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded mt-2"></div>
        <div className="mt-4 h-10 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>

      <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700 animate-pulse">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {[...Array(5)].map((_, i) => (
            <li key={i} className="px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center">
                <div className="flex items-center mb-3 sm:mb-0">
                  <div className="flex-shrink-0 mr-4">
                    <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                  </div>
                  <div>
                    <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                    <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                    <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 sm:ml-auto mt-3 sm:mt-0">
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
} 