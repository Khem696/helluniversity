/**
 * Daily Booking Digest Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends daily booking digest email to admin
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest } from "@/lib/booking-digest"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/daily-digest')
    
    await logger.info('Daily digest cron job started')
    
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

    // Send daily digest
    const startTime = Date.now()
    await logger.info('Sending daily booking digest', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[daily-digest] Starting daily booking digest (timeout: ${CRON_TIMEOUT_MS}ms)`)
    
    try {
      // Execute with timeout to prevent hanging
      await withTimeout(
        () => sendDailyBookingDigest(),
        CRON_TIMEOUT_MS,
        'Daily digest processing timed out'
      )
      const duration = Date.now() - startTime
      
      await logger.info('Daily booking digest sent successfully', {
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
      
      console.log(`[daily-digest] Successfully sent daily booking digest in ${duration}ms`)
      
      return successResponse(
        {
          message: "Daily booking digest sent successfully",
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        },
        { requestId }
      )
    } catch (error) {
      const duration = Date.now() - startTime
      await logger.error('Failed to send daily booking digest', error instanceof Error ? error : new Error(String(error)))
      console.error(`[daily-digest] Failed to send daily booking digest after ${duration}ms:`, error)
      throw error
    }
  }, { endpoint: '/api/cron/daily-digest' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}




