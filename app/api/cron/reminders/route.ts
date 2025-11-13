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
    const startTime = Date.now()
    await logger.info('Sending booking reminders', {
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    try {
      const result = await sendBookingReminders()
      const duration = Date.now() - startTime
      
      await logger.info('Reminders sent', {
        sent7Day: result.sent7Day,
        sent24Hour: result.sent24Hour,
        errorsCount: result.errors,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
      
      console.log(`[reminders] Processed reminders in ${duration}ms:`)
      console.log(`[reminders]   - 7-day reminders sent: ${result.sent7Day}`)
      console.log(`[reminders]   - 24-hour reminders sent: ${result.sent24Hour}`)
      console.log(`[reminders]   - Errors: ${result.errors}`)
      if (result.errors > 0) {
        console.error(`[reminders]   - ${result.errors} reminder(s) failed to send`)
      }
      
      return successResponse(
        {
          message: "Reminders sent successfully",
          result: {
            sent7Day: result.sent7Day,
            sent24Hour: result.sent24Hour,
            errors: result.errors,
          },
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        },
        { requestId }
      )
    } catch (error) {
      const duration = Date.now() - startTime
      await logger.error('Failed to send booking reminders', error instanceof Error ? error : new Error(String(error)))
      console.error(`[reminders] Failed to send booking reminders after ${duration}ms:`, error)
      throw error
    }
  }, { endpoint: '/api/cron/reminders' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}




