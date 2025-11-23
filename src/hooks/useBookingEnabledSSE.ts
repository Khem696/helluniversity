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
  // Store callbacks in refs to prevent recreation and stale closures
  const onStatusChangeRef = useRef(onStatusChange)
  const onDisabledRef = useRef(onDisabled)
  const showNotificationsRef = useRef(showNotifications)
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000 // 3 seconds

  // Update refs when callbacks change
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
    onDisabledRef.current = onDisabled
    showNotificationsRef.current = showNotifications
  }, [onStatusChange, onDisabled, showNotifications])

  /**
   * Handle status update from SSE
   * Use refs to avoid stale closures and prevent duplicate notifications
   */
  const handleStatusUpdate = useCallback((newEnabled: boolean) => {
    // Always update state directly (don't use functional form to avoid comparison issues)
    // This ensures React always sees a state change and triggers re-render
    setEnabled((currentEnabled) => {
      const previousEnabled = previousStatusRef.current ?? currentEnabled
      
      // Only update if status actually changed
      if (previousEnabled !== newEnabled) {
        // Update ref to match new state BEFORE returning
        previousStatusRef.current = newEnabled
        
        // Call callbacks and force re-render after state update
        // Use requestAnimationFrame to ensure callbacks run after render
        requestAnimationFrame(() => {
          // Force version update to ensure component re-renders
          setVersion((v) => v + 1)
          
          if (onStatusChangeRef.current) {
            onStatusChangeRef.current(newEnabled, previousEnabled)
          }
          
          // Show notification if enabled (only once per change)
          if (showNotificationsRef.current) {
            if (!newEnabled && previousEnabled) {
              toast.error("Bookings are currently disabled. Please try again later.")
            } else if (newEnabled && !previousEnabled) {
              toast.success("Bookings are now enabled.")
            }
          }
          
          // Call disabled callback if status changed to disabled
          if (!newEnabled && previousEnabled && onDisabledRef.current) {
            onDisabledRef.current()
          }
        })
        
        // Return new value to update state - this will trigger re-render
        return newEnabled
      } else {
        // Force update even if value appears unchanged (handles edge cases)
        // Update version to force re-render
        requestAnimationFrame(() => {
          setVersion((v) => v + 1)
        })
        return newEnabled
      }
    })
  }, []) // Empty deps - use refs for all external values

  /**
   * Connect to SSE stream
   */
  const connectSSE = useCallback(() => {
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
      const streamUrl = getSSEStreamUrl()
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
      setError(initError instanceof Error ? initError : new Error(String(initError)))
      setConnected(false)
    }
  }, [handleStatusUpdate])

  /**
   * Initialize SSE connection
   */
  useEffect(() => {
    // Only connect on client side
    if (typeof window === 'undefined') {
      return
    }

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
  }, [connectSSE, initialStatus])


  return {
    enabled,
    loaded,
    connected,
    error,
  }
}

