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
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onBookingUpdateRef = useRef(onBookingUpdate)
  const onStatusChangeRef = useRef(onStatusChange)
  const onDepositVerifiedRef = useRef(onDepositVerified)
  
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000 // 3 seconds

  // Update refs when callbacks change
  useEffect(() => {
    onBookingUpdateRef.current = onBookingUpdate
    onStatusChangeRef.current = onStatusChange
    onDepositVerifiedRef.current = onDepositVerified
  }, [onBookingUpdate, onStatusChange, onDepositVerified])

  /**
   * Handle booking update event from SSE
   */
  const handleBookingEvent = useCallback((event: UserBookingUpdateEvent) => {
    setLastEvent(event)
    setBooking(event.booking)
    
    // Call general callback
    if (onBookingUpdateRef.current) {
      onBookingUpdateRef.current(event)
    }
    
    // Call specific callbacks based on event type
    if (event.type === 'booking:status_changed' && onStatusChangeRef.current) {
      onStatusChangeRef.current(event)
    } else if (event.type === 'booking:deposit_verified' && onDepositVerifiedRef.current) {
      onDepositVerifiedRef.current(event)
    }
  }, [])

  /**
   * Connect to SSE stream
   */
  const connectSSE = useCallback(() => {
    // Only connect if enabled and token exists
    if (!enabled || !token) {
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
      const streamUrl = getSSEStreamUrl(token)
      const eventSource = new EventSource(streamUrl)
      eventSourceRef.current = eventSource

      // Handle connection open
      eventSource.onopen = () => {
        setConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
      }

      // Handle messages
      eventSource.onmessage = (event) => {
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
                    name: bookingData.name,
                    email: bookingData.email,
                    event_type: bookingData.eventType || bookingData.event_type,
                    start_date: bookingData.startDate || bookingData.start_date,
                    end_date: bookingData.endDate || bookingData.end_date,
                    start_time: bookingData.startTime || bookingData.start_time,
                    end_time: bookingData.endTime || bookingData.end_time,
                    updated_at: bookingData.updatedAt || bookingData.updated_at,
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
      setError(initError instanceof Error ? initError : new Error(String(initError)))
      setConnected(false)
    }
  }, [enabled, token, handleBookingEvent])

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
    booking,
    connected,
    loaded,
    error,
    lastEvent,
  }
}




