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

    const body = await request.json()
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

