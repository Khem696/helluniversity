/**
 * Booking Reminders API
 * 
 * Endpoint to send reminder emails for upcoming bookings
 */

import { NextResponse } from "next/server"
import { sendBookingReminders } from "@/lib/booking-reminders"
import { checkAuth } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/reminders')
    
    await logger.info('Admin send reminders request received')
    
    const authError = await checkAuth()
    if (authError) {
      await logger.warn('Admin send reminders rejected: authentication failed')
      return authError
    }

    await logger.info('Sending booking reminders')
    const result = await sendBookingReminders()
    
    await logger.info('Reminders sent', {
      sent7Day: result.sent7Day,
      sent24Hour: result.sent24Hour,
      errorsCount: result.errors.length
    })
    
    return successResponse(
      {
        message: "Reminders sent successfully",
        result: {
          sent7Day: result.sent7Day,
          sent24Hour: result.sent24Hour,
          errors: result.errors,
        },
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/bookings/reminders' })
}




