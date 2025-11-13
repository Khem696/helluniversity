/**
 * Custom hook for admin data management with optimistic updates and smart polling
 * 
 * Features:
 * - Optimistic updates (instant UI feedback)
 * - Selective updates (no full page refresh)
 * - Smart polling (only when page is visible)
 * - Automatic error handling and rollback
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

interface UseAdminDataOptions<T> {
  endpoint: string
  pollInterval?: number
  enablePolling?: boolean
  onPoll?: (data: T[]) => void
  transformResponse?: (response: any) => T[]
  compareItems?: (a: T, b: T) => boolean
  isDialogOpen?: () => boolean | boolean
}

interface UseAdminDataReturn<T> {
  data: T[]
  loading: boolean
  error: Error | null
  fetchData: () => Promise<void>
  updateItem: (id: string, updates: Partial<T>) => void
  addItem: (item: T) => void
  removeItem: (id: string) => void
  replaceItem: (id: string, newItem: T) => void
  setData: React.Dispatch<React.SetStateAction<T[]>>
}

/**
 * Get item ID from data item (supports multiple ID field names)
 */
function getItemId<T>(item: T): string | null {
  if (typeof item !== 'object' || item === null) return null
  const obj = item as any
  return obj.id || obj.booking_id || obj.event_id || obj.image_id || null
}

/**
 * Custom hook for managing admin data with optimistic updates
 */
export function useAdminData<T extends { id?: string; [key: string]: any }>(
  options: UseAdminDataOptions<T>
): UseAdminDataReturn<T> {
  const {
    endpoint,
    pollInterval = 30000,
    enablePolling = false,
    onPoll,
    transformResponse,
    compareItems,
    isDialogOpen
  } = options

  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  
  // Track original data for rollback on error
  const originalDataRef = useRef<T[]>([])
  
  // Track last fetch time for change detection
  const lastFetchTimeRef = useRef<number>(0)
  
  // Helper to check if dialog is open
  const checkDialogOpen = useCallback(() => {
    if (typeof isDialogOpen === 'function') {
      return isDialogOpen()
    }
    return isDialogOpen === true
  }, [isDialogOpen])

  /**
   * Transform API response to data array
   */
  const transformData = useCallback((json: any): T[] => {
    if (transformResponse) {
      return transformResponse(json)
    }
    
    // Default transformation: try common response structures
    if (Array.isArray(json.data)) {
      return json.data
    }
    if (Array.isArray(json.data?.items)) {
      return json.data.items
    }
    if (Array.isArray(json.data?.bookings)) {
      return json.data.bookings
    }
    if (Array.isArray(json.data?.events)) {
      return json.data.events
    }
    if (Array.isArray(json.data?.images)) {
      return json.data.images
    }
    if (Array.isArray(json.data?.emails)) {
      return json.data.emails
    }
    if (Array.isArray(json.items)) {
      return json.items
    }
    if (Array.isArray(json.bookings)) {
      return json.bookings
    }
    if (Array.isArray(json.events)) {
      return json.events
    }
    if (Array.isArray(json.images)) {
      return json.images
    }
    
    return []
  }, [transformResponse])

  /**
   * Fetch data from API
   */
  const fetchData = useCallback(async (showLoading: boolean = true) => {
    // Don't fetch if dialog is open (prevents form reset)
    if (checkDialogOpen() && showLoading) {
      return
    }
    
    try {
      if (showLoading && !checkDialogOpen()) {
        setLoading(true)
      }
      setError(null)
      
      const response = await fetch(endpoint)
      const json = await response.json()
      
      if (json.success) {
        const newData = transformData(json)
        setData(newData)
        originalDataRef.current = newData
        lastFetchTimeRef.current = Date.now()
        
        // Call onPoll callback if provided
        if (onPoll && !isInitialLoad) {
          onPoll(newData)
        }
        
        setIsInitialLoad(false)
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to load data"
        setError(new Error(errorMessage))
        if (isInitialLoad) {
          toast.error(errorMessage)
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      if (isInitialLoad) {
        toast.error("Failed to load data")
      }
      console.error("Error fetching data:", error)
    } finally {
      if (showLoading && !checkDialogOpen()) {
        setLoading(false)
      }
    }
  }, [endpoint, transformData, onPoll, isInitialLoad, checkDialogOpen])

  /**
   * Optimistically update a single item
   */
  const updateItem = useCallback((id: string, updates: Partial<T>) => {
    setData(prev => {
      const updated = prev.map(item => {
        const itemId = getItemId(item)
        return itemId === id ? { ...item, ...updates } : item
      })
      originalDataRef.current = prev // Save for rollback
      return updated
    })
  }, [])

  /**
   * Optimistically add a new item
   */
  const addItem = useCallback((item: T) => {
    setData(prev => {
      const updated = [item, ...prev]
      originalDataRef.current = prev // Save for rollback
      return updated
    })
  }, [])

  /**
   * Optimistically remove an item
   */
  const removeItem = useCallback((id: string) => {
    setData(prev => {
      const updated = prev.filter(item => {
        const itemId = getItemId(item)
        return itemId !== id
      })
      originalDataRef.current = prev // Save for rollback
      return updated
    })
  }, [])

  /**
   * Replace an item completely
   */
  const replaceItem = useCallback((id: string, newItem: T) => {
    setData(prev => {
      const updated = prev.map(item => {
        const itemId = getItemId(item)
        return itemId === id ? newItem : item
      })
      originalDataRef.current = prev // Save for rollback
      return updated
    })
  }, [])

  /**
   * Rollback to original data (on error)
   */
  const rollback = useCallback(() => {
    setData(originalDataRef.current)
  }, [])

  /**
   * Initial data fetch
   */
  useEffect(() => {
    fetchData()
  }, [endpoint]) // Only refetch if endpoint changes

  /**
   * Smart polling with visibility detection
   */
  useEffect(() => {
    if (!enablePolling || isInitialLoad) return

    let intervalId: NodeJS.Timeout | null = null
    const intervalMs = pollInterval

    const startPolling = () => {
      // Only poll if page is visible and no dialogs are open
      if (document.visibilityState === 'visible' && !checkDialogOpen()) {
        intervalId = setInterval(() => {
          // Fetch data without showing loading state
          fetchData(false)
        }, intervalMs)
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

    // Start polling
    startPolling()

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enablePolling, pollInterval, fetchData, isInitialLoad, checkDialogOpen])

  return {
    data,
    loading,
    error,
    fetchData,
    updateItem,
    addItem,
    removeItem,
    replaceItem,
    setData,
  }
}

/**
 * Hook to track dialog open state for preventing unnecessary fetches
 */
export function useDialogState(isOpen: boolean) {
  const isDialogOpenRef = useRef(isOpen)
  
  useEffect(() => {
    isDialogOpenRef.current = isOpen
  }, [isOpen])
  
  return isDialogOpenRef
}

