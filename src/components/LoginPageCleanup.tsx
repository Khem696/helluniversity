"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

/**
 * Login Page Cleanup Component
 * 
 * Removes the data-login-page attribute from the HTML element
 * when navigating away from the login page.
 * This ensures the admin header appears correctly after navigation.
 */

export function LoginPageCleanup() {
  const pathname = usePathname()
  
  useEffect(() => {
    // Remove data-login-page attribute when not on login page
    const html = document.documentElement
    
    if (pathname === "/admin/login") {
      // On login page, ensure attribute is set
      html.setAttribute("data-login-page", "true")
    } else {
      // On any other page, remove the attribute
      html.removeAttribute("data-login-page")
    }
  }, [pathname])
  
  // This component doesn't render anything
  return null
}

