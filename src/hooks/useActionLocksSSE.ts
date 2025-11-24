/**
 * Hook for subscribing to action lock status via Server-Sent Events (SSE)
 * 
 * This hook replaces polling with real-time updates using SSE.
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { API_PATHS } from "@/lib/api-config"
import type { ResourceType } from "@/lib/action-lock"

export interface ActionLock {
  id: string
  resourceType: ResourceType
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

interface UseActionLocksSSEOptions {
  /**
   * Resource type to filter locks
   */
  resourceType?: ResourceType
  
  /**
   * Resource ID to filter locks
   */
  resourceId?: string
  
  /**
   * Action to filter locks
   */
  action?: string
  
  /**
   * Whether to enable the hook
   */
  enabled?: boolean
  
  /**
   * Callback when lock status changes
   */
  onLockStatusChange?: (status: LockStatus) => void
  
  /**
   * Callback when locks list changes
   */
  onLocksChange?: (locks: ActionLock[]) => void
  
  // Backward compatibility
  bookingId?: string
}

interface UseActionLocksSSEReturn {
  /**
   * Current lock status for the specified resource/action
   */
  lockStatus: LockStatus
  
  /**
   * All active locks matching filters
   */
  locks: ActionLock[]
  
  /**
   * Whether the status has been loaded
   */
  loaded: boolean
  
  /**
   * Whether SSE is connected
   */
  connected: boolean
  
  /**
   * Error state if SSE connection failed
   */
  error: Error | null
  
  /**
   * Whether action is locked by current user
   */
  isLockedByMe: boolean
  
  /**
   * Whether action is locked by another admin
   */
  isLockedByOther: boolean
}

/**
 * Get SSE stream URL with filters
 */
function getSSEStreamUrl(
  resourceType?: ResourceType,
  resourceId?: string,
  action?: string
): string {
  const baseUrl = API_PATHS.adminActionLocksStream
  const params = new URLSearchParams()
  
  if (resourceType) {
    params.append('resourceType', resourceType)
  }
  if (resourceId) {
    params.append('resourceId', resourceId)
  }
  if (action) {
    params.append('action', action)
  }
  
  const queryString = params.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

export function useActionLocksSSE(
  options: UseActionLocksSSEOptions = {}
): UseActionLocksSSEReturn {
  const { data: session } = useSession()
  const {
    resourceType = options.bookingId ? 'booking' : undefined,
    resourceId = options.bookingId,
    action,
    enabled = true,
    onLockStatusChange,
    onLocksChange,
  } = options

  const [lockStatus, setLockStatus] = useState<LockStatus>({ locked: false })
  const [locks, setLocks] = useState<ActionLock[]>([])
  const [loaded, setLoaded] = useState<boolean>(false)
  const [connected, setConnected] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onLockStatusChangeRef = useRef(onLockStatusChange)
  const onLocksChangeRef = useRef(onLocksChange)
  
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000 // 3 seconds

  // Update refs when callbacks change
  useEffect(() => {
    onLockStatusChangeRef.current = onLockStatusChange
    onLocksChangeRef.current = onLocksChange
  }, [onLockStatusChange, onLocksChange])

  /**
   * Check if current user has the lock
   */
  const isLockedByMe = useCallback((status: LockStatus): boolean => {
    if (!session?.user?.email) return false
    return status.locked && status.lockedBy === session.user.email
  }, [session])

  /**
   * Check if action is locked by another admin
   */
  const isLockedByOther = useCallback((status: LockStatus): boolean => {
    return status.locked && !isLockedByMe(status)
  }, [isLockedByMe])

  /**
   * Update lock status from locks array
   */
  const updateLockStatusFromLocks = useCallback((locksList: ActionLock[]) => {
    if (resourceType && resourceId && action) {
      // Find lock for specific resource/action
      const actionLock = locksList.find(
        (l) => l.resourceType === resourceType && l.resourceId === resourceId && l.action === action
      )
      
      if (actionLock) {
        const newStatus: LockStatus = {
          locked: true,
          lockedBy: actionLock.adminEmail,
          lockId: actionLock.id,
        }
        setLockStatus(newStatus)
        
        if (onLockStatusChangeRef.current) {
          onLockStatusChangeRef.current(newStatus)
        }
      } else {
        const newStatus: LockStatus = { locked: false }
        setLockStatus(newStatus)
        
        if (onLockStatusChangeRef.current) {
          onLockStatusChangeRef.current(newStatus)
        }
      }
    }
    
    setLocks(locksList)
    
    if (onLocksChangeRef.current) {
      onLocksChangeRef.current(locksList)
    }
  }, [resourceType, resourceId, action])

  /**
   * Handle lock event from SSE
   */
  const handleLockEvent = useCallback((event: {
    type: 'lock:acquired' | 'lock:released' | 'lock:expired' | 'lock:extended'
    resourceType: ResourceType
    resourceId: string
    action: string
    lockId: string
    adminEmail: string
    adminName?: string
    lockedAt?: number
    expiresAt?: number
  }) => {
    // Update locks list based on event type
    setLocks((currentLocks) => {
      const newLocks = [...currentLocks]
      
      if (event.type === 'lock:acquired' || event.type === 'lock:extended') {
        // Add or update lock
        const existingIndex = newLocks.findIndex(
          (l) => l.id === event.lockId
        )
        
        const lock: ActionLock = {
          id: event.lockId,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          action: event.action,
          adminEmail: event.adminEmail,
          adminName: event.adminName,
          lockedAt: event.lockedAt || Math.floor(Date.now() / 1000),
          expiresAt: event.expiresAt || Math.floor(Date.now() / 1000) + 30,
        }
        
        if (existingIndex >= 0) {
          newLocks[existingIndex] = lock
        } else {
          newLocks.push(lock)
        }
      } else if (event.type === 'lock:released' || event.type === 'lock:expired') {
        // Remove lock
        const index = newLocks.findIndex((l) => l.id === event.lockId)
        if (index >= 0) {
          newLocks.splice(index, 1)
        }
      }
      
      // Update lock status if this event affects the filtered resource/action
      if (
        resourceType &&
        resourceId &&
        action &&
        event.resourceType === resourceType &&
        event.resourceId === resourceId &&
        event.action === action
      ) {
        let newStatus: LockStatus
        if (event.type === 'lock:acquired' || event.type === 'lock:extended') {
          newStatus = {
            locked: true,
            lockedBy: event.adminEmail,
            lockId: event.lockId,
          }
        } else {
          newStatus = { locked: false }
        }
        
        setLockStatus(newStatus)
        
        if (onLockStatusChangeRef.current) {
          onLockStatusChangeRef.current(newStatus)
        }
      }
      
      if (onLocksChangeRef.current) {
        onLocksChangeRef.current(newLocks)
      }
      
      return newLocks
    })
  }, [resourceType, resourceId, action])

  /**
   * Connect to SSE stream
   */
  const connectSSE = useCallback(() => {
    // Only connect if enabled and session exists
    if (!enabled || !session) {
      return
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // Clear any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    try {
      const streamUrl = getSSEStreamUrl(resourceType, resourceId, action)
      const eventSource = new EventSource(streamUrl)
      eventSourceRef.current = eventSource

      // Handle connection open
      eventSource.onopen = () => {
        setConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
        setLoaded(true)
      }

      // Handle messages
      eventSource.onmessage = (event) => {
        try {
          // Ignore heartbeat messages (lines starting with :)
          if (!event.data || event.data.trim() === '' || event.data.startsWith(':')) {
            return
          }
          
          const data = JSON.parse(event.data)
          
          // Handle initial locks state
          if (data.type === 'locks:initial' && Array.isArray(data.locks)) {
            updateLockStatusFromLocks(data.locks)
            return
          }
          
          // Handle lock events
          if (
            data.type === 'lock:acquired' ||
            data.type === 'lock:released' ||
            data.type === 'lock:expired' ||
            data.type === 'lock:extended'
          ) {
            handleLockEvent(data)
          }
        } catch (parseError) {
          // Silently ignore parse errors for invalid messages
        }
      }

      // Handle errors
      eventSource.onerror = () => {
        setConnected(false)
        eventSource.close()
        eventSourceRef.current = null

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          reconnectTimeoutRef.current = setTimeout(() => {
            connectSSE()
          }, reconnectDelay)
        } else {
          // Max reconnection attempts reached, fallback to polling
          setError(new Error("SSE connection failed after multiple attempts. Falling back to polling."))
          
          // Clear any existing fallback polling
          if (fallbackPollIntervalRef.current) {
            clearInterval(fallbackPollIntervalRef.current)
          }
          
          // Fallback to polling - set up interval
          fallbackPollIntervalRef.current = setInterval(async () => {
            try {
              let url: string
              if (resourceType && resourceId && action) {
                url = `${API_PATHS.adminActionLocks}?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}&action=${encodeURIComponent(action)}`
              } else if (resourceType && resourceId) {
                url = `${API_PATHS.adminActionLocks}?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`
              } else {
                url = API_PATHS.adminActionLocks
              }
              
              const response = await fetch(url, {
                credentials: 'include',
              })
              
              if (response.ok) {
                const json = await response.json()
                if (json.success) {
                  if (resourceType && resourceId && action) {
                    setLockStatus(json.data.lockStatus || { locked: false })
                  } else if (resourceType && resourceId) {
                    const resourceLocks = json.data.locks || []
                    setLocks(resourceLocks)
                    
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
                    setLocks(json.data.locks || [])
                  }
                }
              }
            } catch (fetchError) {
              // Silently handle polling errors
            }
          }, 5000) // Poll every 5 seconds as fallback
        }
      }
    } catch (initError) {
      setError(initError instanceof Error ? initError : new Error(String(initError)))
      setConnected(false)
    }
  }, [enabled, session, resourceType, resourceId, action, handleLockEvent, updateLockStatusFromLocks])

  /**
   * Initialize SSE connection
   */
  useEffect(() => {
    // Only connect on client side
    if (typeof window === 'undefined') {
      return
    }

    // Connect to SSE
    connectSSE()

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (fallbackPollIntervalRef.current) {
        clearInterval(fallbackPollIntervalRef.current)
        fallbackPollIntervalRef.current = null
      }
    }
  }, [connectSSE])

  return {
    lockStatus,
    locks,
    loaded,
    connected,
    error,
    isLockedByMe: isLockedByMe(lockStatus),
    isLockedByOther: isLockedByOther(lockStatus),
  }
}

