"use client"

import React from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { API_PATHS, buildApiUrl } from '@/lib/api-config'
import { EmailQueueItem, EmailQueueStats } from './useAdminEmails'

export type { EmailQueueItem, EmailQueueStats }

interface UseInfiniteAdminEmailsOptions {
  baseEndpoint: string
  pageSize?: number
  refetchInterval?: number | false // false disables polling
  enabled?: boolean
  isDialogOpen?: () => boolean | boolean
  onStatsUpdate?: (stats: EmailQueueStats) => void
}

interface UseInfiniteAdminEmailsReturn {
  emails: EmailQueueItem[]
  total: number
  stats: EmailQueueStats | null
  loading: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => Promise<void>
  refetch: () => Promise<void>
  invalidate: () => void
  updateItem: (id: string, updates: Partial<EmailQueueItem>) => void
  addItem: (item: EmailQueueItem) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: EmailQueueItem) => void
}

/**
 * Hook for infinite scroll/lazy loading of admin emails
 */
export function useInfiniteAdminEmails(
  options: UseInfiniteAdminEmailsOptions
): UseInfiniteAdminEmailsReturn {
  const { baseEndpoint, pageSize = 25, refetchInterval = 30000, enabled = true, isDialogOpen, onStatsUpdate } = options
  // If refetchInterval is explicitly set to false, use it; otherwise use default or provided value
  const actualRefetchInterval = refetchInterval === false ? false : (refetchInterval ?? 30000)
  const queryClient = useQueryClient()

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
    fetchNextPage,
    hasNextPage,
    refetch: refetchQuery,
    isFetchingNextPage,
  } = useInfiniteQuery<{ items: EmailQueueItem[]; total: number; stats: EmailQueueStats }>({
    queryKey: ['infiniteAdminEmails', baseEndpoint],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(baseEndpoint.split('?')[1] || '')
      params.set('limit', pageSize.toString())
      params.set('offset', (pageParam as number).toString())
      
      const url = baseEndpoint.split('?')[0] + '?' + params.toString()
      const response = await fetch(url)
      const json = await response.json()
      
      if (!json.success) {
        throw new Error(json.error?.message || json.error || "Failed to load emails")
      }
      
      const responseData = json.data || json
      const items = responseData.items || []
      const total = responseData.total || items.length
      const stats = responseData.stats || {}
      
      if (onStatsUpdate) {
        onStatsUpdate(stats)
      }
      
      return { items, total, stats }
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + (page?.items?.length || 0), 0)
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
      // If refetchInterval is false, disable polling
      if (actualRefetchInterval === false) {
        return false
      }
      // Only refetch if data is stale (older than staleTime)
      const dataUpdatedAt = query.state.dataUpdatedAt
      if (dataUpdatedAt && Date.now() - dataUpdatedAt < 30000) {
        // Data is fresh (less than 30 seconds old), don't refetch yet
        return false
      }
      return actualRefetchInterval
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 10000,
    gcTime: 5 * 60 * 1000,
    enabled: enabled && !checkDialogOpen(),
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })

  const emails = React.useMemo(() => {
    return data?.pages.flatMap(page => page.items) || []
  }, [data])

  const total = data?.pages[0]?.total || 0
  const stats = data?.pages[0]?.stats || null

  const updateItem = React.useCallback((id: string, updates: Partial<EmailQueueItem>) => {
    queryClient.setQueryData(['infiniteAdminEmails', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { items: EmailQueueItem[]; total: number; stats: EmailQueueStats }) => ({
          ...page,
          items: page.items.map(item => item.id === id ? { ...item, ...updates } : item)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  const removeItem = React.useCallback((id: string) => {
    queryClient.setQueryData(['infiniteAdminEmails', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { items: EmailQueueItem[]; total: number; stats: EmailQueueStats }) => ({
          ...page,
          items: page.items.filter((item: EmailQueueItem) => item.id !== id),
          total: Math.max(0, page.total - 1)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  const addItem = React.useCallback((item: EmailQueueItem) => {
    queryClient.setQueryData(['infiniteAdminEmails', baseEndpoint], (old: any) => {
      // If query data doesn't exist yet (before initial fetch), initialize it with the new item
      if (!old) {
        return {
          pages: [{
            items: [item],
            total: 1,
            stats: {} as EmailQueueStats
          }],
          pageParams: [0]
        }
      }
      
      // Check if email with this ID already exists in any page (deduplication)
      let emailExists = false
      for (const page of old.pages) {
        if (page.items && page.items.some((existingItem: EmailQueueItem) => existingItem.id === item.id)) {
          emailExists = true
          break
        }
      }
      
      // If email already exists, skip adding it to prevent duplicates
      if (emailExists) {
        return old
      }
      
      // Otherwise, add item to the first page (most recent emails)
      return {
        ...old,
        pages: old.pages.map((page: { items: EmailQueueItem[]; total: number; stats: EmailQueueStats }, index: number) => {
          if (index === 0) {
            return {
              ...page,
              items: [item, ...page.items],
              total: (page.total || 0) + 1
            }
          }
          return page
        })
      }
    })
  }, [queryClient, baseEndpoint])

  const replaceItem = React.useCallback((id: string, newItem: EmailQueueItem) => {
    queryClient.setQueryData(['infiniteAdminEmails', baseEndpoint], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: { items: EmailQueueItem[]; total: number; stats: EmailQueueStats }) => ({
          ...page,
          items: page.items.map((item: EmailQueueItem) => item.id === id ? newItem : item)
        }))
      }
    })
  }, [queryClient, baseEndpoint])

  React.useEffect(() => {
    const handleInvalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['infiniteAdminEmails'] })
    }

    window.addEventListener('invalidateAdminEmails', handleInvalidate)
    return () => {
      window.removeEventListener('invalidateAdminEmails', handleInvalidate)
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
    queryClient.invalidateQueries({ queryKey: ['infiniteAdminEmails'] })
  }

  return {
    emails,
    total,
    stats,
    loading: isLoading,
    error: error as Error | null,
    hasMore: hasNextPage || false,
    loadMore,
    refetch,
    invalidate,
    updateItem,
    addItem,
    removeItem,
    replaceItem,
  }
}

