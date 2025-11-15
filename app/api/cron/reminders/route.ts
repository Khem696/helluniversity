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
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/reminders')
    
    await logger.info('Reminders cron job started')
    
    // Verify Vercel cron secret
    try {
      verifyCronSecret(request)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
      await logger.error(errorMessage, error instanceof Error ? error : new Error(errorMessage))
      return errorResponse(
        errorMessage.includes('not configured') ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.UNAUTHORIZED,
        errorMessage,
        undefined,
        errorMessage.includes('not configured') ? 500 : 401,
        { requestId }
      )
    }

    // Send reminders
    const startTime = Date.now()
    await logger.info('Sending booking reminders', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    try {
      // Execute with timeout to prevent hanging
      const result = await withTimeout(
        () => sendBookingReminders(),
        CRON_TIMEOUT_MS,
        'Reminders processing timed out'
      )
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




