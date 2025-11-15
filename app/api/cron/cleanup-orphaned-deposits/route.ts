/**
 * Cleanup Orphaned Deposit Blobs Cron Job
 * 
 * This endpoint is called by Vercel cron jobs to automatically:
 * - Find deposit evidence blobs that are not referenced in the bookings table
 * - Delete orphaned blobs to free up storage space
 * 
 * This endpoint should be called periodically (e.g., daily or weekly)
 */

import { NextResponse } from 'next/server'
import { cleanupOrphanedDepositBlobs } from '@/lib/deposit-cleanup'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

/**
 * Cleanup orphaned deposit blobs
 */
export async function GET(request: Request) {
  return handleCleanup(request)
}

export async function POST(request: Request) {
  return handleCleanup(request)
}

async function handleCleanup(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/cron/cleanup-orphaned-deposits')
    
    await logger.info('Cleanup orphaned deposit blobs cron job started')
    
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
    
    // Run cleanup
    const startTime = Date.now()
    await logger.info('Starting orphaned deposit blob cleanup', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    console.log(`[cleanup-orphaned-deposits] Starting cleanup (timeout: ${CRON_TIMEOUT_MS}ms)`)
    
    let result
    try {
      // Execute with timeout to prevent hanging
      result = await withTimeout(
        () => cleanupOrphanedDepositBlobs(logger),
        CRON_TIMEOUT_MS,
        'Cleanup orphaned deposit blobs timed out'
      )
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await logger.error('Cleanup orphaned deposit blobs failed', error instanceof Error ? error : new Error(errorMessage))
      console.error(`[cleanup-orphaned-deposits] Cleanup failed after ${duration}ms:`, errorMessage)
      throw error
    }
    
    const duration = Date.now() - startTime
    
    await logger.info('Cleanup orphaned deposit blobs completed', {
      checked: result.checked,
      orphaned: result.orphaned,
      deleted: result.deleted,
      errors: result.errors.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
    
    // Log detailed results for debugging
    console.log(`[cleanup-orphaned-deposits] Cleanup completed in ${duration}ms:`)
    console.log(`[cleanup-orphaned-deposits]   - Checked: ${result.checked}`)
    console.log(`[cleanup-orphaned-deposits]   - Orphaned: ${result.orphaned}`)
    console.log(`[cleanup-orphaned-deposits]   - Deleted: ${result.deleted}`)
    console.log(`[cleanup-orphaned-deposits]   - Errors: ${result.errors.length}`)
    
    if (result.errors.length > 0) {
      console.log(`[cleanup-orphaned-deposits]   - Error details (first 5):`)
      result.errors.slice(0, 5).forEach((err, idx) => {
        console.log(`[cleanup-orphaned-deposits]     ${idx + 1}. ${err}`)
      })
    }
    
    return successResponse(
      {
        message: 'Orphaned deposit blobs cleanup completed',
        checked: result.checked,
        orphaned: result.orphaned,
        deleted: result.deleted,
        errors: result.errors.length,
        errorDetails: result.errors.length > 0 ? result.errors.slice(0, 10) : undefined, // Limit to first 10 errors
      },
      { requestId }
    )
  }, { endpoint: '/api/cron/cleanup-orphaned-deposits' })
}

