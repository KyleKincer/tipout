'use client'

import React from 'react'
import { FormButton } from './FormButton'

type InvitationFormProps = {
  action: (formData: FormData) => Promise<void>
}

export function InvitationForm({ action }: InvitationFormProps) {
  return (
    <form action={action} className="mt-4 mb-6">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-grow">
          <label htmlFor="emailAddress" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            email address
          </label>
          <input
            type="email"
            name="emailAddress"
            id="emailAddress"
            className="shadow-sm focus:ring-blue-500 focus:border-blue-500 px-3 py-2 block w-full sm:text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md"
            placeholder="email@example.com"
            required
          />
        </div>
        <FormButton
          className="mt-3 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
          loadingText="Inviting..."
        >
          invite user
        </FormButton>
      </div>
    </form>
  )
} 