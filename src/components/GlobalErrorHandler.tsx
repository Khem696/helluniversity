'use client'

import { useEffect } from 'react'

/**
 * Global error handler to catch and suppress Chrome extension errors
 * that don't affect the website functionality.
 * 
 * This error "A listener indicated an asynchronous response by returning true,
 * but the message channel closed before a response was received" is typically
 * caused by browser extensions interfering with page events.
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const errorMessage = event.reason?.message || String(event.reason || '')
      
      // Suppress Chrome extension errors that don't affect functionality
      if (
        typeof errorMessage === 'string' &&
        errorMessage.includes('A listener indicated an asynchronous response by returning true') &&
        errorMessage.includes('message channel closed before a response was received')
      ) {
        // Prevent the error from appearing in console
        event.preventDefault()
        // Optionally log for debugging (use console.debug to avoid noise)
        console.debug('Suppressed Chrome extension error:', errorMessage)
        return
      }
      
      // Allow other errors to be handled normally
    }

    // Handle general errors
    const handleError = (event: ErrorEvent) => {
      const errorMessage = event.message || String(event.error || '')
      
      // Suppress Chrome extension errors
      if (
        typeof errorMessage === 'string' &&
        errorMessage.includes('A listener indicated an asynchronous response by returning true') &&
        errorMessage.includes('message channel closed before a response was received')
      ) {
        event.preventDefault()
        console.debug('Suppressed Chrome extension error:', errorMessage)
        return
      }
    }

    // Add event listeners
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleError)

    // Cleanup
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  return null
}

