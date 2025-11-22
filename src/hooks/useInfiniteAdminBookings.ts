"use client"

import React from 'react'
import { useInfiniteQuery, useQueryClient, InfiniteData } from '@tanstack/react-query'
import { API_PATHS, buildApiUrl } from '@/lib/api-config'
import { Booking } from './useAdminBookings'

export type { Booking }

interface UseInfiniteAdminBookingsOptions {
  baseEndpoint: string // Endpoint without limit/offset
  pageSize?: number
  refetchInterval?: number
  enabled?: boolean
  isDialogOpen?: () => boolean | boolean
}

interface UseInfiniteAdminBookingsReturn {
  bookings: Booking[]
  total: number
  loading: boolean // Only true on initial load (no data yet)
  isFetching: boolean // True when fetching (including refetches with existing data)
  error: Error | null
  hasMore: boolean
  loadMore: () => Promise<void>
  refetch: () => Promise<void>
  invalidate: () => void
  updateItem: (id: string, updates: Partial<Booking>) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: Booking) => void
}

/**
 * Hook for infinite scroll/lazy loading of admin bookings
 * Accumulates data across pages
 */
export function useInfiniteAdminBookings(
  options: UseInfiniteAdminBookingsOptions
): UseInfiniteAdminBookingsReturn {
  const { baseEndpoint, pageSize = 25, refetchInterval = 30000, enabled = true, isDialogOpen } = options
  const queryClient = useQueryClient()

  // Helper to check if dialog is open
  const checkDialogOpen = React.useCallback(() => {
    if (typeof isDialogOpen === 'function') {
      return isDialogOpen()
    }
    return isDialogOpen === true
  }, [isDialogOpen])

  // Keep track of previous data across query key changes
  const previousDataRef = React.useRef<{ pages: Array<{ bookings: Booking[]; total: number }>; pageParams: number[] } | undefined>(undefined)

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    refetch: refetchQuery,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery<{ bookings: Booking[]; total: number }, Error, InfiniteData<{ bookings: Booking[]; total: number }, number>, string[], number>({
    queryKey: ['infiniteAdminBookings', baseEndpoint],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(baseEndpoint.split('?')[1] || '')
      params.set('limit', pageSize.toString())
      params.set('offset', (pageParam as number).toString())
      
      // Ensure base path has trailing slash to prevent 308 redirects
      let basePath = baseEndpoint.split('?')[0]
      if (!basePath.endsWith('/')) {
        basePath += '/'
      }
      
      const url = basePath + '?' + params.toString()
      const response = await fetch(url)
      const json = await response.json()
      
      if (!json.success) {
        throw new Error(json.error?.message || json.error || "Failed to load bookings")
      }
      
      const bookings = json.data?.bookings || json.bookings || []
      const total = json.data?.pagination?.total || json.data?.total || 0
      
      // Debug logging (remove in production if needed)
      if (process.env.NODE_ENV === 'development' && bookings.length > 0) {
        console.log('[useInfiniteAdminBookings] Received bookings:', {
          count: bookings.length,
          sampleBooking: {
            id: bookings[0].id,
            reference_number: bookings[0].reference_number,
            fee_amount: bookings[0].fee_amount,
            feeAmount: bookings[0].feeAmount,
            fee_currency: bookings[0].fee_currency,
            feeCurrency: bookings[0].feeCurrency,
            hasFee: !!(bookings[0].fee_amount || bookings[0].feeAmount),
            bookingKeys: Object.keys(bookings[0]).filter(k => k.toLowerCase().includes('fee')),
          },
          bookingsWithFee: bookings.filter((b: any) => (b.fee_amount || b.feeAmount) && Number(b.fee_amount || b.feeAmount) > 0).length,
        })
      }
      
      return { bookings, total }
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + (page?.bookings?.length || 0), 0)
      const total = lastPage?.total || 0
      if (loadedCount < total) {
        return loadedCount
      }
      return undefined
    },
    refetchInterval: (query) => {
      if (checkDialogOpen()) {
        return false
      }
      // Only refetch if data is stale (older than staleTime)
      const dataUpdatedAt = query.state.dataUpdatedAt
      if (dataUpdatedAt && Date.now() - dataUpdatedAt < 30000) {
        // Data is fresh (less than 30 seconds old), don't refetch yet
        return false
      }
      return refetchInterval
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false, // Disable to prevent excessive refetches
    refetchOnReconnect: true,
    staleTime: 60000, // Increase staleTime to 60 seconds to reduce refetch frequency
    gcTime: 5 * 60 * 1000,
    enabled: enabled && !checkDialogOpen(),
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    // Keep previous data while fetching new data to prevent list from disappearing
    // When query key changes, use the ref to maintain previous data across different query keys
    placeholderData: (previousData) => {
      // If we have previousData for the same query, use it
      if (previousData) {
        return previousData
      }
      // If query key changed (no previousData), use the ref to keep showing last known data
      if (previousDataRef.current) {
        return previousDataRef.current
      }
      // No data available
      return undefined
    },
  })

  // Update ref when data changes (so we can use it for next query key change)
  React.useEffect(() => {
    if (data) {
      previousDataRef.current = data
    }
  }, [data])

  // Flatten all pages into single array
  const bookings = React.useMemo(() => {
    return data?.pages.flatMap((page: { bookings: Booking[]; total: number }) => page.bookings) || []
  }, [data])

  // Get total from first page (should be consistent)
  const total = data?.pages[0]?.total || 0

  // Optimistic update functions
  const updateItem = React.useCallback((id: string, updates: Partial<Booking>) => {
    queryClient.setQueryData(['infiniteAdminBookings', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { bookings: Booking[]; total: number }) => ({
          ...page,
          bookings: page.bookings.map(item => item.id === id ? { ...item, ...updates } : item)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  const removeItem = React.useCallback((id: string) => {
    queryClient.setQueryData(['infiniteAdminBookings', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { bookings: Booking[]; total: number }) => ({
          ...page,
          bookings: page.bookings.filter((item: Booking) => item.id !== id),
          total: Math.max(0, page.total - 1)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  const replaceItem = React.useCallback((id: string, newItem: Booking) => {
    queryClient.setQueryData(['infiniteAdminBookings', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { bookings: Booking[]; total: number }) => ({
          ...page,
          bookings: page.bookings.map((item: Booking) => item.id === id ? newItem : item)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  // Listen for custom invalidation events
  React.useEffect(() => {
    const handleInvalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['infiniteAdminBookings'] })
    }

    window.addEventListener('invalidateAdminBookings', handleInvalidate)
    return () => {
      window.removeEventListener('invalidateAdminBookings', handleInvalidate)
    }
  }, [queryClient])

  const loadMore = async () => {
    if (hasNextPage && !isFetchingNextPage) {
      await fetchNextPage()
    }
  }

  const refetch = async () => {
    await refetchQuery()
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['infiniteAdminBookings'] })
  }

  return {
    bookings,
    total,
    loading: isLoading, // Only true on initial load, not when refetching
    isFetching, // True when fetching new data (including refetches)
    error: error as Error | null,
    hasMore: hasNextPage || false,
    loadMore,
    refetch,
    invalidate,
    updateItem,
    removeItem,
    replaceItem,
  }
}

