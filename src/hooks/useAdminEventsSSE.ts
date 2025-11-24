/**
 * Hook for subscribing to admin event updates via Server-Sent Events (SSE)
 * 
 * This hook provides real-time updates for event changes including:
 * - Event creation
 * - Event updates
 * - Event deletion
 * 
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { API_PATHS } from "@/lib/api-config"

export interface Event {
  id: string
  title: string
  description?: string | null
  image_id?: string | null
  event_date?: number | null
  start_date?: number | null
  end_date?: number | null
  image_url?: string | null
  image_title?: string | null
  created_at: number
  updated_at: number
}

export interface EventUpdateEvent {
  type: 'event:created' | 'event:updated' | 'event:deleted' | 'events:initial'
  event?: Event
  events?: Event[]
  timestamp: number
}

interface UseAdminEventsSSEOptions {
  /**
   * Whether to enable the hook
   */
  enabled?: boolean
  
  /**
   * Callback when event update is received
   */
  onEventUpdate?: (event: EventUpdateEvent) => void
  
  /**
   * Callback for event creation
   */
  onEventCreated?: (event: Event) => void
  
  /**
   * Callback for event updates
   */
  onEventUpdated?: (event: Event) => void
  
  /**
   * Callback for event deletion
   */
  onEventDeleted?: (eventId: string) => void
}

interface UseAdminEventsSSEReturn {
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
  lastEvent: EventUpdateEvent | null
}

/**
 * Get SSE stream URL
 */
function getSSEStreamUrl(): string {
  return API_PATHS.adminEventsStream
}

export function useAdminEventsSSE(
  options: UseAdminEventsSSEOptions = {}
): UseAdminEventsSSEReturn {
  const { data: session } = useSession()
  const {
    enabled = true,
    onEventUpdate,
    onEventCreated,
    onEventUpdated,
    onEventDeleted,
  } = options

  const [connected, setConnected] = useState<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastEvent, setLastEvent] = useState<EventUpdateEvent | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onEventUpdateRef = useRef(onEventUpdate)
  const onEventCreatedRef = useRef(onEventCreated)
  const onEventUpdatedRef = useRef(onEventUpdated)
  const onEventDeletedRef = useRef(onEventDeleted)
  const enabledRef = useRef(enabled)
  
  const maxReconnectAttempts = 5
  const reconnectDelay = 3000 // 3 seconds

  // Update refs when callbacks change
  useEffect(() => {
    onEventUpdateRef.current = onEventUpdate
    onEventCreatedRef.current = onEventCreated
    onEventUpdatedRef.current = onEventUpdated
    onEventDeletedRef.current = onEventDeleted
  }, [onEventUpdate, onEventCreated, onEventUpdated, onEventDeleted])

  // Update enabled ref
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  /**
   * Handle event update from SSE
   */
  const handleEventUpdate = useCallback((event: EventUpdateEvent) => {
    setLastEvent(event)
    
    // Call general callback
    if (onEventUpdateRef.current) {
      onEventUpdateRef.current(event)
    }
    
    // Call specific callbacks based on event type
    if (event.type === 'event:created' && event.event && onEventCreatedRef.current) {
      onEventCreatedRef.current(event.event)
    } else if (event.type === 'event:updated' && event.event && onEventUpdatedRef.current) {
      onEventUpdatedRef.current(event.event)
    } else if (event.type === 'event:deleted' && event.event && onEventDeletedRef.current) {
      onEventDeletedRef.current(event.event.id)
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
    if (fallbackPollIntervalRef.current) {
      clearInterval(fallbackPollIntervalRef.current)
      fallbackPollIntervalRef.current = null
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
          
          const data = JSON.parse(event.data) as EventUpdateEvent
          handleEventUpdate(data)
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
          
          // Fallback polling (every 30 seconds)
          if (!fallbackPollIntervalRef.current) {
            fallbackPollIntervalRef.current = setInterval(async () => {
              try {
                const response = await fetch(API_PATHS.adminEvents)
                const json = await response.json()
                
                if (json.success && json.data) {
                  // Trigger update if available
                  if (json.data.events && onEventUpdateRef.current) {
                    // Create synthetic update event for polling
                    json.data.events.forEach((event: Event) => {
                      handleEventUpdate({
                        type: 'event:updated',
                        event,
                        timestamp: Date.now(),
                      })
                    })
                  }
                }
              } catch (fetchError) {
                // Silently handle polling errors
              }
            }, 30000) // Poll every 30 seconds as fallback
          }
        }
      }
    } catch (initError) {
      setError(initError instanceof Error ? initError : new Error(String(initError)))
      setConnected(false)
    }
  }, [session, handleEventUpdate]) // Removed 'enabled' from dependencies

  /**
   * Handle enabled state changes (disconnect when disabled, connect when enabled)
   * This is separate from the main connection effect to avoid unnecessary reconnections
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
   * This effect handles reconnection when connection parameters (session) change
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
      disconnectSSE()
    }
  }, [session, connectSSE, disconnectSSE]) // Removed 'enabled' from dependencies

  return {
    connected,
    loaded,
    error,
    lastEvent,
  }
}

