import { NextResponse, NextRequest } from "next/server"
import { auth } from "@/lib/auth-config"

/**
 * Next.js 16 Proxy for Route Protection
 * 
 * Simple, straightforward authentication check
 */

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  
  // Allow login page and auth routes (with or without trailing slash)
  if (
    pathname === "/admin/login" || 
    pathname === "/admin/login/" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next()
  }
  
  // Check authentication for admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    try {
      // In NextAuth v5, auth() in proxy/middleware automatically reads from request
      // Try calling it - if it fails, the route will handle it
      const session = await auth()
      
      // If no session, redirect to login
      if (!session?.user) {
        return NextResponse.redirect(new URL("/admin/login", request.url))
      }
      
      // Check domain restriction if set
      const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN
      if (allowedDomain && session.user.email) {
        const emailDomain = session.user.email.split("@")[1]
        if (emailDomain !== allowedDomain) {
          return NextResponse.redirect(new URL("/admin/login?error=unauthorized", request.url))
        }
      }
      
      // Session is valid, allow access
      return NextResponse.next()
    } catch (error) {
      // CRITICAL: Log auth failures with structured logger for security monitoring
      // If auth check fails, let the route handle authentication (fail-open for resilience)
      // Routes will perform their own auth checks, so this is a defense-in-depth approach
      try {
        const { logWarn } = await import('@/lib/logger')
        await logWarn('Proxy: auth() failed, allowing route to handle authentication', {
          pathname,
          error: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : 'Unknown',
        })
      } catch (logError) {
        // Fallback to console if logger fails (shouldn't happen, but fail-safe)
        if (process.env.NODE_ENV === 'development') {
          console.warn("Proxy: auth() failed, allowing route to handle:", error)
        }
      }
      
      // Allow route to handle authentication (routes have their own auth checks)
      // This fail-open approach ensures availability even if proxy auth has issues
      return NextResponse.next()
    }
  }
  
  // Not an admin route, allow through
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/admin/:path*",
  ],
}
