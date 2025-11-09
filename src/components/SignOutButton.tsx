"use client"

import { signOut } from "next-auth/react"
import { useState } from "react"

/**
 * Sign Out Button Component
 * 
 * Signs out and ensures session is cleared before redirect
 */

export function SignOutButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    try {
      setIsLoading(true)
      
      // Sign out - this clears the session cookie
      await signOut({ 
        callbackUrl: "/admin/login?signout=true",
        redirect: true,
      })
    } catch (error) {
      console.error("Sign out error:", error)
      // On error, force redirect with cache bust
      window.location.href = "/admin/login?signout=true&t=" + Date.now()
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={isLoading}
      type="button"
      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isLoading ? "Signing out..." : "Sign Out"}
    </button>
  )
}

