"use client"

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseInfiniteScrollOptions {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void | Promise<void>
  threshold?: number // Distance from bottom in pixels to trigger load
  rootMargin?: string // Root margin for Intersection Observer
  enabled?: boolean // Enable/disable infinite scroll
}

/**
 * Hook for infinite scroll/lazy loading
 * Uses Intersection Observer API for efficient scroll detection
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  threshold = 200, // Trigger 200px before reaching bottom
  rootMargin = '0px',
  enabled = true,
}: UseInfiniteScrollOptions) {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)

  // Load more function with debouncing
  const loadMore = useCallback(async () => {
    if (loadingRef.current || loading || !hasMore || !enabled) {
      return
    }

    loadingRef.current = true
    try {
      await onLoadMore()
    } catch (error) {
      console.error('Error loading more items:', error)
    } finally {
      // Small delay to prevent rapid successive calls
      setTimeout(() => {
        loadingRef.current = false
      }, 300)
    }
  }, [hasMore, loading, onLoadMore, enabled])

  // Setup Intersection Observer
  useEffect(() => {
    if (!enabled || !elementRef.current) {
      return
    }

    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsIntersecting(entry.isIntersecting)

        if (entry.isIntersecting && hasMore && !loading && !loadingRef.current) {
          loadMore()
        }
      },
      {
        root: null, // Use viewport as root
        rootMargin,
        threshold: 0.1, // Trigger when 10% of element is visible
      }
    )

    // Observe the sentinel element
    if (elementRef.current) {
      observerRef.current.observe(elementRef.current)
    }

    // Cleanup on unmount
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, loading, loadMore, rootMargin, enabled])

  return {
    elementRef, // Ref to attach to sentinel element
    isIntersecting,
  }
}

