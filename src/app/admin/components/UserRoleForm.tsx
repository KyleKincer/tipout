'use client'

import React from 'react'
import { FormButton } from './FormButton'

type UserRoleFormProps = {
  action: (formData: FormData) => Promise<void>
  userId: string
  role: string
  buttonText: string
  buttonClass: string
  disabled?: boolean
  loadingText?: string
}

export function UserRoleForm({
  action,
  userId,
  role,
  buttonText,
  buttonClass,
  disabled = false,
  loadingText
}: UserRoleFormProps) {
  return (
    <form action={action}>
      <input type="hidden" value={userId} name="userId" />
      <input type="hidden" value={role} name="role" />
      <FormButton
        className={buttonClass}
        disabled={disabled}
        loadingText={loadingText}
      >
        {buttonText}
      </FormButton>
    </form>
  )
} 