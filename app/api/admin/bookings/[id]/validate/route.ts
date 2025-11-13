import { NextResponse } from "next/server"
import { validateAction, type Booking } from "@/lib/booking-action-validation"
import {
  requireAuthorizedDomain,
} from "@/lib/auth"
import { getBookingById } from "@/lib/bookings"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { createRequestLogger } from "@/lib/logger"
import { createBangkokTimestamp } from "@/lib/timezone"

/**
 * Validate booking action before execution
 * POST /api/admin/bookings/[id]/validate
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/[id]/validate')
    
    await logger.info('Booking action validation request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Validation request rejected: authentication failed', { bookingId: id })
      return authError
    }

    try {
      const body = await request.json()
      const { action, targetStatus } = body

      if (!action || !targetStatus) {
        return errorResponse(
          ErrorCodes.INVALID_INPUT,
          "Missing required fields: action and targetStatus",
          {},
          400,
          { requestId }
        )
      }

      // Get booking from database
      const booking = await getBookingById(id)
      if (!booking) {
        await logger.warn('Validation failed: booking not found', { bookingId: id })
        return notFoundResponse('Booking', { requestId })
      }

      // Transform booking to match validation interface
      // CRITICAL: Use createBangkokTimestamp to handle YYYY-MM-DD strings in Bangkok timezone
      // Note: responseDate and depositVerifiedAt are already Unix timestamps (numbers)
      const validationBooking: Booking = {
        id: booking.id,
        status: booking.status,
        start_date: booking.startDate ? createBangkokTimestamp(booking.startDate) : 0,
        end_date: booking.endDate ? createBangkokTimestamp(booking.endDate) : null,
        start_time: booking.startTime || null,
        end_time: booking.endTime || null,
        proposed_date: booking.proposedDate ? createBangkokTimestamp(booking.proposedDate) : null,
        proposed_end_date: booking.proposedEndDate ? createBangkokTimestamp(booking.proposedEndDate) : null,
        response_date: booking.responseDate || null,
        deposit_evidence_url: booking.depositEvidenceUrl || null,
        deposit_verified_at: booking.depositVerifiedAt || null,
      }

      // Run validation
      const validationResult = await validateAction(action, validationBooking, targetStatus)

      await logger.info('Validation completed', {
        bookingId: id,
        action,
        valid: validationResult.valid,
        errors: validationResult.errors.length,
        warnings: validationResult.warnings.length,
      })

      return successResponse(validationResult, { requestId })
    } catch (error) {
      await logger.error('Validation error', error instanceof Error ? error : new Error(String(error)))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to validate action",
        { error: error instanceof Error ? error.message : String(error) },
        500,
        { requestId }
      )
    }
  })
}

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
