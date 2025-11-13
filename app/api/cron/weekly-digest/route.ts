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

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/weekly-digest')
    
    await logger.info('Weekly digest cron job started')
    
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

    // Send weekly digest
    const startTime = Date.now()
    await logger.info('Sending weekly booking digest', {
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    try {
      await sendWeeklyBookingDigest()
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




