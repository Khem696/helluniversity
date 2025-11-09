import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth-config"

/**
 * Authentication Utilities
 * 
 * Helper functions for checking authentication and authorization
 * in API routes and server components.
 * 
 * Updated for NextAuth.js v5 (2025)
 */

export interface AuthUser {
  id: string
  email: string
  name: string | null
  image: string | null
  domain: string
}

/**
 * Get the current authenticated session
 * Uses NextAuth.js v5 auth() function
 */
export async function getAuthSession() {
  const session = await auth()
  return session
}

/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getAuthSession()
  
  if (!session?.user) {
    return null
  }

  return {
    id: session.user.id || "",
    email: session.user.email || "",
    name: session.user.name || null,
    image: session.user.image || null,
    domain: (session.user as any).domain || "",
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getAuthUser()
  return user !== null
}

/**
 * Check if user is from allowed Google Workspace domain
 */
export async function isAuthorizedDomain(): Promise<boolean> {
  const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN
  
  if (!allowedDomain) {
    // If no domain restriction, allow all authenticated users
    return await isAuthenticated()
  }

  const user = await getAuthUser()
  if (!user) {
    return false
  }

  return user.domain === allowedDomain
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser()
  
  if (!user) {
    throw new Error("Unauthorized: Authentication required")
  }

  return user
}

/**
 * Require authorized domain - throws error if not from allowed domain
 */
export async function requireAuthorizedDomain(): Promise<AuthUser> {
  const user = await requireAuth()
  const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN

  if (allowedDomain && user.domain !== allowedDomain) {
    throw new Error(`Unauthorized: Must be from ${allowedDomain} domain`)
  }

  return user
}

/**
 * Create unauthorized response for API routes
 */
export function unauthorizedResponse(message: string = "Unauthorized") {
  return NextResponse.json(
    { success: false, error: message },
    { status: 401 }
  )
}

/**
 * Create forbidden response for API routes
 */
export function forbiddenResponse(message: string = "Forbidden") {
  return NextResponse.json(
    { success: false, error: message },
    { status: 403 }
  )
}

/**
 * Middleware helper to check authentication in API routes
 */
export async function checkAuth(request: NextRequest): Promise<{
  user: AuthUser | null
  isAuthenticated: boolean
  isAuthorized: boolean
}> {
  const user = await getAuthUser()
  const isAuthenticated = user !== null
  const isAuthorized = await isAuthorizedDomain()

  return {
    user,
    isAuthenticated,
    isAuthorized,
  }
}

