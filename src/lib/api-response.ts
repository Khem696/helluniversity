/**
 * API Response Standardization
 * 
 * Provides consistent response formats across all API endpoints
 * Includes error codes, pagination, and metadata
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta?: {
    requestId: string
    timestamp: string
    [key: string]: any
  }
}

/**
 * Standard error codes
 */
export const ErrorCodes = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Authentication/Authorization errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  EMAIL_ERROR: 'EMAIL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Business logic errors
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  BOOKING_OVERLAP: 'BOOKING_OVERLAP',
  INVALID_DATE: 'INVALID_DATE',
} as const

/**
 * Create a successful API response
 */
export function successResponse<T>(
  data: T,
  meta?: Record<string, any>
): NextResponse<ApiResponse<T>> {
  // Use requestId from meta if provided, otherwise generate new one
  const requestId = meta?.requestId || randomUUID()
  
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status: 200 }
  )
}

/**
 * Create an error API response
 */
export function errorResponse(
  code: string,
  message: string,
  details?: any,
  statusCode: number = 400,
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  // Use requestId from meta if provided, otherwise generate new one
  const requestId = meta?.requestId || randomUUID()
  
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status: statusCode }
  )
}

/**
 * Create a paginated API response
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  meta?: Record<string, any>
): NextResponse<ApiResponse<T[]>> {
  // Use requestId from meta if provided, otherwise generate new one
  const requestId = meta?.requestId || randomUUID()
  const totalPages = Math.ceil(total / limit)
  
  return NextResponse.json(
    {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status: 200 }
  )
}

/**
 * Create validation error response
 */
export function validationErrorResponse(
  errors: string[],
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.VALIDATION_ERROR,
    'Validation failed',
    { errors },
    400,
    meta
  )
}

/**
 * Create not found error response
 */
export function notFoundResponse(
  resource: string = 'Resource',
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.NOT_FOUND,
    `${resource} not found`,
    undefined,
    404,
    meta
  )
}

/**
 * Create unauthorized error response
 */
export function unauthorizedResponse(
  message: string = 'Authentication required',
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.UNAUTHORIZED,
    message,
    undefined,
    401,
    meta
  )
}

/**
 * Create forbidden error response
 */
export function forbiddenResponse(
  message: string = 'Access denied',
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.FORBIDDEN,
    message,
    undefined,
    403,
    meta
  )
}

/**
 * Create conflict error response
 */
export function conflictResponse(
  message: string,
  details?: any,
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.CONFLICT,
    message,
    details,
    409,
    meta
  )
}

/**
 * Create rate limit error response
 */
export function rateLimitResponse(
  limit: number,
  reset: number,
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        message: 'Rate limit exceeded',
        details: {
          limit,
          reset: new Date(reset * 1000).toISOString(),
        },
      },
      meta: {
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Retry-After': (reset - Math.floor(Date.now() / 1000)).toString(),
      },
    }
  )
}

/**
 * Create internal server error response
 */
export function internalErrorResponse(
  message: string = 'Internal server error',
  error?: Error,
  meta?: Record<string, any>
): NextResponse<ApiResponse> {
  return errorResponse(
    ErrorCodes.INTERNAL_ERROR,
    message,
    process.env.NODE_ENV === 'development' && error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined,
    500,
    meta
  )
}

/**
 * Wrap an async handler with standardized error handling
 */
export async function withErrorHandling<T>(
  handler: () => Promise<NextResponse<ApiResponse<T>>>,
  context?: { endpoint?: string; requestId?: string }
): Promise<NextResponse<ApiResponse<T>>> {
  try {
    return await handler()
  } catch (error) {
    const { logError } = await import('./logger')
    await logError(
      'API handler error',
      context,
      error instanceof Error ? error : new Error(String(error))
    )

    if (error instanceof Error) {
      // Check for known error types
      if (error.message.includes('not found')) {
        return notFoundResponse('Resource', context)
      }
      if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
        return unauthorizedResponse(error.message, context)
      }
      if (error.message.includes('forbidden') || error.message.includes('Forbidden')) {
        return forbiddenResponse(error.message, context)
      }
      if (error.message.includes('rate limit')) {
        return errorResponse(
          ErrorCodes.RATE_LIMIT_EXCEEDED,
          error.message,
          undefined,
          429,
          context
        )
      }
      // Check for validation errors - expand pattern matching
      if (error.message.includes('validation') || 
          error.message.includes('Invalid') ||
          error.message.includes('cannot be') ||
          error.message.includes('must be') ||
          error.message.includes('should be') ||
          error.message.includes('required') ||
          error.message.includes('Proposed date') ||
          error.message.includes('proposed date')) {
        return validationErrorResponse([error.message], context)
      }
    }

    return internalErrorResponse(
      'An unexpected error occurred',
      error instanceof Error ? error : undefined,
      context
    )
  }
}

