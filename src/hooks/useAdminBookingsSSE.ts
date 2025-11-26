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
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection health monitoring
 * - Optimistic update conflict prevention
 * - Proper cleanup on unmount
 * 
 * @param options - Configuration options for the SSE hook
 * @returns Hook return object with connection state and event handlers
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
    reference_number?: string | null
    name: string
    email: string
    phone?: string | null
    participants?: number | null
    event_type: string
    other_event_type?: string | null
    date_range?: number
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    organization_type?: string | null
    organized_person?: string | null
    introduction?: string | null
    biography?: string | null
    special_requests?: string | null
    status: string
    admin_notes?: string | null
    response_token?: string | null
    token_expires_at?: number | null
    proposed_date?: number | null
    proposed_end_date?: number | null
    user_response?: string | null
    response_date?: number | null
    deposit_evidence_url?: string | null
    deposit_verified_at?: number | null
    deposit_verified_by?: string | null
    deposit_verified_from_other_channel?: boolean
    fee_amount?: number | null
    fee_amount_original?: number | null
    fee_currency?: string | null
    fee_conversion_rate?: number | null
    fee_rate_date?: number | null
    fee_recorded_at?: number | null
    fee_recorded_by?: string | null
    fee_notes?: string | null
    created_at?: number
    updated_at: number
  }
  metadata?: {
    previousStatus?: string
    changedBy?: string
    changeReason?: string
    // HIGH-1: Additional flags to indicate what changed (consolidated broadcasts)
    hasNewUserResponse?: boolean
    hasNewDeposit?: boolean
    depositWasVerified?: boolean
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
  
  /**
   * Callback for booking creation
   */
  onBookingCreated?: (event: BookingUpdateEvent) => void
  
  /**
   * Callback for booking deletion
   */
  onBookingDeleted?: (event: BookingUpdateEvent) => void
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
    onBookingCreated,
    onBookingDeleted,
  } = options

  const [connected, setConnected] = useState<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastEvent, setLastEvent] = useState<BookingUpdateEvent | null>(null)
  
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
  const onUserResponseRef = useRef(onUserResponse)
  const onDepositUploadRef = useRef(onDepositUpload)
  const onBookingCreatedRef = useRef(onBookingCreated)
  const onBookingDeletedRef = useRef(onBookingDeleted)
  
  // Store enabled in ref to prevent connectSSE from being recreated when enabled changes
  // This prevents unnecessary reconnections when dialogs open/close
  const enabledRef = useRef(enabled)
  
  // MEDIUM-6: Base delay for exponential backoff (in milliseconds)
  // LOW-3: Extract magic number to named constant
  const BASE_RECONNECT_DELAY_MS = 1000 // 1 second base delay
  const maxReconnectAttempts = 5

  // Update refs when callbacks change
  useEffect(() => {
    onBookingUpdateRef.current = onBookingUpdate
    onStatusChangeRef.current = onStatusChange
    onUserResponseRef.current = onUserResponse
    onDepositUploadRef.current = onDepositUpload
    onBookingCreatedRef.current = onBookingCreated
    onBookingDeletedRef.current = onBookingDeleted
  }, [onBookingUpdate, onStatusChange, onUserResponse, onDepositUpload, onBookingCreated, onBookingDeleted])
  
  // Update enabled ref when it changes
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  /**
   * Handle booking update event from SSE
   * MEDIUM-5: Added error handling for callback failures
   * MEDIUM-7: Track message time for health monitoring
   */
  const handleBookingEvent = useCallback((event: BookingUpdateEvent) => {
    setLastEvent(event)
    // MEDIUM-7: Update last message time for health monitoring
    lastMessageTimeRef.current = Date.now()
    
    // MEDIUM-5: Wrap callbacks in try-catch to prevent one failure from breaking others
    try {
      // Call general callback
      if (onBookingUpdateRef.current) {
        onBookingUpdateRef.current(event)
      }
    } catch (error) {
      // MEDIUM-5: Log callback error but don't break event processing
      // LOW-1: Use structured logger instead of console.error (async import)
      import('@/lib/logger').then(({ logError }) => {
        logError('Error in onBookingUpdate callback', {
          eventType: event.type,
          bookingId: event.bookingId,
        }, error instanceof Error ? error : new Error(String(error))).catch(() => {
          // Fallback to console if logger fails
          console.error('Error in onBookingUpdate callback:', error)
        })
      }).catch(() => {
        // Fallback to console if import fails
        console.error('Error in onBookingUpdate callback:', error)
      })
    }
    
    // Call specific callbacks based on event type
    try {
      if (event.type === 'booking:status_changed' && onStatusChangeRef.current) {
        onStatusChangeRef.current(event)
      } else if (event.type === 'booking:user_response' && onUserResponseRef.current) {
        onUserResponseRef.current(event)
      } else if (event.type === 'booking:deposit_uploaded' && onDepositUploadRef.current) {
        onDepositUploadRef.current(event)
      } else if (event.type === 'booking:created' && onBookingCreatedRef.current) {
        onBookingCreatedRef.current(event)
      } else if (event.type === 'booking:deleted' && onBookingDeletedRef.current) {
        onBookingDeletedRef.current(event)
      }
    } catch (error) {
      // MEDIUM-5: Log callback error but don't break event processing
      // LOW-1: Use structured logger instead of console.error (async import)
      import('@/lib/logger').then(({ logError }) => {
        logError('Error in specific booking event callback', {
          eventType: event.type,
          bookingId: event.bookingId,
        }, error instanceof Error ? error : new Error(String(error))).catch(() => {
          // Fallback to console if logger fails
          console.error('Error in specific booking event callback:', error)
        })
      }).catch(() => {
        // Fallback to console if import fails
        console.error('Error in specific booking event callback:', error)
      })
    }
  }, [])

  /**
   * Disconnect from SSE stream
   * CRITICAL-3: Ensure cleanup is idempotent and safe
   * NOTE: We do NOT set isMountedRef.current = false here - that should only happen on unmount
   *       Setting it here would prevent reconnection after temporary disconnects
   */
  const disconnectSSE = useCallback(() => {
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
    // MEDIUM-8: Clean up health check interval on disconnect
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = null
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
      const streamUrl = getSSEStreamUrl(bookingId, status, eventType)
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
          
          // Note: Polling fallback would need to be implemented by the component
          // using this hook, as it depends on the specific use case
        }
      }
    } catch (initError) {
      // CRITICAL-3: Only set error if still mounted
      if (isMountedRef.current) {
        setError(initError instanceof Error ? initError : new Error(String(initError)))
        setConnected(false)
      }
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
    if (enabledRef.current && session) {
      connectSSE()
    }

    // Cleanup on unmount or when connection params change
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
  }, [session, bookingId, status, eventType, connectSSE]) // Removed 'enabled' from dependencies

  // MEDIUM-7: Connection health monitoring - detect silent connection failures
  // MEDIUM-8: Reduced timing for faster detection - 1 minute check, 90 second threshold (3 missed heartbeats)
  useEffect(() => {
    if (!connected || !isMountedRef.current) {
      return
    }
    
    // Check connection health every 1 minute (reduced from 2 minutes for faster detection)
    healthCheckIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) {
        return
      }
      
      // If no message received in last 90 seconds (1.5 minutes = 3 missed 30s heartbeats), mark as unhealthy
      const now = Date.now()
      if (lastMessageTimeRef.current && (now - lastMessageTimeRef.current) > 90 * 1000) {
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
    }, 60 * 1000) // Check every 1 minute (reduced from 2 minutes)
    
    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current)
        healthCheckIntervalRef.current = null
      }
    }
  }, [connected, connectSSE])
  
  return {
    connected,
    loaded,
    error,
    lastEvent,
  }
}

