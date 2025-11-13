/**
 * Admin Authentication Helper
 * 
 * Centralized authentication and authorization for admin API routes.
 * Eliminates code duplication and ensures consistent error handling.
 */

import { requireAuthorizedDomain, AuthUser } from '@/lib/auth'
import { unauthorizedResponse, forbiddenResponse, ApiResponse } from '@/lib/api-response'
import { NextResponse } from 'next/server'
import { createRequestLogger } from '@/lib/logger'

/**
 * Result of admin authentication check
 */
type AdminAuthSuccess = {
  success: true
  user: AuthUser
}

type AdminAuthFailure = {
  success: false
  response: NextResponse<ApiResponse>
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure

/**
 * Check admin authentication and authorization
 * 
 * This function:
 * 1. Verifies the user is authenticated
 * 2. Verifies the user is from the authorized Google Workspace domain
 * 3. Returns a standardized error response if authentication fails
 * 
 * @param requestId - Request ID for logging
 * @param logger - Optional logger instance (will create one if not provided)
 * @param endpoint - Optional endpoint name for logging
 * @returns AuthResult with user or error response
 */
export async function checkAdminAuth(
  requestId: string,
  logger?: Awaited<ReturnType<typeof createRequestLogger>>,
  endpoint?: string
): Promise<AdminAuthResult> {
  const log = logger || createRequestLogger(requestId, endpoint || '/api/admin')
  
  try {
    const user = await requireAuthorizedDomain()
    
    await log.info('Admin authentication successful', {
      userId: user.id,
      email: user.email,
      domain: user.domain
    })
    
    return {
      success: true,
      user
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isUnauthorized = errorMessage.includes("Unauthorized") || errorMessage.includes("Authentication required")
    
    await log.warn('Admin authentication failed', {
      error: errorMessage,
      isUnauthorized
    })
    
    if (isUnauthorized) {
      return {
        success: false,
        response: unauthorizedResponse("Authentication required", { requestId })
      }
    }
    
    return {
      success: false,
      response: forbiddenResponse(
        "Access denied: Must be from authorized Google Workspace domain",
        { requestId }
      )
    }
  }
}

/**
 * Higher-order function to wrap admin API route handlers with authentication
 * 
 * Usage:
 * ```typescript
 * export async function POST(request: Request) {
 *   return withAdminAuth(async (user, requestId, logger) => {
 *     // Your handler code here
 *     // user is guaranteed to be authenticated and authorized
 *     return successResponse({ ... }, { requestId })
 *   }, { endpoint: '/api/admin/example' })
 * }
 * ```
 */
export function withAdminAuth<T>(
  handler: (
    user: AuthUser,
    requestId: string,
    logger: Awaited<ReturnType<typeof createRequestLogger>>
  ) => Promise<NextResponse<ApiResponse<T>>>,
  options?: {
    endpoint?: string
    requestId?: string
  }
) {
  return async (request: Request): Promise<NextResponse<ApiResponse<T>>> => {
    const { withErrorHandling } = await import('@/lib/api-response')
    
    return withErrorHandling(async (): Promise<NextResponse<ApiResponse<T>>> => {
      const requestId = options?.requestId || crypto.randomUUID()
      const logger = createRequestLogger(requestId, options?.endpoint || '/api/admin')
      
      await logger.info('Admin API request received')
      
      // Check authentication
      const authResult = await checkAdminAuth(requestId, logger, options?.endpoint)
      
      if (!authResult.success) {
        return authResult.response
      }
      
      // Call the handler with authenticated user
      return await handler(authResult.user, requestId, logger)
    }, { endpoint: options?.endpoint, requestId: options?.requestId })
  }
}

