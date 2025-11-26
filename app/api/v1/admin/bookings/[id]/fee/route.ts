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

    // Check if this is a clear operation (feeAmountOriginal is null)
    const isClearingFee = feeAmountOriginal === null || feeAmountOriginal === undefined

    // Validate required fields based on operation type
    if (!isClearingFee) {
      // Recording/updating fee - feeAmountOriginal and feeCurrency are required
      if (typeof feeAmountOriginal !== 'number' || isNaN(feeAmountOriginal)) {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "feeAmountOriginal must be a number when recording or updating a fee",
          undefined,
          400,
          { requestId }
        )
      }

      if (!feeCurrency || typeof feeCurrency !== 'string') {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "feeCurrency is required and must be a string when recording or updating a fee",
          undefined,
          400,
          { requestId }
        )
      }
    } else {
      // Clearing fee - feeAmountOriginal should be null, feeCurrency can be null
      // No additional validation needed for clearing
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

    // FIXED: Early validation - check if clearing a non-existent fee (Bug #42)
    // This avoids unnecessary database operations and admin action logging
    const currentHasFee = currentBooking.feeAmount !== null && currentBooking.feeAmount !== undefined
    if (isClearingFee && !currentHasFee) {
      await logger.info("Fee clear requested but no fee exists - returning early", { bookingId: id })
      // FIXED: Transform to snake_case for frontend consistency (Bug #47)
      // Must match the format returned by the normal success path
      const transformedCurrentBooking = {
        id: currentBooking.id,
        reference_number: currentBooking.referenceNumber || null,
        name: currentBooking.name,
        email: currentBooking.email,
        phone: currentBooking.phone,
        participants: currentBooking.participants,
        event_type: currentBooking.eventType,
        other_event_type: currentBooking.otherEventType,
        date_range: currentBooking.dateRange ? 1 : 0,
        start_date: currentBooking.startDate ? createBangkokTimestamp(currentBooking.startDate) : 0,
        end_date: currentBooking.endDate ? createBangkokTimestamp(currentBooking.endDate) : null,
        start_time: currentBooking.startTime || "",
        end_time: currentBooking.endTime || "",
        organization_type: currentBooking.organizationType,
        organized_person: currentBooking.organizedPerson,
        introduction: currentBooking.introduction,
        biography: currentBooking.biography,
        special_requests: currentBooking.specialRequests,
        status: currentBooking.status,
        admin_notes: currentBooking.adminNotes,
        response_token: currentBooking.responseToken,
        token_expires_at: currentBooking.tokenExpiresAt,
        proposed_date: currentBooking.proposedDate ? createBangkokTimestamp(currentBooking.proposedDate) : null,
        proposed_end_date: currentBooking.proposedEndDate ? createBangkokTimestamp(currentBooking.proposedEndDate) : null,
        user_response: currentBooking.userResponse,
        response_date: currentBooking.responseDate,
        deposit_evidence_url: currentBooking.depositEvidenceUrl,
        deposit_verified_at: currentBooking.depositVerifiedAt,
        deposit_verified_by: currentBooking.depositVerifiedBy,
        deposit_verified_from_other_channel: currentBooking.depositVerifiedFromOtherChannel === true,
        fee_amount: currentBooking.feeAmount ?? null,
        fee_amount_original: currentBooking.feeAmountOriginal ?? null,
        fee_currency: currentBooking.feeCurrency || null,
        fee_conversion_rate: currentBooking.feeConversionRate ?? null,
        fee_rate_date: currentBooking.feeRateDate ?? null,
        fee_recorded_at: currentBooking.feeRecordedAt ?? null,
        fee_recorded_by: currentBooking.feeRecordedBy || null,
        fee_notes: currentBooking.feeNotes || null,
        created_at: currentBooking.createdAt,
        updated_at: currentBooking.updatedAt,
      }
      return successResponse(
        {
          booking: transformedCurrentBooking,
          message: "No fee to clear - booking already has no fee recorded",
        },
        { requestId }
      )
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

    // Update fee (or clear if feeAmountOriginal is null)
    let updatedBooking
    try {
      updatedBooking = await updateBookingFee(
        id,
        feeAmountOriginal ?? null,
        feeCurrency ?? null,
        {
          feeConversionRate: feeConversionRate ?? null,
          feeAmount: feeAmount ?? null,
          feeNotes: feeNotes || null,
          changedBy: adminEmail,
          changeReason: changeReason || (isClearingFee ? "Fee cleared" : null),
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
      const hadFee = currentBooking.feeAmount !== null && currentBooking.feeAmount !== undefined
      const hasFee = updatedBooking.feeAmount !== null && updatedBooking.feeAmount !== undefined
      
      let actionType: string
      let description: string
      
      if (isClearingFee) {
        actionType = "clear_booking_fee"
        description = `Cleared booking fee (was ${currentBooking.feeAmount} THB)`
      } else if (hadFee) {
        actionType = "update_booking_fee"
        description = `Updated booking fee from ${currentBooking.feeAmount} THB to ${updatedBooking.feeAmount} THB`
      } else {
        actionType = "record_booking_fee"
        description = `Recorded booking fee: ${updatedBooking.feeAmount} THB (${updatedBooking.feeAmountOriginal} ${updatedBooking.feeCurrency})`
      }
      
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
          changeReason: changeReason || (isClearingFee ? "Fee cleared" : null),
        },
      })
    } catch (logError) {
      await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)), { bookingId: id })
    }

    // FIXED: Send email notifications for fee changes (Issue #10)
    // Send both admin and user notifications when fees change OR are cleared
    // Send admin notification
    try {
      const { sendAdminFeeChangeNotification } = await import('@/lib/email')
      await sendAdminFeeChangeNotification(
        updatedBooking,
        currentBooking,
        adminEmail || "Admin"
      )
      await logger.info("Admin fee change notification sent", { bookingId: id, isClearingFee })
    } catch (emailError) {
      await logger.error("Failed to send admin fee change notification", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
    }
    
    // FIXED: Send user notification for fee changes (including fee clearance)
    // Users should be notified when their booking fee changes or is cleared
    try {
      const { sendBookingStatusNotification } = await import('@/lib/email')
      
      // Build fee change message
      let feeChangeMessage = ""
      const hadFee = currentBooking.feeAmount !== null && currentBooking.feeAmount !== undefined
      
      // FIXED: Validate fee fields before using in message to prevent "undefined" strings (Bug #1)
      const prevFeeAmount = currentBooking.feeAmount ?? 'N/A'
      const prevFeeOriginal = currentBooking.feeAmountOriginal
      const prevFeeCurrency = currentBooking.feeCurrency ?? 'THB'
      const newFeeAmount = updatedBooking.feeAmount ?? 'N/A'
      const newFeeOriginal = updatedBooking.feeAmountOriginal
      const newFeeCurrency = updatedBooking.feeCurrency ?? 'THB'
      
      // FIXED: Use explicit null/undefined checks instead of truthiness (Bug #23)
      // Since 0 is a valid fee amount, truthiness checks would incorrectly skip
      // displaying conversion details when feeAmountOriginal is 0
      const hasPrevOriginal = prevFeeOriginal != null
      const hasNewOriginal = newFeeOriginal != null
      
      if (isClearingFee) {
        // Fee was cleared - we know hadFee is true due to early validation (Bug #42)
        feeChangeMessage = `The fee for your booking has been cleared.\n\n` +
          `Previous Fee: ${prevFeeAmount} THB` +
          (hasPrevOriginal ? ` (${prevFeeOriginal} ${prevFeeCurrency})` : '') +
          `\nNew Fee: None`
      } else if (hadFee) {
        // Fee was updated
        feeChangeMessage = `Your booking fee has been updated.\n\n` +
          `Previous Fee: ${prevFeeAmount} THB` +
          (hasPrevOriginal ? ` (${prevFeeOriginal} ${prevFeeCurrency})` : '') +
          `\nNew Fee: ${newFeeAmount} THB` +
          (hasNewOriginal ? ` (${newFeeOriginal} ${newFeeCurrency})` : '')
      } else {
        // Fee was recorded for the first time
        feeChangeMessage = `A fee has been recorded for your booking.\n\n` +
          `Fee Amount: ${newFeeAmount} THB` +
          (hasNewOriginal ? ` (${newFeeOriginal} ${newFeeCurrency})` : '')
      }
      
      // Send notification - feeChangeMessage is always set at this point
      // (early validation ensures we don't reach here when clearing a non-existent fee)
      if (feeChangeMessage) {
        if (changeReason) {
          feeChangeMessage += `\n\nReason: ${changeReason}`
        }
        
        if (!isClearingFee && updatedBooking.feeNotes) {
          feeChangeMessage += `\n\nNotes: ${updatedBooking.feeNotes}`
        }
        
        // Send notification using status change email (maintains booking status)
        await sendBookingStatusNotification(
          updatedBooking,
          updatedBooking.status, // Keep current status
          {
            changeReason: feeChangeMessage,
            allowIntentionalDuplicate: true, // FIXED: Allow intentional duplicates for admin-initiated fee changes (Issue #17)
          }
        )
        await logger.info("User fee change notification sent", { bookingId: id, isClearingFee })
      }
    } catch (emailError) {
      await logger.error("Failed to send user fee change notification", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
      // Don't fail the request if email fails
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

