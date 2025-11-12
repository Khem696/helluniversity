/**
 * Email Queue Processing Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Processes failed emails for critical status changes
 * Handles status_change emails with status: accepted, postponed, cancelled, rejected
 */

import { NextResponse } from "next/server"
import { processCriticalStatusEmails } from "@/lib/email-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/email-queue')
    
    await logger.info('Email queue cron job started')
    
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

    // Process critical status change emails (accepted/postponed/cancelled/rejected)
    await logger.info('Processing critical status emails')
    const result = await processCriticalStatusEmails(20)
    
    await logger.info('Email queue processed', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      errorsCount: result.errors.length
    })
    
    return successResponse(
      {
        message: "Critical status email queue processed (accepted/postponed/cancelled/rejected)",
        result: {
          processed: result.processed,
          sent: result.sent,
          failed: result.failed,
          errors: result.errors,
        },
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: '/api/cron/email-queue' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}

