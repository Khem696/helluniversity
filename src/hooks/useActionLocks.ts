/**
 * Hook for checking and monitoring action locks
 * 
 * Provides real-time lock status for bookings and prevents concurrent actions
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { API_PATHS } from "@/lib/api-config"

export interface ActionLock {
  id: string
  resourceType: 'booking' | 'event' | 'image' | 'email' | 'dashboard' | 'global'
  resourceId: string
  action: string
  adminEmail: string
  adminName?: string
  lockedAt: number
  expiresAt: number
}

export interface LockStatus {
  locked: boolean
  lockedBy?: string
  lockId?: string
}

interface UseActionLocksOptions {
  resourceType?: 'booking' | 'event' | 'image' | 'email' | 'dashboard' | 'global'
  resourceId?: string
  action?: string
  pollInterval?: number // milliseconds, default 5000 (5 seconds)
  enabled?: boolean
  // Backward compatibility
  bookingId?: string
}

export function useActionLocks(options: UseActionLocksOptions = {}) {
  const { data: session } = useSession()
  const { 
    resourceType = options.bookingId ? 'booking' : undefined, 
    resourceId = options.bookingId, 
    action, 
    pollInterval = 5000, 
    enabled = true 
  } = options
  
  const [lockStatus, setLockStatus] = useState<LockStatus>({ locked: false })
  const [locks, setLocks] = useState<ActionLock[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  // Check if current user has the lock
  const isLockedByMe = useCallback((lock: ActionLock | LockStatus): boolean => {
    if (!session?.user?.email) return false
    if ('adminEmail' in lock) {
      return lock.adminEmail === session.user.email
    }
    if ('lockedBy' in lock) {
      return lock.lockedBy === session.user.email
    }
    return false
  }, [session])

  // Check if action is locked by another admin
  const isLockedByOther = useCallback((status: LockStatus): boolean => {
    return status.locked && !isLockedByMe(status)
  }, [isLockedByMe])

  // Fetch lock status
  const fetchLockStatus = useCallback(async () => {
    if (!enabled || !session) return
    
    try {
      setIsLoading(true)
      setError(null)
      
      let url: string
      if (resourceType && resourceId && action) {
        // Check specific action lock
        url = `${API_PATHS.adminActionLocks}?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}&action=${encodeURIComponent(action)}`
      } else if (resourceType && resourceId) {
        // Get all locks for resource
        url = `${API_PATHS.adminActionLocks}?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`
      } else {
        // Get all active locks
        url = API_PATHS.adminActionLocks
      }
      
      const response = await fetch(url, {
        credentials: 'include',
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch lock status: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch lock status')
      }
      
      if (resourceType && resourceId && action) {
        // Single lock status check
        setLockStatus(data.data.lockStatus || { locked: false })
      } else if (resourceType && resourceId) {
        // Multiple locks for resource
        const resourceLocks = data.data.locks || []
        setLocks(resourceLocks)
        
        // Check if the specific action is locked
        if (action) {
          const actionLock = resourceLocks.find((l: ActionLock) => l.action === action)
          if (actionLock) {
            setLockStatus({
              locked: true,
              lockedBy: actionLock.adminEmail,
              lockId: actionLock.id,
            })
          } else {
            setLockStatus({ locked: false })
          }
        }
      } else {
        // All active locks
        setLocks(data.data.locks || [])
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      // Use structured logger for errors
      import('@/lib/logger').then(({ logError }) => {
        logError('Error fetching lock status', {
          error: errorMessage,
          resourceType,
          resourceId,
          action,
        }, err instanceof Error ? err : new Error(String(err))).catch(() => {
          // Fallback if logger fails
        })
      }).catch(() => {
        // Fallback if logger import fails
      })
    } finally {
      setIsLoading(false)
    }
  }, [enabled, session, resourceType, resourceId, action])

  // Start polling
  useEffect(() => {
    if (!enabled || !session) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    // Initial fetch
    fetchLockStatus()

    // Set up polling
    pollIntervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        fetchLockStatus()
      }
    }, pollInterval)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [enabled, session, fetchLockStatus, pollInterval])

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [])

  return {
    lockStatus,
    locks,
    isLoading,
    error,
    isLockedByMe: isLockedByMe(lockStatus),
    isLockedByOther: isLockedByOther(lockStatus),
    refetch: fetchLockStatus,
  }
}

