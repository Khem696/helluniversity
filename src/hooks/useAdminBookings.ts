"use client"

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_PATHS, buildApiUrl } from '@/lib/api-config'

export interface Booking {
  id: string
  reference_number: string | null
  name: string
  email: string
  phone: string
  participants: string | null
  event_type: string
  other_event_type: string | null
  date_range: number
  start_date: number
  end_date: number | null
  start_time: string
  end_time: string
  organization_type: string | null
  organized_person: string | null
  introduction: string | null
  biography: string | null
  special_requests: string | null
  status: "pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished"
  admin_notes: string | null
  response_token: string | null
  token_expires_at: number | null
  proposed_date: number | null
  proposed_end_date: number | null
  user_response: string | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
  deposit_verified_by: string | null
  deposit_verified_from_other_channel?: boolean
  fee_amount: number | null
  fee_amount_original: number | null
  fee_currency: string | null
  fee_conversion_rate: number | null
  fee_rate_date: number | null
  fee_recorded_at: number | null
  fee_recorded_by: string | null
  fee_notes: string | null
  created_at: number
  updated_at: number
}

interface UseAdminBookingsOptions {
  endpoint: string
  refetchInterval?: number
  enabled?: boolean
  isDialogOpen?: () => boolean | boolean
}

interface UseAdminBookingsReturn {
  bookings: Booking[]
  total: number
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  invalidate: () => void
  updateItem: (id: string, updates: Partial<Booking>) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: Booking) => void
  setBookings: React.Dispatch<React.SetStateAction<Booking[]>>
}

/**
 * Hook to fetch admin bookings using React Query
 * 
 * Benefits:
 * - Automatic caching and deduplication
 * - Refetch on window focus
 * - Refetch on network reconnect
 * - Event-based invalidation (when actions happen)
 * - Better error handling and retry logic
 */
export function useAdminBookings(options: UseAdminBookingsOptions): UseAdminBookingsReturn {
  const { endpoint, refetchInterval = 30000, enabled = true, isDialogOpen } = options
  const queryClient = useQueryClient()

  // Helper to check if dialog is open
  const checkDialogOpen = React.useCallback(() => {
    if (typeof isDialogOpen === 'function') {
      return isDialogOpen()
    }
    return isDialogOpen === true
  }, [isDialogOpen])

  const {
    data,
    isLoading,
    error,
    refetch: refetchQuery,
  } = useQuery<{ bookings: Booking[]; total: number }>({
    queryKey: ['adminBookings', endpoint],
    queryFn: async () => {
      const response = await fetch(endpoint)
      const json = await response.json()
      
      if (!json.success) {
        throw new Error(json.error?.message || json.error || "Failed to load bookings")
      }
      
      const bookings = json.data?.bookings || json.bookings || []
      const total = json.data?.pagination?.total || json.data?.total || bookings.length
      
      return { bookings, total }
    },
    refetchInterval: (query) => {
      // Don't refetch if dialog is open
      if (checkDialogOpen()) {
        return false
      }
      return refetchInterval
    },
    refetchIntervalInBackground: false, // Only refetch when tab is visible
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true, // Refetch when network reconnects
    staleTime: 10000, // Consider data fresh for 10 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    enabled: enabled && !checkDialogOpen(),
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })

  // Optimistic update functions
  const updateItem = React.useCallback((id: string, updates: Partial<Booking>) => {
    queryClient.setQueryData<{ bookings: Booking[]; total: number }>(['adminBookings', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        bookings: old.bookings.map(item => item.id === id ? { ...item, ...updates } : item)
      }
    })
  }, [queryClient, endpoint])

  const removeItem = React.useCallback((id: string) => {
    queryClient.setQueryData<{ bookings: Booking[]; total: number }>(['adminBookings', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        bookings: old.bookings.filter(item => item.id !== id),
        total: Math.max(0, old.total - 1)
      }
    })
  }, [queryClient, endpoint])

  const replaceItem = React.useCallback((id: string, newItem: Booking) => {
    queryClient.setQueryData<{ bookings: Booking[]; total: number }>(['adminBookings', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        bookings: old.bookings.map(item => item.id === id ? newItem : item)
      }
    })
  }, [queryClient, endpoint])

  const setBookings = React.useCallback((updater: React.SetStateAction<Booking[]>) => {
    queryClient.setQueryData<{ bookings: Booking[]; total: number }>(['adminBookings', endpoint], (old) => {
      if (!old) return { bookings: [], total: 0 }
      const newBookings = typeof updater === 'function' ? updater(old.bookings) : updater
      return {
        ...old,
        bookings: newBookings
      }
    })
  }, [queryClient, endpoint])

  // Listen for custom invalidation events (when booking actions happen)
  React.useEffect(() => {
    const handleInvalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['adminBookings'] })
    }

    window.addEventListener('invalidateAdminBookings', handleInvalidate)
    return () => {
      window.removeEventListener('invalidateAdminBookings', handleInvalidate)
    }
  }, [queryClient])

  const refetch = async () => {
    await refetchQuery()
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminBookings'] })
  }

  return {
    bookings: data?.bookings || [],
    total: data?.total || 0,
    loading: isLoading,
    error: error as Error | null,
    refetch,
    invalidate,
    updateItem,
    removeItem,
    replaceItem,
    setBookings,
  }
}

