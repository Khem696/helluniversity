/**
 * Admin Email Queue API v1
 * 
 * Versioned endpoint for email queue management
 * Maintains backward compatibility with /api/admin/email-queue
 * 
 * GET /api/v1/admin/email-queue - List email queue
 * POST /api/v1/admin/email-queue - Retry failed emails
 */

import { NextResponse } from "next/server"
import { requireAuthorizedDomain } from "@/lib/auth"
import { 
  processEmailQueue, 
  getEmailQueueStats, 
  getEmailQueueItems,
  cleanupOldSentEmails 
} from "@/lib/email-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Email Queue Management API
 * 
 * GET /api/admin/email-queue - Get email queue statistics and items
 * POST /api/admin/email-queue - Process pending emails or cleanup old emails
 * - Requires Google Workspace authentication
 */

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

/**
 * GET /api/admin/email-queue
 * Get email queue statistics and items
 */
export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin email queue GET request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin email queue GET rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") as any
    const emailType = searchParams.get("emailType") as any
    // CRITICAL: Validate and clamp limit/offset to prevent DoS
    const rawLimit = searchParams.get("limit")
    const rawOffset = searchParams.get("offset")
    const limit = rawLimit ? (() => {
      const parsed = parseInt(rawLimit)
      return isNaN(parsed) ? undefined : Math.max(1, Math.min(1000, parsed))
    })() : undefined
    const offset = rawOffset ? (() => {
      const parsed = parseInt(rawOffset)
      return isNaN(parsed) ? undefined : Math.max(0, Math.min(1000000, parsed))
    })() : undefined
    const statsOnly = searchParams.get("statsOnly") === "true"
    
    await logger.debug('Email queue GET parameters', { status, emailType, limit, offset, statsOnly })

    if (statsOnly) {
      const stats = await getEmailQueueStats()
      await logger.info('Email queue stats retrieved')
      return successResponse(
        {
          stats,
        },
        { requestId }
      )
    }

    // Get items with filters
    const result = await getEmailQueueItems({
      status,
      emailType,
      limit,
      offset,
    })

    const stats = await getEmailQueueStats()
    
    await logger.info('Email queue items retrieved', {
      itemsCount: result.items.length,
      total: result.total
    })

    return successResponse(
      {
        items: result.items,
        total: result.total,
        stats,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * POST /api/admin/email-queue
 * Process pending emails in queue or cleanup old emails
 */
export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin email queue POST request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin email queue POST rejected: authentication failed')
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 102400) // 100KB limit for email queue config
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      // For email queue, default to empty object if parsing fails (backward compatibility)
      body = {}
    }
    
    const { action, limit, daysOld } = body
    
    await logger.debug('Email queue POST parameters', { action, limit, daysOld })

    if (action === "cleanup") {
      await logger.info('Cleaning up old sent emails', { daysOld: daysOld || 30 })
      const deletedCount = await cleanupOldSentEmails(daysOld || 30)
      await logger.info('Old emails cleaned up', { deletedCount })
      return successResponse(
        {
          message: `Cleaned up ${deletedCount} old sent emails`,
          deletedCount,
        },
        { requestId }
      )
    }

    // Default: process queue
    await logger.info('Processing email queue', { limit: limit || 10 })
    const result = await processEmailQueue(limit || 10)
    
    await logger.info('Email queue processed', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed
    })

    return successResponse(
      {
        result,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

