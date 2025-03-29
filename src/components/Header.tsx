'use client'

import { Fragment } from 'react'
import { Disclosure } from '@headlessui/react'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import { AdminOnly } from './RoleBasedUI'
import { dark } from '@clerk/themes'
const navigation = [
  { name: 'home', href: '/' },
  { name: 'daily entry', href: '/shifts/new' },
  { name: 'shifts', href: '/shifts' },
  { name: 'employees', href: '/employees' },
  { name: 'roles', href: '/roles' },
  { name: 'reports', href: '/reports' },
]

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ')
}

export default function Header() {
  const pathname = usePathname()
  const { isSignedIn } = useUser()

  return (
    <Disclosure as="nav" className="bg-[var(--background)] shadow">
      {({ open }) => (
        <>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 justify-between">
              <div className="flex">
                <div className="flex flex-shrink-0 items-center">
                  <Link href="/" className="text-xl font-bold text-[var(--foreground)]">
                    tipout manager
                  </Link>
                </div>
                {isSignedIn && (
                  <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                    {navigation.map((item) => (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={classNames(
                          pathname === item.href
                            ? 'border-indigo-500 text-[var(--foreground)]'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
                          'inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium'
                        )}
                      >
                        {item.name}
                      </Link>
                    ))}
                    
                    {/* Admin link - only shown to admin users */}
                    <AdminOnly>
                      <Link
                        href="/admin"
                        className={classNames(
                          pathname.startsWith('/admin')
                            ? 'border-indigo-500 text-[var(--foreground)]'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
                          'inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium'
                        )}
                      >
                        admin
                      </Link>
                    </AdminOnly>
                  </div>
                )}
              </div>
              <div className="flex items-center">
                {isSignedIn ? (
                  <UserButton afterSignOutUrl="/sign-in" appearance={{ baseTheme: dark }} />
                ) : (
                  <Link
                    href="/sign-in"
                    className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  >
                    Sign in
                  </Link>
                )}
                <div className="-mr-2 flex items-center sm:hidden">
                  <Disclosure.Button className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500">
                    <span className="sr-only">Open main menu</span>
                    {open ? (
                      <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                    ) : (
                      <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                    )}
                  </Disclosure.Button>
                </div>
              </div>
            </div>
          </div>

          <Disclosure.Panel className="sm:hidden">
            <div className="space-y-1 pb-3 pt-2">
              {isSignedIn && navigation.map((item) => (
                <Disclosure.Button
                  key={item.name}
                  as={Link}
                  href={item.href}
                  className={classNames(
                    pathname === item.href
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                      : 'border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300',
                    'block border-l-4 py-2 pl-3 pr-4 text-base font-medium'
                  )}
                >
                  {item.name}
                </Disclosure.Button>
              ))}
              
              {/* Admin link in mobile menu - only shown to admin users */}
              {isSignedIn && (
                <AdminOnly>
                  <Disclosure.Button
                    as={Link}
                    href="/admin"
                    className={classNames(
                      pathname.startsWith('/admin')
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                        : 'border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300',
                      'block border-l-4 py-2 pl-3 pr-4 text-base font-medium'
                    )}
                  >
                    admin
                  </Disclosure.Button>
                </AdminOnly>
              )}
            </div>
          </Disclosure.Panel>
        </>
      )}
    </Disclosure>
  )
} 