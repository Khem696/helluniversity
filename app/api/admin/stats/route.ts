import { NextResponse } from "next/server"
import { requireAuthorizedDomain } from "@/lib/auth"
import { listBookings } from "@/lib/bookings"
import { getEmailQueueStats } from "@/lib/email-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Admin Statistics API
 * 
 * GET /api/admin/stats - Get admin statistics (bookings count, email queue count)
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
 * GET /api/admin/stats
 * Get admin statistics
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/stats')
    
    await logger.info('Admin stats request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin stats request rejected: authentication failed')
      return authError
    }

    try {
      // Get pending bookings count (non-archived bookings that need attention)
      // Count bookings with status: pending, pending_deposit, paid_deposit
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0, // We only need the count
        offset: 0,
      })

      // Get email queue stats
      const emailQueueStats = await getEmailQueueStats()
      
      // Calculate pending email count (pending + failed)
      const pendingEmailCount = (emailQueueStats.pending || 0) + (emailQueueStats.failed || 0)

      await logger.info('Admin stats retrieved', {
        pendingBookings: pendingBookingsResult.total,
        pendingEmails: pendingEmailCount,
      })

      return successResponse(
        {
          bookings: {
            pending: pendingBookingsResult.total,
          },
          emailQueue: {
            pending: emailQueueStats.pending || 0,
            failed: emailQueueStats.failed || 0,
            total: pendingEmailCount,
          },
        },
        { requestId }
      )
    } catch (error) {
      await logger.error('Failed to get admin stats', error instanceof Error ? error : new Error(String(error)))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve statistics',
        undefined,
        500,
        { requestId }
      )
    }
  }, { endpoint: '/api/admin/stats' })
}

