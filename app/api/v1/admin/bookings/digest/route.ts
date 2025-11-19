/**
 * Admin Booking Digest API v1
 * 
 * Versioned endpoint for booking digest
 * Maintains backward compatibility with /api/admin/bookings/digest
 * 
 * POST /api/v1/admin/bookings/digest - Send booking digest
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest, sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { checkAdminAuth } from "@/lib/admin-auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, ApiResponse } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async (): Promise<NextResponse<ApiResponse<any>>> => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin send digest request received')
    
    // Check authentication
    const authResult = await checkAdminAuth(requestId, logger, endpoint)
    if (!authResult.success) {
      return authResult.response
    }
    
    await logger.info('Admin authenticated for digest request', {
      userId: authResult.user.id,
      email: authResult.user.email
    })

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10240) // 10KB limit for digest type data
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
    const { type } = body // "daily" or "weekly"

    if (!type || !["daily", "weekly"].includes(type)) {
      await logger.warn('Digest request rejected: invalid type', { type })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid type. Must be 'daily' or 'weekly'",
        undefined,
        400,
        { requestId }
      )
    }

    if (type === "daily") {
      await logger.info('Sending daily booking digest')
      await sendDailyBookingDigest()
      await logger.info('Daily booking digest sent successfully')
      return successResponse(
        {
          message: "Daily booking digest sent successfully",
        },
        { requestId }
      )
    } else {
      await logger.info('Sending weekly booking digest')
      await sendWeeklyBookingDigest()
      await logger.info('Weekly booking digest sent successfully')
      return successResponse(
        {
          message: "Weekly booking digest sent successfully",
        },
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

