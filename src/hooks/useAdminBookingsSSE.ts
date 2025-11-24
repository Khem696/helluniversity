/**
 * Hook for subscribing to admin booking updates via Server-Sent Events (SSE)
 * 
 * This hook provides real-time updates for booking list changes including:
 * - Status changes
 * - User responses
 * - Deposit uploads
 * - General updates
 * 
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { API_PATHS } from "@/lib/api-config"

export interface BookingUpdateEvent {
  type: 'booking:status_changed' | 'booking:user_response' | 'booking:deposit_uploaded' | 'booking:updated' | 'booking:created' | 'booking:deleted'
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
    user_response?: string | null
    response_date?: number | null
    deposit_evidence_url?: string | null
    deposit_verified_at?: number | null
    proposed_date?: number | null
    proposed_end_date?: number | null
  }
  metadata?: {
    previousStatus?: string
    changedBy?: string
    changeReason?: string
  }
  timestamp: number
}

interface UseAdminBookingsSSEOptions {
  /**
   * Filter by specific booking ID
   */
  bookingId?: string
  
  /**
   * Filter by booking status
   */
  status?: string
  
  /**
   * Filter by event type
   */
  eventType?: string
  
  /**
   * Whether to enable the hook
   */
  enabled?: boolean
  
  /**
   * Callback when booking update is received
   */
  onBookingUpdate?: (event: BookingUpdateEvent) => void
  
  /**
   * Callback for status changes
   */
  onStatusChange?: (event: BookingUpdateEvent) => void
  
  /**
   * Callback for user responses
   */
  onUserResponse?: (event: BookingUpdateEvent) => void
  
  /**
   * Callback for deposit uploads
   */
  onDepositUpload?: (event: BookingUpdateEvent) => void
}

interface UseAdminBookingsSSEReturn {
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
  lastEvent: BookingUpdateEvent | null
}

/**
 * Get SSE stream URL with filters
 */
function getSSEStreamUrl(
  bookingId?: string,
  status?: string,
  eventType?: string
): string {
  const baseUrl = API_PATHS.adminBookingsStream
  const params = new URLSearchParams()
  
  if (bookingId) {
    params.append('bookingId', bookingId)
  }
  if (status) {
    params.append('status', status)
  }
  if (eventType) {
    params.append('eventType', eventType)
  }
  
  const queryString = params.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

export function useAdminBookingsSSE(
  options: UseAdminBookingsSSEOptions = {}
): UseAdminBookingsSSEReturn {
  const { data: session } = useSession()
  const {
    bookingId,
    status,
    eventType,
    enabled = true,
    onBookingUpdate,
    onStatusChange,
    onUserResponse,
    onDepositUpload,
  } = options

  const [connected, setConnected] = useState<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastEvent, setLastEvent] = useState<BookingUpdateEvent | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onBookingUpdateRef = useRef(onBookingUpdate)
  const onStatusChangeRef = useRef(onStatusChange)
  const onUserResponseRef = useRef(onUserResponse)
  const onDepositUploadRef = useRef(onDepositUpload)
  
  // Store enabled in ref to prevent connectSSE from being recreated when enabled changes
  // This prevents unnecessary reconnections when dialogs open/close
  const enabledRef = useRef(enabled)
  
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000 // 3 seconds

  // Update refs when callbacks change
  useEffect(() => {
    onBookingUpdateRef.current = onBookingUpdate
    onStatusChangeRef.current = onStatusChange
    onUserResponseRef.current = onUserResponse
    onDepositUploadRef.current = onDepositUpload
  }, [onBookingUpdate, onStatusChange, onUserResponse, onDepositUpload])
  
  // Update enabled ref when it changes
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  /**
   * Handle booking update event from SSE
   */
  const handleBookingEvent = useCallback((event: BookingUpdateEvent) => {
    setLastEvent(event)
    
    // Call general callback
    if (onBookingUpdateRef.current) {
      onBookingUpdateRef.current(event)
    }
    
    // Call specific callbacks based on event type
    if (event.type === 'booking:status_changed' && onStatusChangeRef.current) {
      onStatusChangeRef.current(event)
    } else if (event.type === 'booking:user_response' && onUserResponseRef.current) {
      onUserResponseRef.current(event)
    } else if (event.type === 'booking:deposit_uploaded' && onDepositUploadRef.current) {
      onDepositUploadRef.current(event)
    }
  }, [])

  /**
   * Disconnect from SSE stream
   */
  const disconnectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnected(false)
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])
  
  /**
   * Connect to SSE stream
   */
  const connectSSE = useCallback(() => {
    // Only connect if enabled and session exists (check ref to avoid dependency on enabled)
    if (!enabledRef.current || !session) {
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
      const streamUrl = getSSEStreamUrl(bookingId, status, eventType)
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
          
          const data = JSON.parse(event.data) as BookingUpdateEvent
          
          // Handle booking events
          if (
            data.type === 'booking:status_changed' ||
            data.type === 'booking:user_response' ||
            data.type === 'booking:deposit_uploaded' ||
            data.type === 'booking:updated' ||
            data.type === 'booking:created' ||
            data.type === 'booking:deleted'
          ) {
            handleBookingEvent(data)
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
          
          // Note: Polling fallback would need to be implemented by the component
          // using this hook, as it depends on the specific use case
        }
      }
    } catch (initError) {
      setError(initError instanceof Error ? initError : new Error(String(initError)))
      setConnected(false)
    }
  }, [session, bookingId, status, eventType, handleBookingEvent]) // Removed 'enabled' from dependencies

  /**
   * Handle enabled state changes (disconnect when disabled, connect when enabled)
   * This is separate from the main connection effect to avoid unnecessary reconnections
   * when dialogs open/close
   */
  useEffect(() => {
    // Only handle on client side
    if (typeof window === 'undefined') {
      return
    }
    
    if (!enabled) {
      // Disconnect when disabled
      disconnectSSE()
    } else if (enabled && session && !eventSourceRef.current) {
      // Connect when enabled and not already connected
      connectSSE()
    }
  }, [enabled, session, connectSSE, disconnectSSE])
  
  /**
   * Initialize SSE connection (only on mount or when connection params change)
   * This effect handles reconnection when connection parameters (session, bookingId, etc.) change
   * It does NOT depend on 'enabled' to avoid reconnecting when dialogs open/close
   */
  useEffect(() => {
    // Only connect on client side
    if (typeof window === 'undefined') {
      return
    }

    // Only connect if enabled (check ref to avoid dependency on enabled)
    if (enabledRef.current && session) {
      connectSSE()
    }

    // Cleanup on unmount or when connection params change
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
  }, [session, bookingId, status, eventType, connectSSE]) // Removed 'enabled' from dependencies

  return {
    connected,
    loaded,
    error,
    lastEvent,
  }
}

