/**
 * Booking Reminders Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends reminder emails for upcoming bookings
 */

import { NextResponse } from "next/server"
import { sendBookingReminders } from "@/lib/booking-reminders"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/reminders')
    
    await logger.info('Reminders cron job started')
    
    // Verify Vercel cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret) {
      await logger.error('CRON_SECRET not configured', new Error('CRON_SECRET not configured'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        'Cron secret not configured',
        undefined,
        500,
        { requestId }
      )
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      await logger.warn('Unauthorized cron job attempt')
      return errorResponse(
        ErrorCodes.UNAUTHORIZED,
        'Unauthorized',
        undefined,
        401,
        { requestId }
      )
    }

    // Send reminders
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
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: '/api/cron/reminders' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}




