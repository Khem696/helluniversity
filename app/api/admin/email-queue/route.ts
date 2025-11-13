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
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/email-queue')
    
    await logger.info('Admin email queue GET request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin email queue GET rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") as any
    const emailType = searchParams.get("emailType") as any
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : undefined
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
  }, { endpoint: '/api/admin/email-queue' })
}

/**
 * POST /api/admin/email-queue
 * Process pending emails in queue or cleanup old emails
 */
export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/email-queue')
    
    await logger.info('Admin email queue POST request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin email queue POST rejected: authentication failed')
      return authError
    }

    const body = await request.json().catch(() => ({}))
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
  }, { endpoint: '/api/admin/email-queue' })
}

