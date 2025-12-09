/**
 * Admin Booking Holds API v1
 * 
 * Versioned endpoint for admin booking holds management
 * 
 * GET /api/v1/admin/booking-holds - List all booking holds
 * POST /api/v1/admin/booking-holds - Create a new booking hold
 */

import { NextResponse } from "next/server"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getAllBookingHolds, createBookingHold, bulkCreateBookingHolds, bulkDeleteBookingHolds, BookingHoldData } from "@/lib/booking-holds"
import { auth } from "@/lib/auth-config"
import { getBangkokDateString } from "@/lib/timezone"

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

/**
 * GET /api/v1/admin/booking-holds
 * Get all booking holds
 */
export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin get booking holds request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get booking holds rejected: authentication failed')
      return authError
    }

    const holds = await getAllBookingHolds()
    
    await logger.info('Booking holds retrieved', {
      count: holds.length
    })

    return successResponse(
      { holds },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * POST /api/v1/admin/booking-holds
 * Create a new booking hold or bulk create holds
 * 
 * Request body can be:
 * - Single hold: { startDate, endDate?, reason? }
 * - Bulk create: { bulk: true, holds: [{ startDate, endDate?, reason? }, ...] }
 * 
 * Note: Time fields (startTime, endTime) are no longer used and will be ignored.
 */
export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin create booking hold request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin create booking hold rejected: authentication failed')
      return authError
    }

    // Get admin user info
    const session = await auth()
    if (!session?.user?.email) {
      await logger.warn('Admin create booking hold rejected: no user session')
      return unauthorizedResponse("User session required", { requestId })
    }

    // Parse request body (can be single hold or bulk request)
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 50000) // 50KB limit for bulk operations
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }

    // Check if this is a bulk create request
    if (body.bulk === true && Array.isArray(body.holds)) {
      // Validate bulk create request
      const holds = body.holds as BookingHoldData[]
      
      if (holds.length === 0) {
        await logger.warn('Bulk create rejected: empty holds array')
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Holds array cannot be empty",
          undefined,
          400,
          { requestId }
        )
      }
      
      // Limit bulk operations to prevent abuse
      const MAX_BULK_HOLDS = 50
      if (holds.length > MAX_BULK_HOLDS) {
        await logger.warn('Bulk create rejected: too many holds', { count: holds.length })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          `Cannot create more than ${MAX_BULK_HOLDS} holds at once. Please reduce the number of holds.`,
          undefined,
          400,
          { requestId }
        )
      }
      
      // Validate each hold in the array
      const todayDateStr = getBangkokDateString()
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      
      for (let i = 0; i < holds.length; i++) {
        const hold = holds[i]
        if (!hold || typeof hold !== 'object') {
          await logger.warn('Bulk create rejected: invalid hold at index', { index: i })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            `Hold at index ${i} is invalid`,
            undefined,
            400,
            { requestId }
          )
        }
        
        if (!hold.startDate) {
          await logger.warn('Bulk create rejected: missing startDate', { index: i })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            `Hold at index ${i} is missing startDate`,
            undefined,
            400,
            { requestId }
          )
        }
        
        // Validate date format
        if (!dateRegex.test(hold.startDate)) {
          await logger.warn('Bulk create rejected: invalid startDate format', { index: i })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            `Hold at index ${i}: Start date must be in YYYY-MM-DD format`,
            undefined,
            400,
            { requestId }
          )
        }
        
        // Validate start date is not in the past (Bangkok timezone)
        if (hold.startDate < todayDateStr) {
          await logger.warn('Bulk create rejected: startDate is before today', { index: i, startDate: hold.startDate })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            `Hold at index ${i}: Start date cannot be in the past. Please select today or a future date.`,
            undefined,
            400,
            { requestId }
          )
        }
        
        // Validate end date if provided
        if (hold.endDate) {
          if (!dateRegex.test(hold.endDate)) {
            await logger.warn('Bulk create rejected: invalid endDate format', { index: i })
            return errorResponse(
              ErrorCodes.VALIDATION_ERROR,
              `Hold at index ${i}: End date must be in YYYY-MM-DD format`,
              undefined,
              400,
              { requestId }
            )
          }
          
          if (hold.endDate < hold.startDate) {
            await logger.warn('Bulk create rejected: endDate before startDate', { index: i })
            return errorResponse(
              ErrorCodes.VALIDATION_ERROR,
              `Hold at index ${i}: End date must be after or equal to start date`,
              undefined,
              400,
              { requestId }
            )
          }
          
          if (hold.endDate < todayDateStr) {
            await logger.warn('Bulk create rejected: endDate is before today', { index: i, endDate: hold.endDate })
            return errorResponse(
              ErrorCodes.VALIDATION_ERROR,
              `Hold at index ${i}: End date cannot be in the past. Please select today or a future date.`,
              undefined,
              400,
              { requestId }
            )
          }
        }
      }
      
      // Attempt bulk create
      // Normalize time fields to null (time is no longer used)
      const normalizedHolds: BookingHoldData[] = holds.map(hold => ({
        ...hold,
        startTime: null,
        endTime: null,
      }))
      
      try {
        const createdHolds = await bulkCreateBookingHolds(normalizedHolds, session.user.email)
        
        await logger.info('Bulk booking holds created', {
          requested: holds.length,
          created: createdHolds.length,
          failed: holds.length - createdHolds.length
        })
        
        return successResponse(
          {
            holds: createdHolds,
            total: holds.length,
            created: createdHolds.length,
            failed: holds.length - createdHolds.length
          },
          { requestId }
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        // Check if it's an overlap error from bulk create
        if (errorMessage.includes('overlap')) {
          await logger.warn('Bulk booking hold creation rejected: overlap detected', {
            error: errorMessage
          })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            errorMessage,
            undefined,
            409,
            { requestId }
          )
        }
        
        // Check if this is a date validation error (from createBangkokTimestamp or calculateHoldEndTimestamp)
        if (errorMessage.includes('Invalid date') || 
            errorMessage.includes('Invalid date string') ||
            errorMessage.includes('Failed to calculate end timestamp')) {
          await logger.warn('Bulk booking hold creation rejected: invalid date or date calculation error', {
            error: errorMessage
          })
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            errorMessage,
            undefined,
            400,
            { requestId }
          )
        }
        
        await logger.error('Bulk booking hold creation failed', new Error(errorMessage))
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to create booking holds",
          errorMessage,
          500,
          { requestId }
        )
      }
    }
    
    // Single hold create - validate body structure
    if (typeof body !== 'object' || body === null) {
      await logger.warn('Booking hold creation rejected: invalid body type')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Request body must be an object",
        undefined,
        400,
        { requestId }
      )
    }

    const { startDate, endDate, reason } = body as BookingHoldData
    // Time fields are no longer used - always set to null
    const startTime = null
    const endTime = null

    // Validate reason length if provided (max 1000 characters)
    if (reason && reason.length > 1000) {
      await logger.warn('Booking hold creation rejected: reason too long')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Reason must be 1000 characters or less",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate required fields
    if (!startDate) {
      await logger.warn('Booking hold creation rejected: missing startDate')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Start date is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate)) {
      await logger.warn('Booking hold creation rejected: invalid startDate format')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Start date must be in YYYY-MM-DD format",
        undefined,
        400,
        { requestId }
      )
    }

    if (endDate && !dateRegex.test(endDate)) {
      await logger.warn('Booking hold creation rejected: invalid endDate format')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "End date must be in YYYY-MM-DD format",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate endDate >= startDate if both are provided
    if (endDate && startDate && endDate < startDate) {
      await logger.warn('Booking hold creation rejected: endDate before startDate')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "End date must be after or equal to start date",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate that start date is not in the past
    // Allow today's date (blocking whole day)
    const todayDateStr = getBangkokDateString()
    if (startDate < todayDateStr) {
      await logger.warn('Booking hold creation rejected: startDate is before today', {
        startDate,
        todayDateStr
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Start date cannot be in the past. Please select today or a future date.",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate end date is not in the past if provided
    if (endDate && endDate < todayDateStr) {
      await logger.warn('Booking hold creation rejected: endDate is before today', {
        endDate,
        todayDateStr
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "End date cannot be in the past. Please select today or a future date.",
        undefined,
        400,
        { requestId }
      )
    }

    // Note: Overlap checking is now handled by database triggers to prevent race conditions
    // The database will enforce the constraint and return a user-friendly error message
    
    try {
      // Ensure time fields are null (time is no longer used)
      const holdData: BookingHoldData = {
        startDate,
        endDate: endDate || null,
        startTime: null,
        endTime: null,
        reason: reason || null,
      }
      const hold = await createBookingHold(holdData, session.user.email)

      await logger.info('Booking hold created', {
        holdId: hold.id,
        startDate: hold.startDate,
        endDate: hold.endDate,
      })

      return successResponse(
        { hold },
        { requestId }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // Check if this is a database constraint violation (overlap trigger)
      if (errorMessage.includes('overlaps with an existing booking hold')) {
        await logger.warn('Booking hold creation rejected: database constraint violation (overlap)', {
          startDate,
          endDate,
          error: errorMessage
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          errorMessage, // Use the user-friendly message from the database trigger
          undefined,
          409, // Conflict status code
          { requestId }
        )
      }
      
      // Check if this is a date validation error (from createBangkokTimestamp or calculateHoldEndTimestamp)
      if (errorMessage.includes('Invalid date') || 
          errorMessage.includes('Invalid date string') ||
          errorMessage.includes('Failed to calculate end timestamp')) {
        await logger.warn('Booking hold creation rejected: invalid date or date calculation error', {
          startDate,
          endDate,
          error: errorMessage
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          errorMessage, // Use the descriptive error message from date validation
          undefined,
          400,
          { requestId }
        )
      }
      
      await logger.error('Booking hold creation failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create booking hold",
        errorMessage,
        500,
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

/**
 * DELETE /api/v1/admin/booking-holds
 * Bulk delete booking holds
 * 
 * Request body: { holdIds: string[] }
 */
export const DELETE = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin bulk delete booking holds request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin bulk delete booking holds rejected: authentication failed')
      return authError
    }

    // Get admin user info
    const session = await auth()
    if (!session?.user?.email) {
      await logger.warn('Admin bulk delete booking holds rejected: no user session')
      return unauthorizedResponse("User session required", { requestId })
    }

    // Parse request body
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 50000) // 50KB limit for bulk operations
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }

    // Validate body structure
    if (!body || typeof body !== 'object' || !Array.isArray(body.holdIds)) {
      await logger.warn('Bulk delete rejected: invalid body structure')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Request body must contain an array of hold IDs: { holdIds: string[] }",
        undefined,
        400,
        { requestId }
      )
    }

    const { holdIds } = body

    // Validate holdIds array
    if (holdIds.length === 0) {
      await logger.warn('Bulk delete rejected: empty holdIds array')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "holdIds array cannot be empty",
        undefined,
        400,
        { requestId }
      )
    }

    // Limit bulk operations to prevent abuse
    const MAX_BULK_DELETE = 100
    if (holdIds.length > MAX_BULK_DELETE) {
      await logger.warn('Bulk delete rejected: too many hold IDs', { count: holdIds.length })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Cannot delete more than ${MAX_BULK_DELETE} holds at once. Please reduce the number of holds.`,
        undefined,
        400,
        { requestId }
      )
    }

    // CRITICAL: Rate limiting for bulk delete operations
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const rateLimitResult = await checkRateLimit(session.user.email, 'admin-booking-holds')
    
    if (!rateLimitResult.success) {
      await logger.warn('Bulk delete rejected: rate limit exceeded', {
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        reset: rateLimitResult.reset
      })
      const response = errorResponse(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        "Rate limit exceeded. Please try again later.",
        {
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset: rateLimitResult.reset,
        },
        429,
        { requestId }
      )
      // Add rate limit headers
      response.headers.set("X-RateLimit-Limit", rateLimitResult.limit.toString())
      response.headers.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString())
      response.headers.set("X-RateLimit-Reset", rateLimitResult.reset.toString())
      response.headers.set("Retry-After", (rateLimitResult.reset - Math.floor(Date.now() / 1000)).toString())
      return response
    }

    try {
      const deletedCount = await bulkDeleteBookingHolds(holdIds)
      
      await logger.info('Bulk booking holds deleted', {
        requested: holdIds.length,
        deleted: deletedCount,
        failed: holdIds.length - deletedCount
      })

      // CRITICAL: Log admin action for audit trail
      try {
        const { logAdminAction } = await import('@/lib/bookings')
        const { getAuthSession } = await import('@/lib/auth')
        const authSession = await getAuthSession()
        const adminName = authSession?.user?.name || undefined
        
        await logAdminAction({
          actionType: "bulk_delete_booking_holds",
          resourceType: "booking_hold",
          resourceId: "bulk",
          adminEmail: session.user.email,
          adminName,
          description: `Bulk deleted ${deletedCount} booking hold(s) (${holdIds.length} requested)`,
          metadata: {
            requested: holdIds.length,
            deleted: deletedCount,
            failed: holdIds.length - deletedCount,
            holdIds: holdIds, // Include IDs for audit trail
          },
        })
        await logger.debug('Admin action logged for bulk delete', {
          deletedCount,
          adminEmail: session.user.email
        })
      } catch (logError) {
        // Don't fail the request if logging fails
        await logger.error("Failed to log admin action for bulk delete", 
          logError instanceof Error ? logError : new Error(String(logError)), 
          { holdIds: holdIds.length }
        )
      }

      return successResponse(
        {
          deletedCount,
          total: holdIds.length,
          failed: holdIds.length - deletedCount
        },
        { requestId }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.error('Bulk booking holds deletion failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to delete booking holds",
        errorMessage,
        500,
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

