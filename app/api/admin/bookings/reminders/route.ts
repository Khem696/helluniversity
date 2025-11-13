/**
 * Booking Reminders API
 * 
 * Endpoint to send reminder emails for upcoming bookings
 */

import { NextResponse } from "next/server"
import { sendBookingReminders } from "@/lib/booking-reminders"
import { checkAdminAuth } from "@/lib/admin-auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, ApiResponse } from "@/lib/api-response"

export async function POST(request: Request) {
  return withErrorHandling(async (): Promise<NextResponse<ApiResponse<any>>> => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/reminders')
    
    await logger.info('Admin send reminders request received')
    
    // Check authentication
    const authResult = await checkAdminAuth(requestId, logger, '/api/admin/bookings/reminders')
    if (!authResult.success) {
      return authResult.response
    }
    
    await logger.info('Admin authenticated for reminders request', {
      userId: authResult.user.id,
      email: authResult.user.email
    })

    await logger.info('Sending booking reminders')
    const result = await sendBookingReminders()
    
    await logger.info('Reminders sent', {
      sent7Day: result.sent7Day,
      sent24Hour: result.sent24Hour,
      errorsCount: result.errors
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




