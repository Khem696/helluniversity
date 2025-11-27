/**
 * Cleanup Error Logs Cron Job API v1
 * 
 * Periodic cleanup of old error logs to prevent database bloat
 * 
 * GET/POST /api/v1/cron/cleanup-error-logs - Cleanup old error logs
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cleanupOldErrorLogs, getErrorLogStats, logInfo, logError } from '@/lib/logger'
import { verifyCronSecret, withTimeout, CRON_TIMEOUT_MS } from '@/lib/cron-utils'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { getRequestPath } from '@/lib/api-versioning'
import { withVersioning } from '@/lib/api-version-wrapper'

// Default: keep logs for 30 days, configurable via env var
const DAYS_TO_KEEP = parseInt(process.env.ERROR_LOG_RETENTION_DAYS || '30', 10)

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    
    await logInfo('Error log cleanup cron job started', { requestId })
    
    // Verify Vercel cron secret
    try {
      verifyCronSecret(request)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
      await logError('Cleanup error logs authentication failed', { requestId }, 
        error instanceof Error ? error : new Error(errorMessage))
      return errorResponse(
        errorMessage.includes('not configured') ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.UNAUTHORIZED,
        errorMessage,
        undefined,
        errorMessage.includes('not configured') ? 500 : 401,
        { requestId }
      )
    }

    const startTime = Date.now()
    
    try {
      // Get stats before cleanup
      const statsBefore = await getErrorLogStats()
      
      // Execute cleanup with timeout
      const deletedCount = await withTimeout(
        () => cleanupOldErrorLogs(DAYS_TO_KEEP),
        CRON_TIMEOUT_MS,
        'Error log cleanup timed out'
      )
      
      // Get stats after cleanup
      const statsAfter = await getErrorLogStats()
      
      const duration = Date.now() - startTime
      
      await logInfo('Error log cleanup completed', {
        requestId,
        deletedCount,
        daysToKeep: DAYS_TO_KEEP,
        totalBefore: statsBefore.total,
        totalAfter: statsAfter.total,
        duration: `${duration}ms`,
      })
      
      return successResponse(
        {
          message: 'Error log cleanup completed',
          deletedCount,
          daysToKeep: DAYS_TO_KEEP,
          stats: {
            before: statsBefore,
            after: statsAfter,
          },
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        },
        { requestId }
      )
    } catch (error) {
      const duration = Date.now() - startTime
      await logError('Error log cleanup failed', { requestId, duration: `${duration}ms` },
        error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }, { endpoint: getRequestPath(request) })
})

export const POST = GET

