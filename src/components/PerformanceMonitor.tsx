'use client'

import { useEffect } from 'react'
import { trackTimeOnPage, trackScrollDepth } from '@/lib/analytics'

export function PerformanceMonitor() {
  useEffect(() => {
    const startTime = Date.now()
    let maxScrollDepth = 0

    const handleScroll = () => {
      const scrollTop = window.pageYOffset
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const scrollPercent = Math.round((scrollTop / docHeight) * 100)
      
      if (scrollPercent > maxScrollDepth) {
        maxScrollDepth = scrollPercent
      }
    }

    const handleBeforeUnload = () => {
      const timeOnPage = Math.round((Date.now() - startTime) / 1000)
      trackTimeOnPage(timeOnPage)
      trackScrollDepth(maxScrollDepth)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return null
}
