"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

interface UseInfiniteAdminDataOptions<T> {
  baseEndpoint: string // Endpoint without limit/offset
  pageSize?: number
  pollInterval?: number
  enablePolling?: boolean
  onPoll?: (data: T[]) => void
  transformResponse?: (response: any) => T[]
  compareItems?: (a: T, b: T) => boolean
  isDialogOpen?: () => boolean | boolean
}

interface UseInfiniteAdminDataReturn<T> {
  data: T[]
  total: number
  loading: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => Promise<void>
  fetchData: () => Promise<void>
  updateItem: (id: string, updates: Partial<T>) => void
  addItem: (item: T) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: T) => void
  setData: React.Dispatch<React.SetStateAction<T[]>>
}

function getItemId<T>(item: T): string | null {
  if (typeof item !== 'object' || item === null) return null
  const obj = item as any
  return obj.id || obj.booking_id || obj.event_id || obj.image_id || null
}

/**
 * Hook for infinite scroll/lazy loading with manual state management
 * For use with APIs that don't use React Query
 */
export function useInfiniteAdminData<T extends { id?: string; [key: string]: any }>(
  options: UseInfiniteAdminDataOptions<T>
): UseInfiniteAdminDataReturn<T> {
  const {
    baseEndpoint,
    pageSize = 25,
    pollInterval = 30000,
    enablePolling = false,
    onPoll,
    transformResponse,
    isDialogOpen
  } = options

  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadedPages, setLoadedPages] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  
  const originalDataRef = useRef<T[]>([])
  const lastFetchTimeRef = useRef<number>(0)
  
  const checkDialogOpen = useCallback(() => {
    if (typeof isDialogOpen === 'function') {
      return isDialogOpen()
    }
    return isDialogOpen === true
  }, [isDialogOpen])

  const transformData = useCallback((json: any): T[] => {
    if (transformResponse) {
      return transformResponse(json)
    }
    
    if (Array.isArray(json.data)) {
      return json.data
    }
    if (Array.isArray(json.data?.items)) {
      return json.data.items
    }
    if (Array.isArray(json.data?.events)) {
      return json.data.events
    }
    if (Array.isArray(json.events)) {
      return json.events
    }
    
    return []
  }, [transformResponse])

  const fetchPage = useCallback(async (pageNumber: number, showLoading: boolean = true) => {
    if (checkDialogOpen() && showLoading) {
      return
    }
    
    try {
      if (showLoading && !checkDialogOpen()) {
        if (pageNumber === 0) {
          setLoading(true)
        } else {
          setIsLoadingMore(true)
        }
      }
      setError(null)
      
      const params = new URLSearchParams(baseEndpoint.split('?')[1] || '')
      params.set('limit', pageSize.toString())
      params.set('offset', (pageNumber * pageSize).toString())
      
      const url = baseEndpoint.split('?')[0] + '?' + params.toString()
      const response = await fetch(url)
      const json = await response.json()
      
      if (json.success) {
        const newItems = transformData(json)
        const pageTotal = json.data?.pagination?.total || json.data?.total || 0
        
        if (pageNumber === 0) {
          // First page - replace data
          setData(newItems)
          setTotal(pageTotal)
          setLoadedPages(1)
          originalDataRef.current = newItems
          setHasMore(newItems.length < pageTotal)
        } else {
          // Subsequent pages - append data
          setData(prev => {
            const combined = [...prev, ...newItems]
            originalDataRef.current = combined
            setHasMore(combined.length < pageTotal)
            return combined
          })
          setLoadedPages(prev => prev + 1)
        }
        
        lastFetchTimeRef.current = Date.now()
        
        if (onPoll && pageNumber > 0) {
          onPoll(newItems)
        }
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to load data"
        setError(new Error(errorMessage))
        if (pageNumber === 0) {
          toast.error(errorMessage)
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      if (pageNumber === 0) {
        toast.error("Failed to load data")
      }
      console.error("Error fetching data:", error)
    } finally {
      if (showLoading && !checkDialogOpen()) {
        if (pageNumber === 0) {
          setLoading(false)
        } else {
          setIsLoadingMore(false)
        }
      }
    }
  }, [baseEndpoint, pageSize, transformData, onPoll, checkDialogOpen, data.length])

  const fetchData = useCallback(async () => {
    await fetchPage(0, true)
  }, [fetchPage])

  const loadMore = useCallback(async () => {
    if (hasMore && !isLoadingMore && !loading) {
      await fetchPage(loadedPages, false)
    }
  }, [hasMore, isLoadingMore, loading, loadedPages, fetchPage])

  const updateItem = useCallback((id: string, updates: Partial<T>) => {
    setData(prev => {
      const updated = prev.map(item => {
        const itemId = getItemId(item)
        return itemId === id ? { ...item, ...updates } : item
      })
      originalDataRef.current = prev
      return updated
    })
  }, [])

  const addItem = useCallback((item: T) => {
    setData(prev => {
      const updated = [item, ...prev]
      originalDataRef.current = prev
      return updated
    })
  }, [])

  const removeItem = useCallback((id: string) => {
    setData(prev => {
      const updated = prev.filter(item => {
        const itemId = getItemId(item)
        return itemId !== id
      })
      originalDataRef.current = prev
      setTotal(prev => Math.max(0, prev - 1))
      return updated
    })
  }, [])

  const replaceItem = useCallback((id: string, newItem: T) => {
    setData(prev => {
      const updated = prev.map(item => {
        const itemId = getItemId(item)
        return itemId === id ? newItem : item
      })
      originalDataRef.current = prev
      return updated
    })
  }, [])

  // Reset and fetch when base endpoint changes (filters change)
  useEffect(() => {
    setData([])
    setLoadedPages(0)
    setHasMore(true)
    setTotal(0)
    fetchData()
  }, [baseEndpoint]) // Reset when endpoint changes (includes filters)

  // Smart polling
  useEffect(() => {
    if (!enablePolling || loading) return

    let intervalId: NodeJS.Timeout | null = null

    const startPolling = () => {
      if (document.visibilityState === 'visible' && !checkDialogOpen()) {
        intervalId = setInterval(() => {
          fetchPage(0, false) // Refresh first page only
        }, pollInterval)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling()
      } else {
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enablePolling, pollInterval, fetchPage, loading, checkDialogOpen])

  return {
    data,
    total,
    loading: loading || isLoadingMore,
    error,
    hasMore,
    loadMore,
    fetchData,
    updateItem,
    addItem,
    removeItem,
    replaceItem,
    setData,
  }
}

