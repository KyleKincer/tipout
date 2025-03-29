'use client'

import React from 'react'
import { FormButton } from './FormButton'

type RevokeInvitationButtonProps = {
  action: (formData: FormData) => Promise<void>
  invitationId: string
}

export function RevokeInvitationButton({ action, invitationId }: RevokeInvitationButtonProps) {
  return (
    <form action={action}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <FormButton 
        type="submit"
        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 w-full sm:w-auto"
        loadingText="Revoking..."
      >
        Revoke
      </FormButton>
    </form>
  )
} 