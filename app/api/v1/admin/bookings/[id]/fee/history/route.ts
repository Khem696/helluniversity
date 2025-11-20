import { NextResponse } from "next/server"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import {
  getBookingById,
  getBookingFeeHistory,
} from "@/lib/bookings"
import {
  requireAuthorizedDomain,
} from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Admin Booking Fee History API v1
 * 
 * Versioned endpoint for booking fee history
 * GET /api/v1/admin/bookings/[id]/fee/history - Get booking fee history
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

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin get booking fee history request (v1)', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get booking fee history rejected: authentication failed', { bookingId: id })
      return authError
    }

    const booking = await getBookingById(id)
    if (!booking) {
      return notFoundResponse('Booking', { requestId })
    }

    try {
      const history = await getBookingFeeHistory(id)
      
      return successResponse(
        {
          history,
        },
        { requestId }
      )
    } catch (error) {
      await logger.error('Failed to get booking fee history', error instanceof Error ? error : new Error(String(error)), { bookingId: id })
      throw error
    }
  }, { endpoint: getRequestPath(request) })
})

