/**
 * Weekly Booking Digest Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends weekly booking digest email to admin
 */

import { NextResponse } from "next/server"
import { sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/weekly-digest')
    
    await logger.info('Weekly digest cron job started')
    
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

    // Send weekly digest
    const startTime = Date.now()
    await logger.info('Sending weekly booking digest', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    try {
      // Execute with timeout to prevent hanging
      await withTimeout(
        () => sendWeeklyBookingDigest(),
        CRON_TIMEOUT_MS,
        'Weekly digest processing timed out'
      )
      const duration = Date.now() - startTime
      
      await logger.info('Weekly booking digest sent successfully', {
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
      
      console.log(`[weekly-digest] Successfully sent weekly booking digest in ${duration}ms`)
      
      return successResponse(
        {
          message: "Weekly booking digest sent successfully",
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        },
        { requestId }
      )
    } catch (error) {
      const duration = Date.now() - startTime
      await logger.error('Failed to send weekly booking digest', error instanceof Error ? error : new Error(String(error)))
      console.error(`[weekly-digest] Failed to send weekly booking digest after ${duration}ms:`, error)
      throw error
    }
  }, { endpoint: '/api/cron/weekly-digest' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}




