"use client"

import { SessionProvider } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactNode, useState } from "react"

/**
 * Providers Component
 * 
 * Wraps the app with NextAuth SessionProvider and React Query
 * Required for client-side session access and data fetching
 */

export function Providers({ children }: { children: ReactNode }) {
  // Create QueryClient with default options
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time: consider data fresh for 10 seconds
            staleTime: 10 * 1000,
            // Cache time: keep unused data for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed requests
            retry: 2,
            // Refetch on window focus
            refetchOnWindowFocus: true,
            // Refetch on reconnect
            refetchOnReconnect: true,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider
        basePath="/api/auth"
        refetchInterval={5 * 60} // Refetch session every 5 minutes
        refetchOnWindowFocus={true}
      >
        {children}
      </SessionProvider>
    </QueryClientProvider>
  )
}

