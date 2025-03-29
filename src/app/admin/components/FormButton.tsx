'use client'

import { useFormStatus } from 'react-dom'
import React from 'react'
import { LoadingWrapper } from './LoadingWrapper'

type FormButtonProps = {
  children: React.ReactNode
  className?: string
  type?: 'submit' | 'button' | 'reset'
  disabled?: boolean
  loadingText?: string
  minLoadingTime?: number
}

export function FormButton({ 
  children, 
  className = '',
  type = 'submit',
  disabled = false,
  loadingText,
  minLoadingTime = 300
}: FormButtonProps) {
  const { pending } = useFormStatus()
  
  // Loading button component
  const loadingButton = (
    <button
      type={type}
      disabled={true}
      className={`${className} opacity-70 cursor-not-allowed relative`}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </span>
      <span className="invisible">
        {loadingText || children}
      </span>
    </button>
  )
  
  // Normal button component
  const normalButton = (
    <button
      type={type}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  )
  
  return (
    <LoadingWrapper
      isLoading={pending}
      fallback={loadingButton}
      minDisplayTime={minLoadingTime}
    >
      {normalButton}
    </LoadingWrapper>
  )
} 