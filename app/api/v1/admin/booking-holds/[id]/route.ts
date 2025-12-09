/**
 * Admin Booking Hold API v1
 * 
 * Versioned endpoint for individual booking hold management
 * 
 * GET /api/v1/admin/booking-holds/[id] - Get a booking hold
 * PUT /api/v1/admin/booking-holds/[id] - Update a booking hold
 * DELETE /api/v1/admin/booking-holds/[id] - Delete a booking hold
 */

import { NextResponse } from "next/server"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getBookingHoldById, updateBookingHold, deleteBookingHold, BookingHoldData } from "@/lib/booking-holds"
import { auth } from "@/lib/auth-config"
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { getBangkokDateString } from "@/lib/timezone"

/**
 * Format timestamp to date string (YYYY-MM-DD) in Bangkok timezone
 */
function formatTimestampToDate(timestamp: number): string {
  try {
    const utcDate = new Date(timestamp * 1000)
    const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
    return format(bangkokDate, 'yyyy-MM-dd')
  } catch (error) {
    // Fallback to UTC if timezone conversion fails
    const date = new Date(timestamp * 1000)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

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
 * GET /api/v1/admin/booking-holds/[id]
 * Get a booking hold by ID
 */
export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin get booking hold request received', { holdId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get booking hold rejected: authentication failed')
      return authError
    }

    const hold = await getBookingHoldById(id)
    
    if (!hold) {
      await logger.warn('Booking hold not found', { holdId: id })
      return notFoundResponse("Booking hold not found", { requestId })
    }

    await logger.info('Booking hold retrieved', { holdId: id })

    return successResponse(
      { hold },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * PUT /api/v1/admin/booking-holds/[id]
 * Update a booking hold
 */
export const PUT = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin update booking hold request received', { holdId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update booking hold rejected: authentication failed')
      return authError
    }

    // Check if hold exists
    const existingHold = await getBookingHoldById(id)
    if (!existingHold) {
      await logger.warn('Booking hold not found for update', { holdId: id })
      return notFoundResponse("Booking hold not found", { requestId })
    }

    // Parse request body
    let body: Partial<BookingHoldData>
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10000) // 10KB limit
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

    // Validate date format if provided
    if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      await logger.warn('Booking hold update rejected: invalid startDate format')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Start date must be in YYYY-MM-DD format",
        undefined,
        400,
        { requestId }
      )
    }

    if (body.endDate !== undefined && body.endDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
      await logger.warn('Booking hold update rejected: invalid endDate format')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "End date must be in YYYY-MM-DD format",
        undefined,
        400,
        { requestId }
      )
    }

    // Time fields are no longer used - always set to null
    // Ignore any time fields in the request body

    // Validate reason length if provided (max 1000 characters)
    if (body.reason !== undefined && body.reason !== null && body.reason.length > 1000) {
      await logger.warn('Booking hold update rejected: reason too long')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Reason must be 1000 characters or less",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate endDate >= startDate if both are provided
    const finalStartDate = body.startDate || (existingHold ? formatTimestampToDate(existingHold.startDate) : null)
    const finalEndDate = body.endDate !== undefined ? body.endDate : (existingHold?.endDate ? formatTimestampToDate(existingHold.endDate) : null)
    
    if (finalEndDate && finalStartDate && finalEndDate < finalStartDate) {
      await logger.warn('Booking hold update rejected: endDate before startDate')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "End date must be after or equal to start date",
        undefined,
        400,
        { requestId }
      )
    }

    // Time fields are no longer used - always set to null
    const finalStartTime = null
    const finalEndTime = null

    // Validate that start date is not in the past if being updated
    // Allow today's date (blocking whole day)
    if (body.startDate) {
      const todayDateStr = getBangkokDateString()
      if (body.startDate < todayDateStr) {
        await logger.warn('Booking hold update rejected: startDate is before today', {
          startDate: body.startDate,
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
    }

    // Validate end date is not in the past if being updated
    if (body.endDate !== undefined && body.endDate !== null) {
      const todayDateStr = getBangkokDateString()
      if (body.endDate < todayDateStr) {
        await logger.warn('Booking hold update rejected: endDate is before today', {
          endDate: body.endDate,
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
    }

    // Note: Overlap checking is now handled by database triggers to prevent race conditions
    // The database will enforce the constraint and return a user-friendly error message
    
    try {
      // Get admin user info for audit tracking
      const session = await auth()
      if (!session?.user?.email) {
        await logger.warn('Admin update booking hold rejected: no user session')
        return unauthorizedResponse("User session required", { requestId })
      }

      // Ensure time fields are null (time is no longer used)
      // updateBookingHold accepts Partial<BookingHoldData>, so we can pass partial data
      const updateData: Partial<BookingHoldData> = {
        ...body,
        startTime: null,
        endTime: null,
      }
      const hold = await updateBookingHold(id, updateData, session.user.email)

      await logger.info('Booking hold updated', {
        holdId: id,
        startDate: hold.startDate,
        endDate: hold.endDate,
      })

      return successResponse(
        { hold },
        { requestId }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // Check if this is an optimistic locking conflict (concurrent modification)
      if (errorMessage.includes('modified by another user') || errorMessage.includes('modified by another process')) {
        await logger.warn('Booking hold update rejected: optimistic locking conflict', {
          holdId: id,
          startDate: body.startDate,
          endDate: body.endDate,
          error: errorMessage
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          errorMessage, // Use the user-friendly message from optimistic locking
          undefined,
          409, // Conflict status code
          { requestId }
        )
      }
      
      // Check if this is a database constraint violation (overlap trigger)
      if (errorMessage.includes('overlaps with an existing booking hold')) {
        await logger.warn('Booking hold update rejected: database constraint violation (overlap)', {
          holdId: id,
          startDate: body.startDate,
          endDate: body.endDate,
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
        await logger.warn('Booking hold update rejected: invalid date or date calculation error', {
          startDate: body.startDate,
          endDate: body.endDate,
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
      
      await logger.error('Booking hold update failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to update booking hold",
        errorMessage,
        500,
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

/**
 * DELETE /api/v1/admin/booking-holds/[id]
 * Delete a booking hold
 */
export const DELETE = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin delete booking hold request received', { holdId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete booking hold rejected: authentication failed')
      return authError
    }

    // Check if hold exists
    const existingHold = await getBookingHoldById(id)
    if (!existingHold) {
      await logger.warn('Booking hold not found for deletion', { holdId: id })
      return notFoundResponse("Booking hold not found", { requestId })
    }

    try {
      await deleteBookingHold(id)

      await logger.info('Booking hold deleted', { holdId: id })

      return successResponse(
        { message: "Booking hold deleted successfully" },
        { requestId }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // Check if hold was not found (race condition: deleted between existence check and delete)
      if (errorMessage.includes('not found')) {
        await logger.warn('Booking hold not found for deletion (race condition)', { holdId: id })
        return notFoundResponse("Booking hold not found", { requestId })
      }
      
      await logger.error('Booking hold deletion failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to delete booking hold",
        errorMessage,
        500,
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

