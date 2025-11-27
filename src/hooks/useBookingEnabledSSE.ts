/**
 * Hook for subscribing to booking enabled status via Server-Sent Events (SSE)
 * 
 * This hook replaces polling with real-time updates using SSE.
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { API_PATHS } from "@/lib/api-config"
import { toast } from "sonner"

interface UseBookingEnabledSSEOptions {
  /**
   * Initial booking enabled status (from server-side fetch)
   * If provided, this will be used immediately while SSE connects
   */
  initialStatus?: boolean
  
  /**
   * Callback when status changes
   */
  onStatusChange?: (enabled: boolean, previousEnabled: boolean) => void
  
  /**
   * Whether to show toast notifications on status changes
   */
  showNotifications?: boolean
  
  /**
   * Whether to close booking dialog when status changes to disabled
   */
  onDisabled?: () => void
}

interface UseBookingEnabledSSEReturn {
  /**
   * Current booking enabled status
   */
  enabled: boolean
  
  /**
   * Whether the status has been loaded (either from initial or SSE)
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
}

/**
 * Get SSE stream URL
 */
function getSSEStreamUrl(): string {
  // Use the dedicated SSE stream path from API config
  return API_PATHS.settingsBookingEnabledStream
}

export function useBookingEnabledSSE(
  options: UseBookingEnabledSSEOptions = {}
): UseBookingEnabledSSEReturn {
  const {
    initialStatus,
    onStatusChange,
    showNotifications = false,
    onDisabled,
  } = options

  const [enabled, setEnabled] = useState<boolean>(initialStatus ?? false)
  const [loaded, setLoaded] = useState<boolean>(initialStatus !== undefined)
  const [connected, setConnected] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  // Version counter to force re-renders when state updates
  const [, setVersion] = useState(0)

  const eventSourceRef = useRef<EventSource | null>(null)
  const previousStatusRef = useRef<boolean | null>(initialStatus ?? null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // CRITICAL-3: Track if component is mounted to prevent operations after unmount
  const isMountedRef = useRef<boolean>(true)
  // Store callbacks in refs to prevent recreation and stale closures
  const onStatusChangeRef = useRef(onStatusChange)
  const onDisabledRef = useRef(onDisabled)
  const showNotificationsRef = useRef(showNotifications)
  // MEDIUM-6: Base delay for exponential backoff (in milliseconds)
  const BASE_RECONNECT_DELAY_MS = 1000 // 1 second base delay
  const maxReconnectAttempts = 5

  // Update refs when callbacks change
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
    onDisabledRef.current = onDisabled
    showNotificationsRef.current = showNotifications
  }, [onStatusChange, onDisabled, showNotifications])

  /**
   * Handle status update from SSE
   * Use refs to avoid stale closures and prevent duplicate notifications
   * MEDIUM-5: Added try-catch around callbacks to prevent one failure from breaking others
   */
  const handleStatusUpdate = useCallback((newEnabled: boolean) => {
    // Check if status changed BEFORE updating state (using ref to avoid stale closures)
    const previousEnabled = previousStatusRef.current
    
    // Update state (pure state update, no side effects)
    setEnabled((currentEnabled) => {
      // Return new value to update state
      // Ref will be updated outside the updater to maintain React purity
      return newEnabled
    })
    
    // Update ref outside state updater to maintain React purity
    previousStatusRef.current = newEnabled
    
    // Move all side effects outside the state updater to maintain React purity
    // Use requestAnimationFrame to ensure callbacks run after render
    const statusChanged = previousEnabled !== null && previousEnabled !== newEnabled
    
    if (statusChanged) {
      requestAnimationFrame(() => {
        // Force version update to ensure component re-renders
        setVersion((v) => v + 1)
        
        // MEDIUM-5: Wrap callbacks in try-catch
        if (onStatusChangeRef.current) {
          try {
            onStatusChangeRef.current(newEnabled, previousEnabled)
          } catch (error) {
            console.error('Error in onStatusChange callback:', error)
          }
        }
        
        // Show notification if enabled (only once per change)
        if (showNotificationsRef.current) {
          if (!newEnabled && previousEnabled) {
            toast.error("Bookings are currently disabled. Please try again later.")
          } else if (newEnabled && previousEnabled) {
            toast.success("Bookings are now enabled.")
          }
        }
        
        // Call disabled callback if status changed to disabled
        if (!newEnabled && previousEnabled && onDisabledRef.current) {
          try {
            onDisabledRef.current()
          } catch (error) {
            console.error('Error in onDisabled callback:', error)
          }
        }
      })
    } else {
      // Force update even if value appears unchanged (handles edge cases)
      requestAnimationFrame(() => {
        setVersion((v) => v + 1)
      })
    }
  }, []) // Empty deps - use refs for all external values

  /**
   * Connect to SSE stream
   * CRITICAL-3: Added mounted check to prevent operations after unmount
   */
  const connectSSE = useCallback(() => {
    // CRITICAL-3: Don't connect if component is unmounted
    if (!isMountedRef.current) {
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
      const streamUrl = getSSEStreamUrl()
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
          
          if (typeof data.enabled === 'boolean') {
            // Call handleStatusUpdate directly - it will update state
            handleStatusUpdate(data.enabled)
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

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          // MEDIUM-6: Exponential backoff: delay = baseDelay * 2^(attempt-1)
          const reconnectDelay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1)
          reconnectTimeoutRef.current = setTimeout(() => {
            // CRITICAL-3: Check if still mounted before reconnecting
            if (isMountedRef.current) {
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
              const response = await fetch(API_PATHS.settingsBookingEnabled)
              const json = await response.json()
              if (json.success && json.data) {
                handleStatusUpdate(json.data.enabled)
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
  }, [handleStatusUpdate])

  /**
   * Initialize SSE connection
   * CRITICAL-3: Added proper cleanup and mounted tracking
   */
  useEffect(() => {
    // Only connect on client side
    if (typeof window === 'undefined') {
      return
    }

    // CRITICAL-3: Mark as mounted
    isMountedRef.current = true

    // If we have initial status, use it immediately but still connect to SSE for updates
    if (initialStatus !== undefined) {
      setEnabled(initialStatus)
      setLoaded(true)
      previousStatusRef.current = initialStatus
    }

    // Connect to SSE
    connectSSE()

    // Cleanup on unmount
    return () => {
      // CRITICAL-3: Mark as unmounted first to prevent operations
      isMountedRef.current = false
      
      // CRITICAL-3: Clean up in order to prevent race conditions
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
  }, [connectSSE, initialStatus])


  return {
    enabled,
    loaded,
    connected,
    error,
  }
}

