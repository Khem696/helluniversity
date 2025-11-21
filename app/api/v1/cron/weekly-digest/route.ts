/**
 * Weekly Digest Cron Job API v1
 * 
 * Versioned endpoint for weekly digest cron job
 * Maintains backward compatibility with /api/cron/weekly-digest
 * 
 * GET /api/v1/cron/weekly-digest - Send weekly digest (cron)
 * POST /api/v1/cron/weekly-digest - Send weekly digest (cron)
 */

/**
 * Weekly Booking Digest Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends weekly booking digest email to admin
 */

// CRITICAL: Force dynamic execution to prevent caching
// Cron jobs must execute every time, not serve cached responses
export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server"
import { sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
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
  }, { endpoint: getRequestPath(request) })
})

// Also support POST for manual triggers  
export const POST = GET




