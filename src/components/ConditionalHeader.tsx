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
    // Hide main header on all admin pages
    if (pathname?.startsWith("/admin")) {
      html.setAttribute("data-admin-page", "true")
    } else {
      html.removeAttribute("data-admin-page")
    }
  }, [pathname])
  
  // Hide main website header on all admin pages
  // Admin pages have their own layout with separate header
  if (pathname?.startsWith("/admin")) {
    return null
  }
  
  return <Header />
}

