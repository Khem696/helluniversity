"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { Header } from "./Header"

/**
 * Conditional Header Component
 * 
 * Shows Header on all pages except admin pages
 * Admin pages have their own separate layout and header
 */

interface ConditionalHeaderProps {
  initialBookingEnabled?: boolean
}

export function ConditionalHeader({ initialBookingEnabled }: ConditionalHeaderProps) {
  const pathname = usePathname()
  
  useEffect(() => {
    // Set data attribute on html for CSS targeting (backup)
    const html = document.documentElement
    // Hide main header on all admin pages, booking management pages, and event pages
    if (pathname?.startsWith("/admin") || pathname?.startsWith("/booking/response") || pathname?.startsWith("/booking/deposit") || pathname?.startsWith("/events/")) {
      html.setAttribute("data-no-header", "true")
    } else {
      html.removeAttribute("data-no-header")
    }
  }, [pathname])
  
  // Hide main website header on all admin pages, booking management pages, and event pages
  // Admin pages have their own layout with separate header
  // Booking response and deposit pages should be standalone without header
  // Event pages have their own back button and don't need header
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/booking/response") || pathname?.startsWith("/booking/deposit") || pathname?.startsWith("/events/")) {
    return null
  }
  
  return <Header initialBookingEnabled={initialBookingEnabled} />
}

