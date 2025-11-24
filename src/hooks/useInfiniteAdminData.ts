"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

interface UseInfiniteAdminDataOptions<T> {
  baseEndpoint: string // Endpoint without limit/offset
  pageSize?: number
  pollInterval?: number | false // false disables polling
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
  // If pollInterval is explicitly set to false, use it; otherwise use default or provided value
  const actualPollInterval = pollInterval === false ? false : (pollInterval ?? 30000)

  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadedPages, setLoadedPages] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // Track count of SSE-added items to account for them in hasMore calculations
  const sseAddedCountRef = useRef<number>(0)
  // Track which items are SSE-added (by ID) so we can decrement count when removing them
  const sseAddedItemIdsRef = useRef<Set<string>>(new Set())
  
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
      // Only show loading spinner on initial load, not when filters change
      if (showLoading && !checkDialogOpen() && pageNumber === 0 && data.length === 0) {
        setLoading(true)
      } else if (pageNumber > 0) {
        setIsLoadingMore(true)
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
          // First page - replace data (but keep previous data visible until new data loads)
          // However, preserve SSE-added items that aren't in the fetched data
          // Calculate all values BEFORE state updates to maintain React purity
          // Use ref to get current data (synced with state) for calculations
          const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
          
          // Calculate SSE-added items and totals using the current data
          const fetchedItemIds = new Set(newItems.map(item => getItemId(item)).filter(Boolean))
          const sseAddedItems = currentData.filter(item => {
            const itemId = getItemId(item)
            return itemId && !fetchedItemIds.has(itemId)
          })
          
          // Merge SSE-added items with fetched data (SSE items first, then fetched)
          const mergedData = [...sseAddedItems, ...newItems]
          
          // Calculate total: server total + SSE-added items not in server response
          const sseAddedCount = sseAddedItems.length
          const adjustedTotal = pageTotal + sseAddedCount
          
          // Update all state with calculated values (pure state updates, no side effects)
          setData(mergedData)
          originalDataRef.current = mergedData
          sseAddedCountRef.current = sseAddedCount // Track SSE-added count for subsequent pages
          // Update SSE-added item IDs set to track which items are SSE-added
          sseAddedItemIdsRef.current = new Set(
            sseAddedItems.map(item => getItemId(item)).filter(Boolean) as string[]
          )
          setTotal(adjustedTotal)
          setHasMore(mergedData.length < adjustedTotal)
          setLoadedPages(1)
        } else {
          // Subsequent pages - append data
          // Calculate combined data BEFORE state update to maintain React purity
          // Use ref to get current data (synced with state) for calculations
          const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
          const combined = [...currentData, ...newItems]
          
          // Update state with calculated values (pure state update, no side effects)
          setData(combined)
          originalDataRef.current = combined
          // Account for SSE-added items when calculating hasMore
          const adjustedTotal = pageTotal + sseAddedCountRef.current
          setHasMore(combined.length < adjustedTotal)
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
    // Calculate updated data BEFORE state update to maintain React purity and ref synchronization
    // Use ref as primary source (always in sync), fallback to state only if ref is empty (initial state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
    const updated = currentData.map(item => {
      const itemId = getItemId(item)
      return itemId === id ? { ...item, ...updates } : item
    })
    
    // Update state (pure state update, no side effects)
    setData(updated)
    // Update ref outside state updater to ensure synchronization
    originalDataRef.current = updated
  }, [])

  const addItem = useCallback((item: T) => {
    const itemId = getItemId(item)
    // Calculate updated data BEFORE state update to maintain React purity and ref synchronization
    // Use ref as primary source (always in sync), fallback to state only if ref is empty (initial state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
    const updated = [item, ...currentData]
    
    // Update state (pure state update, no side effects)
    setData(updated)
    // Update ref outside state updater to ensure synchronization
    originalDataRef.current = updated
    
    // Increment total count and SSE-added count to keep them in sync with data
    // Track this item as SSE-added so we can decrement count when removing it
    if (itemId && !sseAddedItemIdsRef.current.has(itemId)) {
      sseAddedItemIdsRef.current.add(itemId)
      sseAddedCountRef.current += 1
    }
    setTotal(prev => prev + 1)
  }, [])

  const removeItem = useCallback((id: string) => {
    // Calculate updated data BEFORE state update to maintain React purity and ref synchronization
    // Use ref as primary source (always in sync), fallback to state only if ref is empty (initial state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
    const updated = currentData.filter(item => {
      const itemId = getItemId(item)
      return itemId !== id
    })
    
    // Update state (pure state update, no side effects)
    setData(updated)
    // Update ref outside state updater to ensure synchronization
    originalDataRef.current = updated
    
    // Decrement total count outside state updater to maintain React purity
    setTotal(prev => Math.max(0, prev - 1))
    // Decrement SSE-added count if this item was SSE-added
    if (sseAddedItemIdsRef.current.has(id)) {
      sseAddedItemIdsRef.current.delete(id)
      sseAddedCountRef.current = Math.max(0, sseAddedCountRef.current - 1)
    }
  }, [])

  const replaceItem = useCallback((id: string, newItem: T) => {
    // Calculate updated data BEFORE state update to maintain React purity and ref synchronization
    // Use ref as primary source (always in sync), fallback to state only if ref is empty (initial state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const currentData = originalDataRef.current.length > 0 ? originalDataRef.current : data
    const updated = currentData.map(item => {
      const itemId = getItemId(item)
      return itemId === id ? newItem : item
    })
    
    // Update state (pure state update, no side effects)
    setData(updated)
    // Update ref outside state updater to ensure synchronization
    originalDataRef.current = updated
  }, [])

  // Fetch when base endpoint changes (filters change)
  // Don't clear data immediately - keep previous data visible while fetching new data
  // Initialize to empty string so first mount triggers fetch
  const prevEndpointRef = useRef<string>("")
  
  useEffect(() => {
    // Only reset if this is the initial load or if endpoint actually changed
    const endpointChanged = prevEndpointRef.current !== baseEndpoint
    
    if (endpointChanged) {
      // Reset pagination state but keep data visible until new data loads
      setLoadedPages(0)
      setHasMore(true)
      // Reset SSE-added tracking when endpoint changes (filters changed)
      sseAddedCountRef.current = 0
      sseAddedItemIdsRef.current = new Set()
      // Don't clear data immediately - let fetchPage replace it
      fetchPage(0, data.length === 0) // Only show loading if no existing data
      prevEndpointRef.current = baseEndpoint
    }
  }, [baseEndpoint, fetchPage, data.length]) // Reset when endpoint changes (includes filters)

  // Smart polling
  useEffect(() => {
    if (!enablePolling || loading) return
    // If pollInterval is false, disable polling
    if (actualPollInterval === false) return

    let intervalId: NodeJS.Timeout | null = null

    const startPolling = () => {
      if (document.visibilityState === 'visible' && !checkDialogOpen()) {
        intervalId = setInterval(() => {
          fetchPage(0, false) // Refresh first page only
        }, actualPollInterval)
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
  }, [enablePolling, actualPollInterval, fetchPage, loading, checkDialogOpen])

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

