/**
 * Cleanup Expired Booking Holds Cron Job API v1
 * 
 * This endpoint is called by Vercel Cron Jobs to automatically clean up expired booking holds.
 * Maintains backward compatibility with /api/cron/cleanup-expired-holds
 * 
 * GET/POST /api/v1/cron/cleanup-expired-holds - Cleanup expired booking holds
 */

// CRITICAL: Force dynamic execution to prevent caching
// Cron jobs must execute every time, not serve cached responses
export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { cleanupExpiredHolds } from "@/lib/booking-holds"
import { createRequestLogger } from "@/lib/logger"
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

/**
 * Cleanup Expired Booking Holds Cron Job
 * 
 * This endpoint should be called by Vercel Cron Jobs (or similar) to automatically
 * clean up expired booking holds that have passed their end date.
 * 
 * Optional query parameters:
 * - olderThanDays: Number of days to keep holds after end date (default: 0, meaning delete immediately after end date passes)
 */
export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Cleanup expired booking holds cron job started')
    
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

    // Get olderThanDays from query params (default: 0, meaning delete immediately after end date passes)
    const url = new URL(request.url)
    const olderThanDaysParam = url.searchParams.get('olderThanDays')
    const olderThanDays = olderThanDaysParam ? parseInt(olderThanDaysParam, 10) : 0

    if (isNaN(olderThanDays) || olderThanDays < 0) {
      await logger.warn('Cleanup expired holds cron job rejected: invalid olderThanDays parameter')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "olderThanDays must be a non-negative number",
        undefined,
        400,
        { requestId }
      )
    }

    // Run cleanup with timeout
    const startTime = Date.now()
    await logger.info('Starting expired booking holds cleanup', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      olderThanDays,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    let result
    try {
      // Execute with timeout to prevent hanging
      result = await withTimeout(
        () => cleanupExpiredHolds(olderThanDays),
        CRON_TIMEOUT_MS,
        'Cleanup expired holds operation'
      )

      const duration = Date.now() - startTime
      const deletedCount = typeof result === 'object' ? result.deletedCount : result
      const skippedCount = typeof result === 'object' ? result.skippedCount : 0
      const errorCount = typeof result === 'object' ? result.errorCount : 0
      
      await logger.info('Cleanup expired booking holds completed', {
        deletedCount,
        skippedCount,
        errorCount,
        olderThanDays,
        duration: `${duration}ms`
      })

      // Build message based on results
      let message = `Cleaned up ${deletedCount} expired booking hold(s)`
      if (skippedCount > 0) {
        message += `. ${skippedCount} hold(s) were already deleted (possibly by concurrent operation)`
      }
      if (errorCount > 0) {
        message += `. ${errorCount} hold(s) failed timestamp calculation and were skipped (may need manual review)`
      }

      return successResponse(
        {
          deletedCount,
          skippedCount,
          errorCount,
          olderThanDays,
          duration: `${duration}ms`,
          message
        },
        { requestId }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const duration = Date.now() - startTime
      
      if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
        await logger.error('Cleanup expired holds cron job timed out', new Error(errorMessage))
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Cleanup operation timed out. Some holds may have been deleted.",
          errorMessage,
          500,
          { requestId }
        )
      }

      await logger.error('Cleanup expired holds cron job failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to cleanup expired booking holds",
        errorMessage,
        500,
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})

// POST handler for backward compatibility
export const POST = GET

