/**
 * Job Queue Cron Job API v1
 * 
 * Versioned endpoint for job queue processing cron job
 * Maintains backward compatibility with /api/cron/job-queue
 * 
 * GET /api/v1/cron/job-queue - Process job queue (cron)
 * POST /api/v1/cron/job-queue - Process job queue (cron)
 */

/**
 * Job Queue Processing Cron Endpoint
 * 
 * GET /api/cron/job-queue - Process pending jobs
 * POST /api/cron/job-queue - Process pending jobs (alternative)
 * 
 * This endpoint should be called by Vercel Cron or similar scheduler
 */

import { NextResponse } from 'next/server'
import { processJobQueue } from '@/lib/job-queue'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { createRequestLogger } from '@/lib/logger'
import { registerAllJobHandlers } from '@/lib/job-handlers'
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS, CRON_LIMITS } from '@/lib/cron-utils'

// Register handlers if not already registered (singleton pattern)
let handlersRegistered = false
if (!handlersRegistered) {
  registerAllJobHandlers()
  handlersRegistered = true
}

/**
 * Process job queue
 */
export const GET = withVersioning(async (request: Request) => {
  return handleJobQueue(request)
})

export const POST = withVersioning(async (request: Request) => {
  return handleJobQueue(request)
})

async function handleJobQueue(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Job queue cron job started')
    
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
    
    const startTime = Date.now()
    const limit = CRON_LIMITS.JOB_QUEUE
    
    await logger.info('Processing job queue', {
      limit,
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[job-queue] Starting job queue processing (limit: ${limit}, timeout: ${CRON_TIMEOUT_MS}ms)`)
    
    let results
    try {
      // Execute with timeout to prevent hanging
      results = await withTimeout(
        () => processJobQueue(limit),
        CRON_TIMEOUT_MS,
        'Job queue processing timed out'
      )
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await logger.error('Job queue processing failed', error instanceof Error ? error : new Error(errorMessage))
      console.error(`[job-queue] Job queue processing failed after ${duration}ms:`, errorMessage)
      
      // Return partial results if available, otherwise return error
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `Job queue processing failed: ${errorMessage}`,
        undefined,
        500,
        { requestId, duration: `${duration}ms` }
      )
    }
    
    const duration = Date.now() - startTime
    
    await logger.info('Job queue processed', {
      ...results,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    })
    
    console.log(`[job-queue] Job queue processing completed in ${duration}ms:`)
    console.log(`[job-queue]   - Processed: ${results.processed}`)
    console.log(`[job-queue]   - Completed: ${results.completed}`)
    console.log(`[job-queue]   - Failed: ${results.failed}`)
    console.log(`[job-queue]   - Errors: ${results.errors.length}`)
    if (results.errors.length > 0) {
      console.error(`[job-queue]   - Error details:`, results.errors)
    }
    
    return successResponse(
      {
        message: 'Job queue processed',
        ...results,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
}

