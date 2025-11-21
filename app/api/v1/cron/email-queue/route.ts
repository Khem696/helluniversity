/**
 * Email Queue Cron Job API v1
 * 
 * Versioned endpoint for email queue processing cron job
 * Maintains backward compatibility with /api/cron/email-queue
 * 
 * GET /api/v1/cron/email-queue - Process email queue (cron)
 * POST /api/v1/cron/email-queue - Process email queue (cron)
 */

/**
 * Email Queue Processing Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Processes failed emails for critical status changes
 * Handles status_change emails with status: pending_deposit, confirmed, cancelled
 */

// CRITICAL: Force dynamic execution to prevent caching
// Cron jobs must execute every time, not serve cached responses
export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server"
import { processCriticalStatusEmails } from "@/lib/email-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS, CRON_LIMITS } from '@/lib/cron-utils'

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Email queue cron job started')
    
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

    // Process critical status change emails (pending_deposit/confirmed/cancelled)
    const startTime = Date.now()
    const limit = CRON_LIMITS.EMAIL_QUEUE
    await logger.info('Processing critical status emails', {
      limit,
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[email-queue] Starting email queue processing (limit: ${limit}, timeout: ${CRON_TIMEOUT_MS}ms)`)
    
    try {
      // Execute with timeout to prevent hanging
      const result = await withTimeout(
        () => processCriticalStatusEmails(limit),
        CRON_TIMEOUT_MS,
        'Email queue processing timed out'
      )
      const duration = Date.now() - startTime
      
      await logger.info('Email queue processed', {
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
        errorsCount: result.errors.length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
      
      console.log(`[email-queue] Email queue processing completed in ${duration}ms:`)
      console.log(`[email-queue]   - Processed: ${result.processed}`)
      console.log(`[email-queue]   - Sent successfully: ${result.sent}`)
      console.log(`[email-queue]   - Failed: ${result.failed}`)
      console.log(`[email-queue]   - Errors: ${result.errors.length}`)
      if (result.errors.length > 0) {
        console.error(`[email-queue]   - Error details:`, result.errors)
      }
      
      return successResponse(
        {
          message: "Critical status email queue processed (pending_deposit/confirmed/cancelled)",
          result: {
            processed: result.processed,
            sent: result.sent,
            failed: result.failed,
            errors: result.errors,
          },
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        },
        { requestId }
      )
    } catch (error) {
      const duration = Date.now() - startTime
      await logger.error('Failed to process email queue', error instanceof Error ? error : new Error(String(error)))
      console.error(`[email-queue] Failed to process email queue after ${duration}ms:`, error)
      throw error
    }
  }, { endpoint: getRequestPath(request) })
})

// Also support POST for manual triggers
export const POST = GET

