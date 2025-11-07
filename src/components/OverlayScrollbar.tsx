"use client"
import { useEffect, useState, useRef, useCallback } from "react"

/**
 * Custom overlay scrollbar that:
 * - Does NOT occupy space (no layout shift)
 * - Appears on topmost z-axis layer (z-[9999])
 * - Only visible when scrolling
 * - Invisible when scroll stops
 * - Overlays content without affecting layout
 * - Optimized for smooth 60fps performance
 */
export function OverlayScrollbar() {
  const [isScrolling, setIsScrolling] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [scrollbarHeight, setScrollbarHeight] = useState(0)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const rafIdRef = useRef<number | undefined>(undefined)
  const isScrollingRef = useRef(false)
  const lastScrollTimeRef = useRef(0)

  // Optimized scrollbar update using requestAnimationFrame
  const updateScrollbar = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current)
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const html = document.documentElement
      const windowHeight = window.innerHeight
      const documentHeight = html.scrollHeight
      const documentClientHeight = html.clientHeight
      const scrollTop = html.scrollTop
      
      // Calculate if page is scrollable - use scrollHeight > clientHeight for accurate check
      // This is the standard way to detect if an element is scrollable
      const isScrollable = documentHeight > documentClientHeight
      
      if (!isScrollable) {
        setScrollbarHeight(0)
        setIsScrolling(false)
        isScrollingRef.current = false
        return
      }

      // Calculate scrollbar dimensions
      const scrollbarTrackHeight = windowHeight
      const scrollableHeight = documentHeight - windowHeight
      const thumbHeight = Math.max(
        (windowHeight / documentHeight) * scrollbarTrackHeight,
        30 // Minimum thumb height
      )
      
      setScrollbarHeight(thumbHeight)
      
      // Calculate scroll progress (0 to 1) - clamp to prevent overflow
      const progress = Math.max(0, Math.min(1, scrollTop / scrollableHeight))
      setScrollProgress(progress)
    })
  }, [])

  // Throttled scroll handler for better performance
  const handleScroll = useCallback(() => {
    const now = performance.now()
    const timeSinceLastScroll = now - lastScrollTimeRef.current
    
    // Throttle to ~60fps (16ms between updates)
    if (timeSinceLastScroll < 16) {
      return
    }
    
    lastScrollTimeRef.current = now
    
    updateScrollbar()
    
    if (!isScrollingRef.current) {
      isScrollingRef.current = true
      setIsScrolling(true)
    }
    
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    // Hide scrollbar after scrolling stops
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false
      setIsScrolling(false)
    }, 300)
  }, [updateScrollbar])

  useEffect(() => {
    // Initial update
    updateScrollbar()

    // Throttled resize handler
    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        updateScrollbar()
      }, 100) // Debounce resize
    }

    // Use ResizeObserver to detect content changes (throttled)
    let resizeObserverTimeout: NodeJS.Timeout
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeObserverTimeout)
      resizeObserverTimeout = setTimeout(() => {
        updateScrollbar()
      }, 50) // Small delay to batch multiple resize events
    })
    
    resizeObserver.observe(document.body)
    resizeObserver.observe(document.documentElement)

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }
      clearTimeout(resizeTimeout)
      clearTimeout(resizeObserverTimeout)
    }
  }, [handleScroll, updateScrollbar])

  // Calculate thumb position using transform for better performance
  const scrollbarTrackHeight = typeof window !== 'undefined' ? window.innerHeight : 0
  const thumbTop = scrollProgress * (scrollbarTrackHeight - scrollbarHeight)

  // Don't render if not scrollable
  if (scrollbarHeight === 0) {
    return null
  }

  return (
    <div
      ref={scrollbarRef}
      className="fixed right-0 top-0 bottom-0 w-[15px] pointer-events-none z-[9999]"
      style={{
        zIndex: 9999,
        opacity: isScrolling ? 1 : 0,
        transition: 'opacity 0.2s ease-out',
        willChange: 'opacity',
      }}
    >
      {/* Scrollbar Track */}
      <div
        className="absolute right-0 top-0 bottom-0 w-full"
        style={{
          background: 'rgba(0, 0, 0, 0.02)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          borderLeft: '1px solid rgba(0, 0, 0, 0.05)',
          willChange: 'transform',
        }}
      />
      
      {/* Scrollbar Thumb - using transform for GPU acceleration */}
      <div
        ref={thumbRef}
        className="absolute right-[3px] rounded-[10px] pointer-events-auto cursor-pointer"
        style={{
          transform: `translateY(${thumbTop}px)`,
          height: `${scrollbarHeight}px`,
          width: '9px',
          background: isScrolling ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.08)',
          boxShadow: isScrolling 
            ? '0 0 16px rgba(0, 0, 0, 0.2)' 
            : '0 0 8px rgba(0, 0, 0, 0.1)',
          transition: 'background 0.15s ease-out, box-shadow 0.15s ease-out',
          willChange: 'transform, background, box-shadow',
        }}
        onMouseEnter={() => {
          if (thumbRef.current) {
            thumbRef.current.style.background = 'rgba(0, 0, 0, 0.25)'
          }
        }}
        onMouseLeave={() => {
          if (thumbRef.current) {
            thumbRef.current.style.background = isScrolling 
              ? 'rgba(0, 0, 0, 0.2)' 
              : 'rgba(0, 0, 0, 0.08)'
          }
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          
          const startY = e.clientY
          const startScrollTop = document.documentElement.scrollTop
          const scrollbarTrackHeight = window.innerHeight
          const documentHeight = document.documentElement.scrollHeight
          const scrollableHeight = documentHeight - scrollbarTrackHeight
          let isDragging = true

          const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return
            
            // Use requestAnimationFrame for smooth dragging
            requestAnimationFrame(() => {
              const deltaY = e.clientY - startY
              const scrollRatio = deltaY / scrollbarTrackHeight
              const newScrollTop = startScrollTop + (scrollRatio * scrollableHeight)
              document.documentElement.scrollTop = Math.max(
                0,
                Math.min(newScrollTop, scrollableHeight)
              )
            })
          }

          const handleMouseUp = () => {
            isDragging = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('mouseleave', handleMouseUp)
          }

          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
          document.addEventListener('mouseleave', handleMouseUp)
        }}
      />
    </div>
  )
}
