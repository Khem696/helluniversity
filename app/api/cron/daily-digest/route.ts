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

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/daily-digest')
    
    await logger.info('Daily digest cron job started')
    
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

    // Send daily digest
    await logger.info('Sending daily booking digest')
    await sendDailyBookingDigest()
    
    await logger.info('Daily booking digest sent successfully')
    
    return successResponse(
      {
        message: "Daily booking digest sent successfully",
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: '/api/cron/daily-digest' })
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}




