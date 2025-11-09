/**
 * NextAuth.js v5 API Route Handler
 * 
 * Handles authentication API routes:
 * - GET /api/auth/signin
 * - POST /api/auth/signin
 * - GET /api/auth/signout
 * - GET /api/auth/callback/:provider
 * - GET /api/auth/session
 * - GET /api/auth/csrf
 * - GET /api/auth/providers
 */

import { handlers } from "@/lib/auth-config"

// Export handlers for API routes
export const { GET, POST } = handlers

