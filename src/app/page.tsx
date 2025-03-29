'use client'

import Link from 'next/link'
import { AdminOnly } from '@/components/RoleBasedUI'
import { useUser } from '@clerk/nextjs'

const features = [
  {
    name: 'daily tipout entry',
    description: 'enter daily shift information and calculate tipouts',
    href: '/shifts/new',
    icon: '📝',
  },
  {
    name: 'employees',
    description: 'manage employee information and roles',
    href: '/employees',
    icon: '👥',
  },
  {
    name: 'roles & configuration',
    description: 'configure roles, pay rates, and tipout percentages',
    href: '/roles',
    icon: '⚙️',
  },
  {
    name: 'reports',
    description: 'view historical tipout data and reports',
    href: '/reports',
    icon: '📊',
  },
]

export default function Home() {
  const { isSignedIn } = useUser()
  
  return (
    <div className="bg-[var(--background)] min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="relative isolate overflow-hidden bg-[var(--background)] px-4 py-10 sm:py-16 text-center shadow-2xl sm:rounded-3xl sm:px-16 border border-gray-200 dark:border-gray-800">
          <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center space-x-4">
            {!isSignedIn && (
              <Link
                href="/sign-in"
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Sign in
              </Link>
            )}
            
            <AdminOnly>
              <Link 
                href="/admin" 
                className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Admin ⚡
              </Link>
            </AdminOnly>
          </div>
          
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl lg:text-4xl">
            tipout manager
          </h2>
          
          <div className="mx-auto mt-8 sm:mt-10 grid max-w-2xl grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-2 lg:gap-8">
            {features.map((feature) => (
              <Link
                key={feature.name}
                href={feature.href}
                className="group relative isolate flex flex-col justify-center overflow-hidden rounded-2xl bg-[var(--background)] px-4 py-6 sm:px-6 sm:py-8 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800"
              >
                <div className="text-3xl sm:text-4xl mb-2 sm:mb-4 text-[var(--foreground)]">{feature.icon}</div>
                <h3 className="text-base sm:text-lg font-semibold leading-tight tracking-tight text-[var(--foreground)]">
                  {feature.name}
                </h3>
                <p className="mt-1 sm:mt-2 text-sm sm:text-base leading-normal text-gray-600 dark:text-gray-400">
                  {feature.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
