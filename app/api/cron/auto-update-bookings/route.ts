/**
 * Auto-Update Bookings Cron Job
 * 
 * This endpoint is called by Vercel cron jobs to automatically:
 * - Cancel pending/pending_deposit/paid_deposit bookings with past start dates
 * - Mark confirmed bookings as finished when past end date
 * 
 * Note: Bookings updated in the last 15 minutes are skipped to avoid conflicts
 * with admin actions and slow email sending operations.
 * 
 * This endpoint should be called periodically (e.g., every hour)
 */

import { NextResponse } from 'next/server'
import { autoUpdateFinishedBookings } from '@/lib/bookings'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

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
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/auto-update-bookings')
    
    await logger.info('Auto-update bookings cron job started')
    
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
    
    // Run auto-update
    const startTime = Date.now()
    await logger.info('Starting auto-update bookings', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[auto-update-bookings] Starting auto-update bookings processing (timeout: ${CRON_TIMEOUT_MS}ms)`)
    
    let result
    try {
      // Execute with timeout to prevent hanging
      result = await withTimeout(
        () => autoUpdateFinishedBookings(),
        CRON_TIMEOUT_MS,
        'Auto-update bookings timed out'
      )
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await logger.error('Auto-update bookings failed', error instanceof Error ? error : new Error(errorMessage))
      console.error(`[auto-update-bookings] Auto-update failed after ${duration}ms:`, errorMessage)
      throw error
    }
    
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
  }, { endpoint: '/api/cron/auto-update-bookings' })
}

