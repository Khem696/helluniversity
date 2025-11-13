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
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'
import { registerAllJobHandlers } from '@/lib/job-handlers'

// Register handlers if not already registered (singleton pattern)
let handlersRegistered = false
if (!handlersRegistered) {
  registerAllJobHandlers()
  handlersRegistered = true
}

/**
 * Process job queue
 */
export async function GET(request: Request) {
  return handleJobQueue(request)
}

export async function POST(request: Request) {
  return handleJobQueue(request)
}

async function handleJobQueue(request: Request) {
  const requestId = crypto.randomUUID()
  const logger = createRequestLogger(requestId, '/api/cron/job-queue')
  
  try {
    await logger.info('Job queue cron job started')
    
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
    
    const startTime = Date.now()
    const limit = 10 // Process up to 10 jobs per run
    
    await logger.info('Processing job queue', {
      limit,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[job-queue] Starting job queue processing (limit: ${limit})`)
    
    const results = await processJobQueue(limit)
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
  } catch (error) {
    await logger.error(
      'Job queue processing failed',
      error instanceof Error ? error : new Error(String(error))
    )
    
    console.error(`[job-queue] Job queue processing failed:`, error)
    
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to process job queue',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
}

