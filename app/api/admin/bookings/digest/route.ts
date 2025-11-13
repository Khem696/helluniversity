/**
 * Booking Digest API
 * 
 * Endpoints for daily/weekly booking digest emails
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest, sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { checkAdminAuth } from "@/lib/admin-auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, ApiResponse } from "@/lib/api-response"

export async function POST(request: Request) {
  return withErrorHandling(async (): Promise<NextResponse<ApiResponse<any>>> => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/digest')
    
    await logger.info('Admin send digest request received')
    
    // Check authentication
    const authResult = await checkAdminAuth(requestId, logger, '/api/admin/bookings/digest')
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
  }, { endpoint: '/api/admin/bookings/digest' })
}




