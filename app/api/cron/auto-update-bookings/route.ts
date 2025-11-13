/**
 * Auto-Update Bookings Cron Job
 * 
 * This endpoint is called by Vercel cron jobs to automatically:
 * - Cancel pending/postponed bookings with past start dates
 * - Cancel accepted bookings past grace period without check-in
 * - Mark finished bookings past end date
 * 
 * This endpoint should be called periodically (e.g., every hour)
 */

import { NextResponse } from 'next/server'
import { autoUpdateFinishedBookings } from '@/lib/bookings'
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'

/**
 * Auto-update bookings (cancel past pending, finish past bookings)
 */
export async function GET(request: Request) {
  return handleAutoUpdate(request)
}

export async function POST(request: Request) {
  return handleAutoUpdate(request)
}

async function handleAutoUpdate(request: Request) {
  const requestId = crypto.randomUUID()
  const logger = createRequestLogger(requestId, '/api/cron/auto-update-bookings')
  
  try {
    await logger.info('Auto-update bookings cron job started')
    
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
    
    // Run auto-update
    const startTime = Date.now()
    await logger.info('Starting auto-update bookings', {
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[auto-update-bookings] Starting auto-update bookings processing`)
    
    const result = await autoUpdateFinishedBookings()
    const duration = Date.now() - startTime
    
    await logger.info('Auto-update bookings completed', {
      finished: result.finished,
      cancelled: result.cancelled,
      updatedCount: result.updatedBookings.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      updatedBookings: result.updatedBookings.map(b => ({
        id: b.booking.id,
        oldStatus: b.oldStatus,
        newStatus: b.newStatus
      }))
    })
    
    // Log detailed results for debugging
    console.log(`[auto-update-bookings] Auto-update completed in ${duration}ms:`)
    console.log(`[auto-update-bookings]   - Finished: ${result.finished}`)
    console.log(`[auto-update-bookings]   - Cancelled: ${result.cancelled}`)
    console.log(`[auto-update-bookings]   - Total updated: ${result.updatedBookings.length}`)
    
    if (result.updatedBookings.length > 0) {
      console.log(`[auto-update-bookings]   - Updated bookings details:`)
      result.updatedBookings.forEach(b => {
        console.log(`[auto-update-bookings]     • Booking ${b.booking.id}: ${b.oldStatus} → ${b.newStatus} (${b.reason})`)
      })
    } else {
      console.log(`[auto-update-bookings]   - No bookings needed updating`)
    }
    
    return successResponse(
      {
        message: 'Bookings auto-updated successfully',
        finished: result.finished,
        cancelled: result.cancelled,
        updatedBookings: result.updatedBookings.map(b => ({
          id: b.booking.id,
          oldStatus: b.oldStatus,
          newStatus: b.newStatus,
          reason: b.reason
        }))
      },
      { requestId }
    )
  } catch (error) {
    await logger.error(
      'Auto-update bookings cron job failed',
      error instanceof Error ? error : new Error(String(error))
    )
    
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to auto-update bookings',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
}

