/**
 * Cleanup Expired Action Locks Cron Job API v1
 *
 * Versioned endpoint for periodic cleanup of expired action locks
 *
 * GET/POST /api/v1/cron/cleanup-expired-locks - Cleanup expired action locks
 */

/**
 * Cleanup Expired Action Locks Cron Job
 * 
 * This endpoint is called by Vercel cron jobs to automatically:
 * - Find action locks that have expired (expires_at < now)
 * - Delete expired locks to prevent database bloat
 * - Broadcast lock expiration events to connected SSE clients
 * 
 * This endpoint should be called periodically (e.g., every 30 minutes or hourly)
 */

// CRITICAL: Force dynamic execution to prevent caching
// Cron jobs must execute every time, not serve cached responses
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cleanupExpiredLocks } from '@/lib/action-lock'
import { createRequestLogger } from '@/lib/logger'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { getRequestPath } from '@/lib/api-versioning'
import { withVersioning } from '@/lib/api-version-wrapper'
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'

export const GET = withVersioning(async (request: Request) => {
  return handleCleanup(request)
})

export const POST = async (request: Request) => {
  return handleCleanup(request)
}

async function handleCleanup(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Cleanup expired action locks cron job started')
    
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
    await logger.info('Starting expired action locks cleanup', {
      timeout: `${CRON_TIMEOUT_MS}ms`,
      timestamp: new Date().toISOString(),
      timezone: 'UTC'
    })
    
    let deletedCount: number
    try {
      // Execute with timeout to prevent hanging
      deletedCount = await withTimeout(
        async () => {
          const count = await cleanupExpiredLocks()
          return count
        },
        CRON_TIMEOUT_MS,
        'Cleanup expired action locks timed out'
      )
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await logger.error('Cleanup expired action locks failed', error instanceof Error ? error : new Error(errorMessage))
      throw error
    }
    
    const duration = Date.now() - startTime
    
    await logger.info('Cleanup expired action locks completed', {
      deletedCount,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
    
    return successResponse(
      {
        deletedCount,
        duration: `${duration}ms`,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
}


