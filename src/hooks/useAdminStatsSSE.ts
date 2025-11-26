/**
 * Hook for subscribing to admin statistics updates via Server-Sent Events (SSE)
 * 
 * This hook provides real-time updates for admin statistics including:
 * - Pending bookings count
 * - Email queue statistics
 * 
 * Automatically handles reconnection and fallback to polling if SSE fails.
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { API_PATHS } from "@/lib/api-config"

export interface AdminStats {
  bookings: {
    pending: number
  }
  emailQueue: {
    pending: number
    failed: number
    total: number
  }
}

export interface StatsUpdateEvent {
  type: 'stats:updated'
  stats: AdminStats
  timestamp: number
}

interface UseAdminStatsSSEOptions {
  /**
   * Whether to enable the hook
   */
  enabled?: boolean
  
  /**
   * Callback when stats update is received
   */
  onStatsUpdate?: (stats: AdminStats) => void
}

interface UseAdminStatsSSEReturn {
  /**
   * Current stats (null until first update)
   */
  stats: AdminStats | null
  
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
}

/**
 * Get SSE stream URL
 */
function getSSEStreamUrl(): string {
  return API_PATHS.adminStatsStream
}

export function useAdminStatsSSE(
  options: UseAdminStatsSSEOptions = {}
): UseAdminStatsSSEReturn {
  const { data: session } = useSession()
  const {
    enabled = true,
    onStatsUpdate,
  } = options

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [connected, setConnected] = useState<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const fallbackPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // CRITICAL-3: Track if component is mounted to prevent operations after unmount
  const isMountedRef = useRef<boolean>(true)
  
  // Store callbacks in refs to prevent recreation and stale closures
  const onStatsUpdateRef = useRef(onStatsUpdate)
  const enabledRef = useRef(enabled)
  
  // MEDIUM-6: Base delay for exponential backoff (in milliseconds)
  const BASE_RECONNECT_DELAY_MS = 1000 // 1 second base delay
  const maxReconnectAttempts = 5

  // Update refs when callbacks change
  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate
  }, [onStatsUpdate])

  // Update enabled ref
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  /**
   * Handle stats update event from SSE
   * MEDIUM-5: Added try-catch around callbacks to prevent one failure from breaking others
   */
  const handleStatsEvent = useCallback((event: StatsUpdateEvent) => {
    setStats(event.stats)
    
    // MEDIUM-5: Call callback with try-catch
    if (onStatsUpdateRef.current) {
      try {
        onStatsUpdateRef.current(event.stats)
      } catch (error) {
        console.error('Error in onStatsUpdate callback:', error)
      }
    }
  }, [])

  /**
   * Disconnect from SSE stream
   * CRITICAL-3: Ensure cleanup is idempotent and safe
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
          
          const data = JSON.parse(event.data) as StatsUpdateEvent
          if (data.type === 'stats:updated') {
            handleStatsEvent(data)
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
          
          // Fallback polling (every 30 seconds)
          if (!fallbackPollIntervalRef.current) {
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
                const response = await fetch(API_PATHS.adminStats)
                const json = await response.json()
                
                if (json.success && json.data) {
                  const statsData = json.data as AdminStats
                  setStats(statsData)
                  if (onStatsUpdateRef.current) {
                    try {
                      onStatsUpdateRef.current(statsData)
                    } catch (error) {
                      console.error('Error in onStatsUpdate callback:', error)
                    }
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
      // CRITICAL-3: Only set error if still mounted
      if (isMountedRef.current) {
        setError(initError instanceof Error ? initError : new Error(String(initError)))
        setConnected(false)
      }
    }
  }, [session, handleStatsEvent]) // Removed 'enabled' from dependencies

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
      disconnectSSE()
    }
  }, [session, connectSSE, disconnectSSE]) // Removed 'enabled' from dependencies

  return {
    stats,
    connected,
    loaded,
    error,
  }
}

