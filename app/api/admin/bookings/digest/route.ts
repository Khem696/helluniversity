/**
 * Booking Digest API
 * 
 * Endpoints for daily/weekly booking digest emails
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest, sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { checkAuth } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/digest')
    
    await logger.info('Admin send digest request received')
    
    const authError = await checkAuth()
    if (authError) {
      await logger.warn('Admin send digest rejected: authentication failed')
      return authError
    }

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




