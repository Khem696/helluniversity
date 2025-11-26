/**
 * Hook for subscribing to user booking updates via Server-Sent Events (SSE)
 * 
 * This hook provides real-time updates for a specific booking using a token.
 * Used on user-facing booking pages (response page, deposit upload page).
 * 
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { API_PATHS } from "@/lib/api-config"

export interface UserBookingUpdateEvent {
  type: 'booking:status_changed' | 'booking:deposit_verified' | 'booking:updated' | 'booking:initial'
  bookingId: string
  status: string
  booking: {
    id: string
    status: string
    name: string
    email: string
    event_type: string
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    updated_at: number
    deposit_evidence_url?: string | null
    deposit_verified_at?: number | null
    proposed_date?: number | null
    proposed_end_date?: number | null
  }
  metadata?: {
    previousStatus?: string
    // HIGH-1: Additional flags to indicate what changed (consolidated broadcasts)
    depositWasVerified?: boolean
  }
  timestamp: number
}

interface UseUserBookingSSEOptions {
  /**
   * Booking response token (from email link)
   */
  token: string
  
  /**
   * Whether to enable the hook
   */
  enabled?: boolean
  
  /**
   * Callback when booking update is received
   */
  onBookingUpdate?: (event: UserBookingUpdateEvent) => void
  
  /**
   * Callback for status changes
   */
  onStatusChange?: (event: UserBookingUpdateEvent) => void
  
  /**
   * Callback for deposit verification
   */
  onDepositVerified?: (event: UserBookingUpdateEvent) => void
}

interface UseUserBookingSSEReturn {
  /**
   * Current booking data (from initial load or SSE updates)
   */
  booking: UserBookingUpdateEvent['booking'] | null
  
  /**
   * Whether the hook is connected to SSE
   */
  connected: boolean
  
  /**
   * Whether the hook has loaded
   */
  loaded: boolean
  
  /**
   * Error state if SSE connection failed
   */
  error: Error | null
  
  /**
   * Last received event (for debugging)
   */
  lastEvent: UserBookingUpdateEvent | null
}

/**
 * Get SSE stream URL for user booking
 */
function getSSEStreamUrl(token: string): string {
  return API_PATHS.bookingStream(token)
}

export function useUserBookingSSE(
  options: UseUserBookingSSEOptions
): UseUserBookingSSEReturn {
  const {
    token,
    enabled = true,
    onBookingUpdate,
    onStatusChange,
    onDepositVerified,
  } = options

  const [booking, setBooking] = useState<UserBookingUpdateEvent['booking'] | null>(null)
  const [connected, setConnected] = useState<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastEvent, setLastEvent] = useState<UserBookingUpdateEvent | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // CRITICAL-3: Track if component is mounted to prevent operations after unmount
  const isMountedRef = useRef<boolean>(true)
  // MEDIUM-7: Track last message time for health monitoring
  const lastMessageTimeRef = useRef<number | null>(null)
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onBookingUpdateRef = useRef(onBookingUpdate)
  const onStatusChangeRef = useRef(onStatusChange)
  const onDepositVerifiedRef = useRef(onDepositVerified)
  
  // HIGH-4: Store enabled in ref to prevent stale closures in reconnection logic
  const enabledRef = useRef(enabled)
  
  // MEDIUM-6: Base delay for exponential backoff (in milliseconds)
  // LOW-3: Extract magic number to named constant
  const BASE_RECONNECT_DELAY_MS = 1000 // 1 second base delay
  const maxReconnectAttempts = 5

  // Update refs when callbacks change
  useEffect(() => {
    onBookingUpdateRef.current = onBookingUpdate
    onStatusChangeRef.current = onStatusChange
    onDepositVerifiedRef.current = onDepositVerified
  }, [onBookingUpdate, onStatusChange, onDepositVerified])
  
  // HIGH-4: Update enabled ref when it changes
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  /**
   * Handle booking update event from SSE
   * MEDIUM-5: Added try-catch around callbacks to prevent one failure from breaking others
   * MEDIUM-7: Track message time for health monitoring
   */
  const handleBookingEvent = useCallback((event: UserBookingUpdateEvent) => {
    setLastEvent(event)
    setBooking(event.booking)
    // MEDIUM-7: Update last message time for health monitoring
    lastMessageTimeRef.current = Date.now()
    
    // MEDIUM-5: Call general callback with try-catch
    if (onBookingUpdateRef.current) {
      try {
        onBookingUpdateRef.current(event)
      } catch (error) {
        console.error('Error in onBookingUpdate callback:', error)
      }
    }
    
    // MEDIUM-5: Call specific callbacks based on event type with try-catch
    try {
      if (event.type === 'booking:status_changed' && onStatusChangeRef.current) {
        onStatusChangeRef.current(event)
      } else if (event.type === 'booking:deposit_verified' && onDepositVerifiedRef.current) {
        onDepositVerifiedRef.current(event)
      }
    } catch (error) {
      console.error('Error in specific booking event callback:', error)
    }
  }, [])

  /**
   * Connect to SSE stream
   * CRITICAL-3: Added mounted check to prevent operations after unmount
   */
  const connectSSE = useCallback(() => {
    // CRITICAL-3: Don't connect if component is unmounted
    if (!isMountedRef.current) {
      return
    }
    
    // Only connect if enabled and token exists (check ref to avoid dependency on enabled)
    if (!enabledRef.current || !token) {
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
      const streamUrl = getSSEStreamUrl(token)
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
        // MEDIUM-7: Reset last message time on connection
        lastMessageTimeRef.current = Date.now()
      }

      // Handle messages
      eventSource.onmessage = (event) => {
        // CRITICAL-3: Check if still mounted before processing
        if (!isMountedRef.current) {
          return
        }
        
        // MEDIUM-7: Update last message time even for heartbeats (indicates connection is alive)
        lastMessageTimeRef.current = Date.now()
        
        try {
          // Ignore heartbeat messages (lines starting with :)
          if (!event.data || event.data.trim() === '' || event.data.startsWith(':')) {
            return
          }
          
          const data = JSON.parse(event.data) as UserBookingUpdateEvent
          
          // Handle initial booking state
          if (data.type === 'booking:initial') {
            setBooking(data.booking)
            setLoaded(true)
            return
          }
          
          // Handle booking events
          if (
            data.type === 'booking:status_changed' ||
            data.type === 'booking:deposit_verified' ||
            data.type === 'booking:updated'
          ) {
            handleBookingEvent(data)
            setLoaded(true)
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

        // HIGH-4: Check if still enabled before attempting reconnection
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
            // HIGH-4: Check if still enabled before reconnecting
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
              const response = await fetch(API_PATHS.bookingResponse(token))
              const json = await response.json()
              
              if (json.success && json.data?.booking) {
                const bookingData = json.data.booking
                const event: UserBookingUpdateEvent = {
                  type: 'booking:updated',
                  bookingId: bookingData.id,
                  status: bookingData.status,
                  booking: {
                    id: bookingData.id,
                    status: bookingData.status,
                    name: bookingData.name || '',
                    email: bookingData.email || '',
                    event_type: bookingData.eventType || bookingData.event_type || '',
                    start_date: bookingData.startDate || bookingData.start_date || Math.floor(Date.now() / 1000),
                    end_date: bookingData.endDate || bookingData.end_date,
                    start_time: bookingData.startTime || bookingData.start_time,
                    end_time: bookingData.endTime || bookingData.end_time,
                    updated_at: bookingData.updatedAt || bookingData.updated_at || Math.floor(Date.now() / 1000),
                    deposit_evidence_url: bookingData.depositEvidenceUrl || bookingData.deposit_evidence_url,
                    deposit_verified_at: bookingData.depositVerifiedAt || bookingData.deposit_verified_at,
                    proposed_date: bookingData.proposedDate || bookingData.proposed_date,
                    proposed_end_date: bookingData.proposedEndDate || bookingData.proposed_end_date,
                  },
                  timestamp: Date.now(),
                }
                handleBookingEvent(event)
                setLoaded(true)
              }
            } catch (fetchError) {
              // Silently handle polling errors
            }
          }, 10000) // Poll every 10 seconds as fallback
        }
      }
    } catch (initError) {
      // CRITICAL-3: Only set error if still mounted
      if (isMountedRef.current) {
        setError(initError instanceof Error ? initError : new Error(String(initError)))
        setConnected(false)
      }
    }
  }, [token, handleBookingEvent]) // Removed 'enabled' from dependencies

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

    // Only connect if enabled (check ref to avoid dependency on enabled)
    if (enabledRef.current) {
      connectSSE()
    }

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
      
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current)
        healthCheckIntervalRef.current = null
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
  }, [connectSSE])
  
  /**
   * Handle enabled state changes (disconnect when disabled, connect when enabled)
   */
  useEffect(() => {
    // Only handle on client side
    if (typeof window === 'undefined') {
      return
    }
    
    if (!enabled) {
      // Disconnect when disabled
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close()
        } catch (error) {
          // Ignore errors during cleanup
        }
        eventSourceRef.current = null
        setConnected(false)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (fallbackPollIntervalRef.current) {
        clearInterval(fallbackPollIntervalRef.current)
        fallbackPollIntervalRef.current = null
      }
    } else if (enabled && isMountedRef.current && !eventSourceRef.current) {
      // Connect when enabled and not already connected
      connectSSE()
    }
  }, [enabled, connectSSE])
  
  // MEDIUM-7: Connection health monitoring - detect silent connection failures
  useEffect(() => {
    if (!connected || !isMountedRef.current) {
      return
    }
    
    // Check connection health every 2 minutes
    healthCheckIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) {
        return
      }
      
      // If no message received in last 3 minutes and we're supposed to be connected, mark as unhealthy
      const now = Date.now()
      if (lastMessageTimeRef.current && (now - lastMessageTimeRef.current) > 3 * 60 * 1000) {
        // Connection might be dead - trigger reconnection
        if (eventSourceRef.current) {
          try {
            eventSourceRef.current.close()
          } catch (error) {
            // Ignore errors
          }
          eventSourceRef.current = null
        }
        setConnected(false)
        // Trigger reconnection
        if (enabledRef.current && isMountedRef.current) {
          connectSSE()
        }
      }
    }, 2 * 60 * 1000) // Check every 2 minutes
    
    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current)
        healthCheckIntervalRef.current = null
      }
    }
  }, [connected, connectSSE])

  return {
    booking,
    connected,
    loaded,
    error,
    lastEvent,
  }
}




