'use client'

import React, { useState, useEffect } from 'react'

type LoadingWrapperProps = {
  children: React.ReactNode
  isLoading: boolean
  fallback: React.ReactNode
  minDisplayTime?: number
}

/**
 * A wrapper component that shows a loading state for a minimum amount of time
 * to prevent flickering for quick operations
 */
export function LoadingWrapper({
  children,
  isLoading,
  fallback,
  minDisplayTime = 500
}: LoadingWrapperProps) {
  const [shouldShow, setShouldShow] = useState(isLoading)
  
  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => {
        setShouldShow(false)
      }, minDisplayTime)
      
      return () => clearTimeout(timer)
    } else {
      setShouldShow(true)
    }
  }, [isLoading, minDisplayTime])
  
  if (shouldShow) {
    return <>{fallback}</>
  }
  
  return <>{children}</>
} 