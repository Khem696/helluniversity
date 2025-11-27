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
  // CRITICAL-3: Track if component is mounted to prevent operations after unmount
  const isMountedRef = useRef<boolean>(true)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onLockStatusChangeRef = useRef(onLockStatusChange)
  const onLocksChangeRef = useRef(onLocksChange)
  // HIGH-4: Store enabled in ref to prevent stale closures in reconnection logic
  const enabledRef = useRef(enabled)
  
  // MEDIUM-6: Base delay for exponential backoff (in milliseconds)
  // LOW-3: Extract magic number to named constant
  const BASE_RECONNECT_DELAY_MS = 1000 // 1 second base delay
  const maxReconnectAttempts = 5

  // Update refs when callbacks change
  useEffect(() => {
    onLockStatusChangeRef.current = onLockStatusChange
    onLocksChangeRef.current = onLocksChange
  }, [onLockStatusChange, onLocksChange])
  
  // HIGH-4: Update enabled ref when it changes
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

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
    // FIXED: State updater functions must be pure - no side effects like startTransition calls (Bug #6)
    // Calculate new locks state first, then apply side effects after
    
    // Calculate the new locks list based on event type
    let newLocks: ActionLock[] = []
    
    setLocks((currentLocks) => {
      newLocks = [...currentLocks]
      
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
      
      return newLocks
    })
    
    // FIXED: Move side effects outside the state updater function
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
      
      // FIXED: Remove startTransition for lock status updates (Bug #48)
      // Lock status changes are important for UI consistency and should be applied immediately
      // Using startTransition here could cause race conditions where callbacks see stale state
      setLockStatus(newStatus)
      
      // Callback should be called synchronously after state update
      if (onLockStatusChangeRef.current) {
        onLockStatusChangeRef.current(newStatus)
      }
    }
    
    // FIXED: Call locks change callback synchronously (Bug #48)
    // startTransition should only wrap state updates, not callback invocations
    // Callbacks may have important side effects that shouldn't be deferred
    if (onLocksChangeRef.current) {
      onLocksChangeRef.current(newLocks)
    }
  }, [resourceType, resourceId, action])

  /**
   * Connect to SSE stream
   * CRITICAL-3: Added mounted check to prevent operations after unmount
   */
  const connectSSE = useCallback(() => {
    // CRITICAL-3: Don't connect if component is unmounted
    if (!isMountedRef.current) {
      return
    }
    
    // Only connect if enabled and session exists (check ref to avoid dependency on enabled)
    if (!enabledRef.current || !session) {
      return
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close()
      } catch (error) {
        // Ignore errors during cleanup
      }
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
        // CRITICAL-3: Check if still mounted before updating state
        if (!isMountedRef.current) {
          try {
            eventSource.close()
          } catch (error) {
            // Ignore errors
          }
          return
        }
        setConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
        setLoaded(true)
      }

      // Handle messages
      eventSource.onmessage = (event) => {
        // CRITICAL-3: Check if still mounted before processing
        if (!isMountedRef.current) {
          return
        }
        
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
        // CRITICAL-3: Check if still mounted before processing
        if (!isMountedRef.current) {
          return
        }
        
        setConnected(false)
        try {
          eventSource.close()
        } catch (error) {
          // Ignore errors during cleanup
        }
        eventSourceRef.current = null

        // CRITICAL-3: Check if still mounted before attempting reconnection
        if (!isMountedRef.current) {
          return
        }

        // HIGH-4: Check if still enabled before attempting reconnection (use ref)
        if (!enabledRef.current) {
          return
        }

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          // MEDIUM-6: Exponential backoff: delay = baseDelay * 2^(attempt-1)
          const reconnectDelay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1)
          reconnectTimeoutRef.current = setTimeout(() => {
            // CRITICAL-3: Check if still mounted before reconnecting
            // HIGH-4: Check if still enabled before reconnecting (use ref)
            if (isMountedRef.current && enabledRef.current) {
              connectSSE()
            }
          }, reconnectDelay)
        } else {
          // Max reconnection attempts reached, fallback to polling
          if (isMountedRef.current) {
            setError(new Error("SSE connection failed after multiple attempts. Falling back to polling."))
          }
          
          // CRITICAL-3: Only set up polling if still mounted
          if (!isMountedRef.current) {
            return
          }
          
          // Clear any existing fallback polling
          if (fallbackPollIntervalRef.current) {
            clearInterval(fallbackPollIntervalRef.current)
          }
          
          // Fallback to polling - set up interval
          fallbackPollIntervalRef.current = setInterval(async () => {
            // CRITICAL-3: Check if still mounted before polling
            if (!isMountedRef.current) {
              if (fallbackPollIntervalRef.current) {
                clearInterval(fallbackPollIntervalRef.current)
                fallbackPollIntervalRef.current = null
              }
              return
            }
            
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
      // CRITICAL-3: Only set error if still mounted
      if (isMountedRef.current) {
        setError(initError instanceof Error ? initError : new Error(String(initError)))
        setConnected(false)
      }
    }
  }, [session, resourceType, resourceId, action, handleLockEvent, updateLockStatusFromLocks]) // Removed 'enabled' from dependencies

  /**
   * Initialize SSE connection
   * CRITICAL-3: Added proper cleanup and mounted tracking
   * HIGH-7: Fetch initial state before SSE connection
   */
  useEffect(() => {
    // Only connect on client side
    if (typeof window === 'undefined') {
      return
    }

    // CRITICAL-3: Mark as mounted
    isMountedRef.current = true

    // HIGH-7: Fetch initial state before SSE connection to prevent race conditions
    // This ensures we have current lock status even if SSE connection fails
    const fetchInitialState = async () => {
      if (!isMountedRef.current || !enabledRef.current) {
        return
      }
      
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
        
        if (response.ok && isMountedRef.current) {
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
            setLoaded(true)
          }
        }
      } catch (error) {
        // Silently handle fetch errors - SSE will provide updates
      }
    }
    
    // Fetch initial state, then connect to SSE
    fetchInitialState().then(() => {
      if (isMountedRef.current) {
        connectSSE()
      }
    })

    // Cleanup on unmount
    return () => {
      // CRITICAL-3: Mark as unmounted first to prevent operations
      isMountedRef.current = false
      
      // CRITICAL-3: Clean up in order to prevent race conditions
      // HIGH-5: Ensure fallback polling is cleaned up
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      
      if (fallbackPollIntervalRef.current) {
        clearInterval(fallbackPollIntervalRef.current)
        fallbackPollIntervalRef.current = null
      }
      
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close()
        } catch (error) {
          // Ignore errors during cleanup
        }
        eventSourceRef.current = null
      }
    }
  }, [connectSSE, resourceType, resourceId, action]) // Removed 'enabled' from dependencies

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

