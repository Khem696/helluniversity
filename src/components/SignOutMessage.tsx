"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * Sign Out Message Component
 * 
 * Shows signout success message
 * Only cleans up URL on manual page refresh (F5), not on initial load
 */

export function SignOutMessage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hasSignout = searchParams?.get("signout") === "true"

  useEffect(() => {
    // Only clean URL if this is a manual page refresh
    if (hasSignout && typeof window !== "undefined") {
      // Check if page was reloaded (manual refresh)
      const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
      const isReload = navigationEntry?.type === "reload"
      
      // Alternative check for older browsers
      const isReloadLegacy = 
        (performance.navigation && (performance.navigation as any).type === 1) ||
        (window.performance && (window.performance as any).navigation?.type === 1)

      if (isReload || isReloadLegacy) {
        // Clean up URL only on manual refresh
        const cleanUrl = "/admin/login"
        router.replace(cleanUrl)
      }
    }
  }, [hasSignout, router])

  if (!hasSignout) {
    return null
  }

  return (
    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
      <p className="text-sm text-green-800">
        ✓ You have been successfully signed out.
      </p>
    </div>
  )
}

