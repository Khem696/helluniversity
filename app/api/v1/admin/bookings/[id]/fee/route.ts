import { NextResponse } from "next/server"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import {
  getBookingById,
  updateBookingFee,
  logAdminAction,
} from "@/lib/bookings"
import {
  requireAuthorizedDomain,
  getAuthSession,
} from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { createBangkokTimestamp } from "@/lib/timezone"

/**
 * Admin Booking Fee Management API v1
 * 
 * Versioned endpoint for booking fee management
 * PATCH /api/v1/admin/bookings/[id]/fee - Update booking fee
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

export const PATCH = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin update booking fee request (v1)', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update booking fee rejected: authentication failed', { bookingId: id })
      return authError
    }

    // Parse request body
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 1048576)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }

    const { 
      feeAmountOriginal, 
      feeCurrency, 
      feeConversionRate, 
      feeAmount, 
      feeNotes,
      changeReason 
    } = body

    // Validate required fields
    if (feeAmountOriginal === undefined || feeAmountOriginal === null) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "feeAmountOriginal is required",
        undefined,
        400,
        { requestId }
      )
    }

    if (!feeCurrency || typeof feeCurrency !== 'string') {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "feeCurrency is required and must be a string",
        undefined,
        400,
        { requestId }
      )
    }

    if (typeof feeAmountOriginal !== 'number' || isNaN(feeAmountOriginal)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "feeAmountOriginal must be a number",
        undefined,
        400,
        { requestId }
      )
    }

    if (feeAmount !== undefined && feeAmount !== null && (typeof feeAmount !== 'number' || isNaN(feeAmount))) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "feeAmount must be a number if provided",
        undefined,
        400,
        { requestId }
      )
    }

    if (feeConversionRate !== undefined && feeConversionRate !== null && (typeof feeConversionRate !== 'number' || isNaN(feeConversionRate))) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "feeConversionRate must be a number if provided",
        undefined,
        400,
        { requestId }
      )
    }

    // Get current booking
    const currentBooking = await getBookingById(id)
    if (!currentBooking) {
      return notFoundResponse('Booking', { requestId })
    }

    // Get admin info
    let adminEmail: string | undefined
    let adminName: string | undefined

    try {
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // Update fee
    let updatedBooking
    try {
      updatedBooking = await updateBookingFee(
        id,
        feeAmountOriginal,
        feeCurrency,
        {
          feeConversionRate: feeConversionRate ?? null,
          feeAmount: feeAmount ?? null,
          feeNotes: feeNotes || null,
          changedBy: adminEmail,
          changeReason: changeReason || null,
          isRestorationChange: false,
        }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to update booking fee"
      await logger.error('Failed to update booking fee', error instanceof Error ? error : new Error(errorMessage), { bookingId: id })
      
      if (errorMessage.includes("Fee can only be recorded")) {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          errorMessage,
          undefined,
          400,
          { requestId }
        )
      }
      
      if (errorMessage.includes("modified by another process")) {
        return errorResponse(
          ErrorCodes.CONFLICT,
          errorMessage,
          undefined,
          409,
          { requestId }
        )
      }
      
      throw error
    }

    // Log admin action
    try {
      const isUpdate = currentBooking.feeAmount !== null && currentBooking.feeAmount !== undefined
      const actionType = isUpdate ? "update_booking_fee" : "record_booking_fee"
      const description = isUpdate
        ? `Updated booking fee from ${currentBooking.feeAmount} THB to ${updatedBooking.feeAmount} THB`
        : `Recorded booking fee: ${updatedBooking.feeAmount} THB (${updatedBooking.feeAmountOriginal} ${updatedBooking.feeCurrency})`
      
      await logAdminAction({
        actionType,
        resourceType: "booking",
        resourceId: id,
        adminEmail,
        adminName,
        description,
        metadata: {
          oldFeeAmount: currentBooking.feeAmount,
          oldFeeAmountOriginal: currentBooking.feeAmountOriginal,
          oldFeeCurrency: currentBooking.feeCurrency,
          newFeeAmount: updatedBooking.feeAmount,
          newFeeAmountOriginal: updatedBooking.feeAmountOriginal,
          newFeeCurrency: updatedBooking.feeCurrency,
          newFeeConversionRate: updatedBooking.feeConversionRate,
          changeReason,
        },
      })
    } catch (logError) {
      await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)), { bookingId: id })
    }

    // Send admin notification
    try {
      const { sendAdminFeeChangeNotification } = await import('@/lib/email')
      await sendAdminFeeChangeNotification(
        updatedBooking,
        currentBooking,
        adminEmail || "Admin"
      )
    } catch (emailError) {
      await logger.error("Failed to send admin fee change notification", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
    }

    // Transform booking to snake_case for frontend consistency
    const transformedBooking = {
      id: updatedBooking.id,
      reference_number: updatedBooking.referenceNumber || null,
      name: updatedBooking.name,
      email: updatedBooking.email,
      phone: updatedBooking.phone,
      participants: updatedBooking.participants,
      event_type: updatedBooking.eventType,
      other_event_type: updatedBooking.otherEventType,
      date_range: updatedBooking.dateRange ? 1 : 0,
      start_date: updatedBooking.startDate ? createBangkokTimestamp(updatedBooking.startDate) : 0,
      end_date: updatedBooking.endDate ? createBangkokTimestamp(updatedBooking.endDate) : null,
      start_time: updatedBooking.startTime || "",
      end_time: updatedBooking.endTime || "",
      organization_type: updatedBooking.organizationType,
      organized_person: updatedBooking.organizedPerson,
      introduction: updatedBooking.introduction,
      biography: updatedBooking.biography,
      special_requests: updatedBooking.specialRequests,
      status: updatedBooking.status,
      admin_notes: updatedBooking.adminNotes,
      response_token: updatedBooking.responseToken,
      token_expires_at: updatedBooking.tokenExpiresAt,
      proposed_date: updatedBooking.proposedDate ? createBangkokTimestamp(updatedBooking.proposedDate) : null,
      proposed_end_date: updatedBooking.proposedEndDate ? createBangkokTimestamp(updatedBooking.proposedEndDate) : null,
      user_response: updatedBooking.userResponse,
      response_date: updatedBooking.responseDate,
      deposit_evidence_url: updatedBooking.depositEvidenceUrl,
      deposit_verified_at: updatedBooking.depositVerifiedAt,
      deposit_verified_by: updatedBooking.depositVerifiedBy,
      deposit_verified_from_other_channel: updatedBooking.depositVerifiedFromOtherChannel === true,
      // CRITICAL: Include all fee fields in snake_case
      fee_amount: updatedBooking.feeAmount ?? null,
      fee_amount_original: updatedBooking.feeAmountOriginal ?? null,
      fee_currency: updatedBooking.feeCurrency || null,
      fee_conversion_rate: updatedBooking.feeConversionRate ?? null,
      fee_rate_date: updatedBooking.feeRateDate ?? null,
      fee_recorded_at: updatedBooking.feeRecordedAt ?? null,
      fee_recorded_by: updatedBooking.feeRecordedBy || null,
      fee_notes: updatedBooking.feeNotes || null,
      created_at: updatedBooking.createdAt,
      updated_at: updatedBooking.updatedAt,
    }

    return successResponse(
      {
        booking: transformedBooking,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

