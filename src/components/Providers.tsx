"use client"

import { SessionProvider } from "next-auth/react"
import { ReactNode } from "react"

/**
 * Providers Component
 * 
 * Wraps the app with NextAuth SessionProvider
 * Required for client-side session access
 */

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      basePath="/api/auth"
      refetchInterval={5 * 60} // Refetch session every 5 minutes
      refetchOnWindowFocus={true}
    >
      {children}
    </SessionProvider>
  )
}

