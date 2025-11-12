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
export async function GET() {
  return handleJobQueue()
}

export async function POST() {
  return handleJobQueue()
}

async function handleJobQueue() {
  const requestId = crypto.randomUUID()
  const logger = createRequestLogger(requestId, '/api/cron/job-queue')
  
  try {
    await logger.info('Processing job queue')
    
    const limit = 10 // Process up to 10 jobs per run
    const results = await processJobQueue(limit)
    
    await logger.info('Job queue processed', results)
    
    return successResponse(
      {
        message: 'Job queue processed',
        ...results,
      },
      { requestId }
    )
  } catch (error) {
    await logger.error(
      'Job queue processing failed',
      error instanceof Error ? error : new Error(String(error))
    )
    
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to process job queue',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
}

