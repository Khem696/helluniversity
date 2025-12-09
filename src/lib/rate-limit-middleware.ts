/**
 * Rate Limiting Middleware
 * 
 * Provides easy-to-use rate limiting for API endpoints
 * Wraps the existing rate-limit utility with middleware pattern
 */

import { NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitIdentifier } from './rate-limit'
import { rateLimitResponse, ErrorCodes } from './api-response'

export interface RateLimitOptions {
  limit?: number
  windowSeconds?: number
  endpoint?: string
}

/**
 * Check rate limit for a request
 * 
 * @param request - HTTP request object
 * @param options - Rate limit options
 * @returns Rate limit check result
 */
export async function withRateLimit(
  request: Request,
  options?: RateLimitOptions
): Promise<{
  allowed: boolean
  response?: NextResponse
}> {
  try {
    const endpoint = options?.endpoint || 'default'
    const identifier = getRateLimitIdentifier(request)
    const result = await checkRateLimit(identifier, endpoint)

    if (!result.success) {
      return {
        allowed: false,
        response: rateLimitResponse(result.limit, result.reset, {
          endpoint,
          identifier: identifier.substring(0, 10) + '...', // Partial identifier for logging
        }),
      }
    }

    return { allowed: true }
  } catch (error) {
    // If rate limiting fails, allow the request (fail open)
    // Log the error but don't block the request
    console.error('Rate limit check failed:', error)
    return { allowed: true }
  }
}

/**
 * Create rate limit middleware for an endpoint
 * 
 * @param options - Rate limit options
 * @returns Middleware function
 */
export function createRateLimitMiddleware(options?: RateLimitOptions) {
  return async (request: Request): Promise<NextResponse | null> => {
    const rateLimit = await withRateLimit(request, options)
    
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response
    }
    
    return null // Continue with request
  }
}

/**
 * Default rate limits for different endpoint types
 */
export const DefaultRateLimits = {
  // Public endpoints
  booking: { limit: 5, windowSeconds: 600 }, // 5 requests per 10 minutes
  'ai-space': { limit: 5, windowSeconds: 600 }, // 5 requests per 10 minutes
  'booking-response': { limit: 10, windowSeconds: 600 }, // 10 requests per 10 minutes
  'booking-deposit': { limit: 5, windowSeconds: 600 }, // 5 requests per 10 minutes
  
  // Admin endpoints (stricter)
  'admin-bookings': { limit: 100, windowSeconds: 60 }, // 100 requests per minute
  'admin-images': { limit: 20, windowSeconds: 60 }, // 20 requests per minute
  'admin-events': { limit: 50, windowSeconds: 60 }, // 50 requests per minute
  'admin-email-queue': { limit: 30, windowSeconds: 60 }, // 30 requests per minute
  'admin-booking-holds': { limit: 30, windowSeconds: 60 }, // 30 requests per minute
  
  // Default
  default: { limit: 10, windowSeconds: 60 }, // 10 requests per minute
} as const

/**
 * Get rate limit options for an endpoint
 */
export function getRateLimitOptions(endpoint: string): RateLimitOptions {
  const limits = DefaultRateLimits[endpoint as keyof typeof DefaultRateLimits]
  
  if (limits) {
    return {
      ...limits,
      endpoint,
    }
  }
  
  return {
    ...DefaultRateLimits.default,
    endpoint,
  }
}

