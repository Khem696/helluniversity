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

export function ConditionalHeader() {
  const pathname = usePathname()
  
  useEffect(() => {
    // Set data attribute on html for CSS targeting (backup)
    const html = document.documentElement
    // Hide main header on all admin pages and booking management pages
    if (pathname?.startsWith("/admin") || pathname?.startsWith("/booking/response") || pathname?.startsWith("/booking/deposit")) {
      html.setAttribute("data-no-header", "true")
    } else {
      html.removeAttribute("data-no-header")
    }
  }, [pathname])
  
  // Hide main website header on all admin pages and booking management pages
  // Admin pages have their own layout with separate header
  // Booking response and deposit pages should be standalone without header
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/booking/response") || pathname?.startsWith("/booking/deposit")) {
    return null
  }
  
  return <Header />
}

