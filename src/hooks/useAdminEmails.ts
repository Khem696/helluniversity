"use client"

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_PATHS, buildApiUrl } from '@/lib/api-config'

export interface EmailQueueItem {
  id: string
  emailType: string
  recipientEmail: string
  subject: string
  htmlContent: string
  textContent: string
  metadata?: Record<string, any> | string
  retryCount: number
  maxRetries: number
  status: string
  errorMessage?: string
  scheduledAt: number
  nextRetryAt?: number
  sentAt?: number
  createdAt: number
  updatedAt: number
}

export interface EmailQueueStats {
  pending: number
  processing: number
  failed: number
  sent: number
  total: number
}

interface UseAdminEmailsOptions {
  endpoint: string
  refetchInterval?: number
  enabled?: boolean
  isDialogOpen?: () => boolean | boolean
  onStatsUpdate?: (stats: EmailQueueStats) => void
}

interface UseAdminEmailsReturn {
  emails: EmailQueueItem[]
  total: number
  stats: EmailQueueStats | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  invalidate: () => void
  updateItem: (id: string, updates: Partial<EmailQueueItem>) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: EmailQueueItem) => void
}

/**
 * Hook to fetch admin email queue using React Query
 * 
 * Benefits:
 * - Automatic caching and deduplication
 * - Refetch on window focus
 * - Refetch on network reconnect
 * - Event-based invalidation (when actions happen)
 * - Better error handling and retry logic
 */
export function useAdminEmails(options: UseAdminEmailsOptions): UseAdminEmailsReturn {
  const { endpoint, refetchInterval = 30000, enabled = true, isDialogOpen, onStatsUpdate } = options
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
  } = useQuery<{ items: EmailQueueItem[]; total: number; stats: EmailQueueStats }>({
    queryKey: ['adminEmails', endpoint],
    queryFn: async () => {
      const response = await fetch(endpoint)
      const json = await response.json()
      
      if (!json.success) {
        throw new Error(json.error?.message || json.error || "Failed to load emails")
      }
      
      const responseData = json.data || json
      const items = responseData.items || []
      const total = responseData.total || items.length
      const stats = responseData.stats || {}
      
      // Call stats update callback if provided
      if (onStatsUpdate) {
        onStatsUpdate(stats)
      }
      
      return { items, total, stats }
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

  // Listen for custom invalidation events (when email actions happen)
  React.useEffect(() => {
    const handleInvalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['adminEmails'] })
    }

    window.addEventListener('invalidateAdminEmails', handleInvalidate)
    return () => {
      window.removeEventListener('invalidateAdminEmails', handleInvalidate)
    }
  }, [queryClient])

  const refetch = async () => {
    await refetchQuery()
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminEmails'] })
  }

  // Optimistic update functions
  const updateItem = React.useCallback((id: string, updates: Partial<EmailQueueItem>) => {
    queryClient.setQueryData<{ items: EmailQueueItem[]; total: number; stats: EmailQueueStats }>(['adminEmails', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map(item => item.id === id ? { ...item, ...updates } : item)
      }
    })
  }, [queryClient, endpoint])

  const removeItem = React.useCallback((id: string) => {
    queryClient.setQueryData<{ items: EmailQueueItem[]; total: number; stats: EmailQueueStats }>(['adminEmails', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.filter(item => item.id !== id),
        total: Math.max(0, old.total - 1)
      }
    })
  }, [queryClient, endpoint])

  const replaceItem = React.useCallback((id: string, newItem: EmailQueueItem) => {
    queryClient.setQueryData<{ items: EmailQueueItem[]; total: number; stats: EmailQueueStats }>(['adminEmails', endpoint], (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map(item => item.id === id ? newItem : item)
      }
    })
  }, [queryClient, endpoint])

  return {
    emails: data?.items || [],
    total: data?.total || 0,
    stats: data?.stats || null,
    loading: isLoading,
    error: error as Error | null,
    refetch,
    invalidate,
    updateItem,
    removeItem,
    replaceItem,
  }
}

