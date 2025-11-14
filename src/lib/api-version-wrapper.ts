/**
 * API Version Wrapper
 * 
 * Wrapper utilities to add versioning support to existing routes
 * Automatically detects version and adds version headers to responses
 */

import { NextRequest, NextResponse } from 'next/server'
import { getApiVersion, normalizeVersion, addVersionHeaders } from './api-versioning'

/**
 * Wrap an API route handler to automatically add version headers
 * 
 * Usage:
 * ```typescript
 * export const GET = withVersioning(async (request: NextRequest) => {
 *   // Your route logic
 *   return successResponse(data, { requestId })
 * })
 * ```
 */
export function withVersioning<T = any>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse<T>> => {
    // Detect API version from request
    const version = normalizeVersion(getApiVersion(request))
    
    // Call the original handler
    const response = await handler(request)
    
    // Add version headers to response
    // Type assertion needed because addVersionHeaders preserves the response type
    return addVersionHeaders(response, version) as NextResponse<T>
  }
}

/**
 * Extract API version from request and add to meta
 * Useful for passing version info to response helpers
 * 
 * Usage:
 * ```typescript
 * const version = getVersionFromRequest(request)
 * return successResponse(data, { requestId, apiVersion: version })
 * ```
 */
export function getVersionFromRequest(request: NextRequest | Request): string {
  return normalizeVersion(getApiVersion(request))
}

