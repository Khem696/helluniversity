"use client"

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_PATHS } from '@/lib/api-config'

interface AdminStats {
  bookings: {
    pending: number
  }
  emailQueue: {
    pending: number
    failed: number
    total: number
  }
}

interface UseAdminStatsOptions {
  refetchInterval?: number
  enabled?: boolean
}

interface UseAdminStatsReturn {
  stats: AdminStats | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  invalidate: () => void
}

  /**
   * Hook to fetch admin statistics using React Query
   * 
   * Benefits over polling:
   * - Automatic caching and deduplication
   * - Refetch on window focus
   * - Refetch on network reconnect
   * - Event-based invalidation (when actions happen)
   * - Better error handling and retry logic
   * - No unnecessary requests when data is fresh
   * - Automatic invalidation on custom events
   */
export function useAdminStats(options: UseAdminStatsOptions = {}): UseAdminStatsReturn {
  const { refetchInterval = 30000, enabled = true } = options
  const queryClient = useQueryClient()

  const {
    data,
    isLoading,
    error,
    refetch: refetchQuery,
  } = useQuery<AdminStats>({
    queryKey: ['adminStats'],
    queryFn: async () => {
      const response = await fetch(API_PATHS.adminStats)
      const json = await response.json()
      
      if (!json.success || !json.data) {
        throw new Error(json.error?.message || json.error || "Failed to load statistics")
      }
      
      return json.data
    },
    refetchInterval, // Auto-refetch every 30 seconds (fallback)
    refetchIntervalInBackground: false, // Only refetch when tab is visible
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true, // Refetch when network reconnects
    staleTime: 10000, // Consider data fresh for 10 seconds (no refetch needed)
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    enabled,
    retry: 2, // Retry failed requests 2 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
  })

  // Listen for custom invalidation events (when booking actions happen)
  React.useEffect(() => {
    const handleInvalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['adminStats'] })
    }

    window.addEventListener('invalidateAdminStats', handleInvalidate)
    return () => {
      window.removeEventListener('invalidateAdminStats', handleInvalidate)
    }
  }, [queryClient])

  const refetch = async () => {
    await refetchQuery()
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminStats'] })
  }

  return {
    stats: data || null,
    loading: isLoading,
    error: error as Error | null,
    refetch,
    invalidate,
  }
}

/**
 * Hook to invalidate admin stats cache
 * Call this after actions that might change stats (e.g., booking status update)
 */
export function useInvalidateAdminStats() {
  const queryClient = useQueryClient()
  
  return () => {
    queryClient.invalidateQueries({ queryKey: ['adminStats'] })
  }
}
