import { NextResponse } from "next/server"
import { getRequestPath } from "@/lib/api-versioning"
import { getTursoClient } from "@/lib/turso"
import {
  getBookingById,
  updateBookingStatus,
  getBookingStatusHistory,
  logAdminAction,
} from "@/lib/bookings"
import { sendBookingStatusNotification, sendAdminBookingDeletionNotification, sendAdminStatusChangeNotification } from "@/lib/email"
import {
  requireAuthorizedDomain,
  getAuthSession,
} from "@/lib/auth"
import { deleteImage } from "@/lib/blob"
import { enqueueJob } from "@/lib/job-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { createBangkokTimestamp } from "@/lib/timezone"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Booking Management API
 * 
 * GET /api/admin/bookings/[id] - Get booking details
 * PATCH /api/admin/bookings/[id] - Update booking status
 * DELETE /api/admin/bookings/[id] - Delete booking
 * - All routes require Google Workspace authentication
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
    
    await logger.info('Admin get booking request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get booking request rejected: authentication failed', { bookingId: id })
      return authError
    }

    // Use getBookingById which includes caching
    // Cache will be invalidated automatically when booking is updated
    const booking = await getBookingById(id)
    
    if (!booking) {
      await logger.warn('Admin get booking failed: booking not found', { bookingId: id })
      return notFoundResponse('Booking', { requestId })
    }
    
    // Debug: Log booking data (including fee fields)
    if (process.env.NODE_ENV === 'development') {
      console.log('[API v1 GET /bookings/[id]] Booking from cache/DB:', {
        bookingId: id,
        feeAmount: booking.feeAmount,
        feeCurrency: booking.feeCurrency,
        feeAmountOriginal: booking.feeAmountOriginal,
        hasFee: !!(booking.feeAmount && Number(booking.feeAmount) > 0),
        feeKeys: Object.keys(booking).filter(k => k.toLowerCase().includes('fee')),
      })
    }

    await logger.info('Booking retrieved', { bookingId: id, status: booking.status })

    // Get status history
    const statusHistory = await getBookingStatusHistory(id)
    
    await logger.debug('Booking status history retrieved', { 
      bookingId: id, 
      historyCount: statusHistory.length 
    })

    // Find all overlapping bookings for warning display
    const { findAllOverlappingBookings } = await import('@/lib/booking-validations')
    const startDate = booking.startDate ? createBangkokTimestamp(booking.startDate) : 0
    const endDate = booking.endDate ? createBangkokTimestamp(booking.endDate) : null
    const overlappingBookings = await findAllOverlappingBookings(
      id,
      startDate,
      endDate,
      booking.startTime || null,
      booking.endTime || null
    )
    
    // Check if any overlapping booking is confirmed (blocks status changes)
    const hasConfirmedOverlap = overlappingBookings.some(b => b.status === 'confirmed')
    
    await logger.debug('Overlap check completed', {
      bookingId: id,
      overlapCount: overlappingBookings.length,
      hasConfirmedOverlap,
    })

    // Transform booking to match frontend interface (convert date strings to Unix timestamps)
    // CRITICAL: Use createBangkokTimestamp to handle YYYY-MM-DD strings in Bangkok timezone
    const transformedBooking = {
      id: booking.id,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      participants: booking.participants,
      event_type: booking.eventType,
      other_event_type: booking.otherEventType,
      date_range: booking.dateRange ? 1 : 0,
      start_date: booking.startDate ? createBangkokTimestamp(booking.startDate) : 0,
      end_date: booking.endDate ? createBangkokTimestamp(booking.endDate) : null,
      start_time: booking.startTime || "",
      end_time: booking.endTime || "",
      organization_type: booking.organizationType,
      organized_person: booking.organizedPerson,
      introduction: booking.introduction,
      biography: booking.biography,
      special_requests: booking.specialRequests,
      status: booking.status,
      admin_notes: booking.adminNotes,
      response_token: booking.responseToken,
      token_expires_at: booking.tokenExpiresAt,
      proposed_date: booking.proposedDate ? createBangkokTimestamp(booking.proposedDate) : null,
      proposed_end_date: booking.proposedEndDate ? createBangkokTimestamp(booking.proposedEndDate) : null,
      user_response: booking.userResponse,
      response_date: booking.responseDate,
      deposit_evidence_url: booking.depositEvidenceUrl,
      deposit_verified_at: booking.depositVerifiedAt,
      deposit_verified_by: booking.depositVerifiedBy,
      // Preserve boolean value correctly - use explicit check to avoid undefined -> false conversion
      deposit_verified_from_other_channel: booking.depositVerifiedFromOtherChannel === true,
      // CRITICAL: Explicitly include all fee fields
      fee_amount: (booking as any).feeAmount != null ? (booking as any).feeAmount : null,
      fee_amount_original: (booking as any).feeAmountOriginal != null ? (booking as any).feeAmountOriginal : null,
      fee_currency: (booking as any).feeCurrency || null,
      fee_conversion_rate: (booking as any).feeConversionRate != null ? (booking as any).feeConversionRate : null,
      fee_rate_date: (booking as any).feeRateDate != null ? (booking as any).feeRateDate : null,
      fee_recorded_at: (booking as any).feeRecordedAt != null ? (booking as any).feeRecordedAt : null,
      fee_recorded_by: (booking as any).feeRecordedBy || null,
      fee_notes: (booking as any).feeNotes || null,
      created_at: booking.createdAt,
      updated_at: booking.updatedAt,
    }
    
    // Debug: Log transformed booking fee data
    console.log('[API v1 GET /bookings/[id]] Transformed booking fee data:', {
      bookingId: id,
      fee_amount: transformedBooking.fee_amount,
      fee_currency: transformedBooking.fee_currency,
      fee_amount_original: transformedBooking.fee_amount_original,
      hasFee: !!(transformedBooking.fee_amount && Number(transformedBooking.fee_amount) > 0),
      allFeeKeys: Object.keys(transformedBooking).filter(k => k.toLowerCase().includes('fee')),
    })
    
    // CRITICAL: Ensure fee fields are always present in the response (even if null)
    // This prevents them from being omitted during JSON serialization
    const finalBooking = {
      ...transformedBooking,
      fee_amount: transformedBooking.fee_amount ?? null,
      fee_amount_original: transformedBooking.fee_amount_original ?? null,
      fee_currency: transformedBooking.fee_currency ?? null,
      fee_conversion_rate: transformedBooking.fee_conversion_rate ?? null,
      fee_rate_date: transformedBooking.fee_rate_date ?? null,
      fee_recorded_at: transformedBooking.fee_recorded_at ?? null,
      fee_recorded_by: transformedBooking.fee_recorded_by ?? null,
      fee_notes: transformedBooking.fee_notes ?? null,
    }
    
    console.log('[API v1 GET /bookings/[id]] Final booking with explicit fee fields:', {
      bookingId: id,
      fee_amount: finalBooking.fee_amount,
      fee_currency: finalBooking.fee_currency,
      allKeys: Object.keys(finalBooking),
      feeKeys: Object.keys(finalBooking).filter(k => k.toLowerCase().includes('fee')),
    })

    // Transform status history to match frontend interface (snake_case)
    const transformedStatusHistory = statusHistory.map(h => ({
      id: h.id,
      booking_id: h.bookingId,
      old_status: h.oldStatus,
      new_status: h.newStatus,
      changed_by: h.changedBy || null,
      change_reason: h.changeReason || null,
      created_at: h.createdAt,
    }))

    return successResponse(
      {
        booking: finalBooking,
        statusHistory: transformedStatusHistory,
        overlappingBookings: overlappingBookings.map(b => ({
          id: b.id,
          name: b.name,
          email: b.email,
          reference_number: b.reference_number,
          start_date: b.start_date,
          end_date: b.end_date,
          start_time: b.start_time,
          end_time: b.end_time,
          status: b.status,
          created_at: b.created_at,
        })),
        hasConfirmedOverlap,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

export const PATCH = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin update booking request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update booking rejected: authentication failed', { bookingId: id })
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 1048576) // 1MB limit for booking update data
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
    
    const { status, changeReason, adminNotes, proposedDate, depositVerifiedBy, newStartDate, newEndDate, newStartTime, newEndTime, action } = body
    
    await logger.debug('Booking update data', {
      bookingId: id,
      status,
      hasChangeReason: !!changeReason,
      hasAdminNotes: !!adminNotes,
      hasProposedDate: !!proposedDate,
      hasDepositVerifiedBy: !!depositVerifiedBy,
      hasNewStartDate: !!newStartDate,
      hasNewEndDate: !!newEndDate,
      hasNewStartTime: !!newStartTime,
      hasNewEndTime: !!newEndTime,
      depositVerifiedBy: depositVerifiedBy || '(not provided)'
    })

    // Validate status
    const validStatuses = ["pending", "pending_deposit", "paid_deposit", "confirmed", "cancelled", "finished"]
    if (!status || !validStatuses.includes(status)) {
      await logger.warn('Admin update booking rejected: invalid status', { bookingId: id, status, validStatuses })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        undefined,
        400,
        { requestId }
      )
    }

    // Get current booking to check if it exists
    const currentBooking = await getBookingById(id)
    if (!currentBooking) {
      await logger.warn('Admin update booking failed: booking not found', { bookingId: id })
      return notFoundResponse('Booking', { requestId })
    }

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined

    try {
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      // Session might not be available, continue without admin info
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // Handle date change for confirmed bookings or when restoring (before status update)
    // CRITICAL: If both date changes AND status changes are provided (restoration with date change),
    // we need to handle them together, not separately
    const hasDateChanges = newStartDate || newEndDate || newStartTime !== undefined || newEndTime !== undefined
    const hasStatusChange = status && status !== currentBooking.status
    const isRestorationWithDateChange = hasDateChanges && hasStatusChange && currentBooking.status === "cancelled"
    
    if (hasDateChanges && !isRestorationWithDateChange) {
      // Date changes are allowed for:
      // 1. Confirmed bookings (date change only, no status change)
      // 2. Restoring from cancelled to confirmed (handled separately below)
      // 3. Changing status TO confirmed in the same request (e.g., pending_deposit -> confirmed with date change)
      const isRestoringToConfirmed = status && 
        status !== currentBooking.status && 
        status === "confirmed" && 
        (currentBooking.status === "cancelled" || currentBooking.status === "finished")
      
      // CRITICAL: Allow date change if status is being changed TO "confirmed" in the same request
      // This handles cases like: pending_deposit -> confirmed with date change
      const isChangingToConfirmed = status && 
        status !== currentBooking.status && 
        status === "confirmed"
      
      if (currentBooking.status !== "confirmed" && !isRestoringToConfirmed && !isChangingToConfirmed) {
        await logger.warn('Date change rejected: booking not confirmed and not changing to confirmed', { 
          bookingId: id, 
          currentStatus: currentBooking.status,
          targetStatus: status 
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Date changes are only allowed for confirmed bookings or when changing status to confirmed.",
          undefined,
          400,
          { requestId }
        )
      }

      // Validate new dates
      const { checkBookingOverlap } = await import('@/lib/booking-validations')
      const { getBangkokTime } = await import('@/lib/timezone')
      
      // Use new dates if provided, otherwise use current dates
      const checkStartDate = newStartDate 
        ? (typeof newStartDate === 'string' ? createBangkokTimestamp(newStartDate) : newStartDate)
        : (typeof currentBooking.startDate === 'number' ? currentBooking.startDate : createBangkokTimestamp(String(currentBooking.startDate)))
      const checkEndDate = newEndDate
        ? (typeof newEndDate === 'string' ? createBangkokTimestamp(newEndDate) : newEndDate)
        : (currentBooking.endDate ? (typeof currentBooking.endDate === 'number' ? currentBooking.endDate : createBangkokTimestamp(String(currentBooking.endDate))) : null)
      const checkStartTime = newStartTime !== undefined ? newStartTime : (currentBooking.startTime || null)
      const checkEndTime = newEndTime !== undefined ? newEndTime : (currentBooking.endTime || null)

      // Validate date range consistency: end_date must be >= start_date
      if (checkEndDate && checkEndDate < checkStartDate) {
        await logger.warn('Date change rejected: end date is before start date', {
          bookingId: id,
          checkStartDate,
          checkEndDate
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "End date must be after or equal to start date.",
          undefined,
          400,
          { requestId }
        )
      }

      // CRITICAL: If end_date equals start_date, treat as single-day booking
      // This prevents invalid multi-day bookings where dates are the same
      const isEffectivelySingleDay = !checkEndDate || checkEndDate === checkStartDate

      // Parse time strings helper (HH:MM format)
      const parseTime = (timeStr: string): { hour24: number; minutes: number } | null => {
        if (!timeStr) return null
        const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
        if (match) {
          const hour24 = parseInt(match[1], 10)
          const minutes = parseInt(match[2] || '00', 10)
          if (hour24 >= 0 && hour24 <= 23 && minutes >= 0 && minutes <= 59) {
            return { hour24, minutes }
          }
        }
        return null
      }

      // Validate time range for single-day bookings (including when end_date equals start_date)
      if (isEffectivelySingleDay && checkStartTime && checkEndTime) {
        const startParsed = parseTime(checkStartTime)
        const endParsed = parseTime(checkEndTime)
        
        if (startParsed && endParsed) {
          const startTotal = startParsed.hour24 * 60 + startParsed.minutes
          const endTotal = endParsed.hour24 * 60 + endParsed.minutes
          
          if (endTotal <= startTotal) {
            await logger.warn('Date change rejected: end time is not after start time for single-day booking', {
              bookingId: id,
              checkStartTime,
              checkEndTime,
              checkStartDate,
              checkEndDate
            })
            return errorResponse(
              ErrorCodes.VALIDATION_ERROR,
              "For single-day bookings, end time must be after start time.",
              undefined,
              400,
              { requestId }
            )
          }
        }
      }

      // CRITICAL: Validate that end timestamp is > start timestamp (accounts for dates + times)
      // This catches edge cases like: same date but invalid times, or dates valid but times make it invalid
      const { calculateStartTimestamp: calcStartTimestamp } = await import('@/lib/booking-validations')
      const startTimestamp = calcStartTimestamp(checkStartDate, checkStartTime)
      
      let endTimestamp: number
      if (checkEndDate) {
        // Multi-day booking: calculate end timestamp from end_date + end_time
        if (checkEndTime) {
          const endParsed = parseTime(checkEndTime)
          if (endParsed) {
            try {
              const { TZDate } = await import('@date-fns/tz')
              const BANGKOK_TIMEZONE = 'Asia/Bangkok'
              const utcDate = new Date(checkEndDate * 1000)
              const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
              const year = tzDate.getFullYear()
              const month = tzDate.getMonth()
              const day = tzDate.getDate()
              const tzDateWithTime = new TZDate(year, month, day, endParsed.hour24, endParsed.minutes, 0, BANGKOK_TIMEZONE)
              endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
            } catch (error) {
              endTimestamp = checkEndDate
            }
          } else {
            endTimestamp = checkEndDate
          }
        } else {
          // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
          // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
          try {
            const { TZDate } = await import('@date-fns/tz')
            const BANGKOK_TIMEZONE = 'Asia/Bangkok'
            const utcDate = new Date(checkEndDate * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            // Set to end of day (23:59:59)
            const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
          } catch (error) {
            endTimestamp = checkEndDate
          }
        }
      } else {
        // Single-day booking: calculate end timestamp from start_date + end_time
        if (checkEndTime) {
          const endParsed = parseTime(checkEndTime)
          if (endParsed) {
            try {
              const { TZDate } = await import('@date-fns/tz')
              const BANGKOK_TIMEZONE = 'Asia/Bangkok'
              const utcDate = new Date(checkStartDate * 1000)
              const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
              const year = tzDate.getFullYear()
              const month = tzDate.getMonth()
              const day = tzDate.getDate()
              const tzDateWithTime = new TZDate(year, month, day, endParsed.hour24, endParsed.minutes, 0, BANGKOK_TIMEZONE)
              endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
            } catch (error) {
              endTimestamp = startTimestamp
            }
          } else {
            endTimestamp = startTimestamp
          }
        } else {
          endTimestamp = startTimestamp
        }
      }

      // Final validation: end timestamp must be > start timestamp
      if (endTimestamp <= startTimestamp) {
        await logger.warn('Date change rejected: end timestamp is not after start timestamp', {
          bookingId: id,
          startTimestamp,
          endTimestamp,
          checkStartDate,
          checkEndDate,
          checkStartTime,
          checkEndTime
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "The booking end date and time must be after the start date and time.",
          undefined,
          400,
          { requestId }
        )
      }

      // Check for overlaps with other confirmed bookings
      const overlapCheck = await checkBookingOverlap(
        id, // Exclude current booking
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime
      )

      if (overlapCheck.overlaps) {
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Date change rejected: overlap detected', {
          bookingId: id,
          overlappingNames
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `Cannot change date: the new date and time overlaps with an existing confirmed booking (${overlappingNames}). Please choose a different date.`,
          { overlappingBookings: overlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }

      // Check if new dates are in the past (warning only, not blocking)
      const bangkokNow = getBangkokTime()
      const { calculateStartTimestamp } = await import('@/lib/booking-validations')
      const newStartTimestamp = calculateStartTimestamp(checkStartDate, checkStartTime)
      
      if (newStartTimestamp < bangkokNow) {
        await logger.info('Date change warning: new start date is in the past', {
          bookingId: id,
          newStartTimestamp,
          bangkokNow
        })
        // Note: We allow past dates for historical corrections, but log it
      }

      // FINAL VALIDATION: Re-check everything right before updating to prevent race conditions
      // 1. Re-check booking status (might have changed)
      const recheckBooking = await getBookingById(id)
      if (!recheckBooking) {
        await logger.warn('Date change rejected: booking not found during re-check', { bookingId: id })
        return notFoundResponse('Booking', { requestId })
      }
      
      if (recheckBooking.status !== "confirmed") {
        await logger.warn('Date change rejected: booking status changed during update', {
          bookingId: id,
          originalStatus: currentBooking.status,
          currentStatus: recheckBooking.status
        })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          `Booking status has changed from "confirmed" to "${recheckBooking.status}". Date changes are only allowed for confirmed bookings. Please refresh and try again.`,
          undefined,
          409,
          { requestId }
        )
      }

      // 2. Re-check overlaps (catch any bookings that became confirmed)
      await logger.info('Performing final overlap check before updating booking dates')
      const finalOverlapCheck = await checkBookingOverlap(
        id, // Exclude current booking
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime
      )

      if (finalOverlapCheck.overlaps) {
        const overlappingNames = finalOverlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Final overlap check detected conflict - date became unavailable', {
          bookingId: id,
          overlappingNames
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `The selected date and time is no longer available. It overlaps with a recently confirmed booking (${overlappingNames}). Please refresh and choose a different date.`,
          { overlappingBookings: finalOverlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }

      // Update booking dates in a transaction with optimistic locking
      const { dbTransaction } = await import("@/lib/turso")
      const now = Math.floor(Date.now() / 1000)
      
      // CRITICAL: Use updated_at from recheckBooking (latest value) for optimistic locking
      // This ensures we catch any modifications that happened during validation
      // Using currentBooking.updatedAt would be stale if booking was modified between initial fetch and re-check
      const originalUpdatedAt = recheckBooking.updatedAt
      
      try {
        const updateResult = await dbTransaction(async (tx) => {
          const updateFields: string[] = ["updated_at = ?"]
          const updateArgs: any[] = [now]
          
          if (newStartDate) {
            const startDateValue = typeof newStartDate === 'string' ? createBangkokTimestamp(newStartDate) : newStartDate
            updateFields.push("start_date = ?")
            updateArgs.push(startDateValue)
          }
          
          if (newEndDate !== undefined) {
            if (newEndDate === null) {
              updateFields.push("end_date = NULL")
              updateFields.push("date_range = 0")
            } else {
              const endDateValue = typeof newEndDate === 'string' ? createBangkokTimestamp(newEndDate) : newEndDate
              updateFields.push("end_date = ?")
              updateArgs.push(endDateValue)
              updateFields.push("date_range = 1")
            }
          } else if (newStartDate) {
            // If only start_date is updated, ensure date_range flag is consistent with end_date
            // If end_date exists, set date_range = 1; if null, set date_range = 0
            if (currentBooking.endDate) {
              updateFields.push("date_range = 1")
            } else {
              updateFields.push("date_range = 0")
            }
          }
          
          if (newStartTime !== undefined) {
            updateFields.push("start_time = ?")
            updateArgs.push(newStartTime || null)
          }
          
          if (newEndTime !== undefined) {
            updateFields.push("end_time = ?")
            updateArgs.push(newEndTime || null)
          }

          // UPDATE TOKEN EXPIRATION if booking date changes and booking has a token
          // Token expiration should match booking start date/time
          // Only update if booking status allows tokens (pending/pending_deposit)
          if (recheckBooking.responseToken && 
              (recheckBooking.status === "pending" || recheckBooking.status === "pending_deposit") &&
              (newStartDate || newStartTime !== undefined)) {
            // Recalculate start timestamp with new date/time
            const effectiveStartDate = newStartDate 
              ? (typeof newStartDate === 'string' ? createBangkokTimestamp(newStartDate) : newStartDate)
              : recheckBooking.startDate
            const effectiveStartTime = newStartTime !== undefined 
              ? newStartTime 
              : recheckBooking.startTime
            
            const { calculateStartTimestamp } = await import("@/lib/booking-validations")
            const newTokenExpiration = calculateStartTimestamp(
              effectiveStartDate,
              effectiveStartTime || null
            )
            
            updateFields.push("token_expires_at = ?")
            updateArgs.push(newTokenExpiration)
            
            await logger.info('Updating token expiration to match new booking date', {
              bookingId: id,
              newTokenExpiration,
              effectiveStartDate,
              effectiveStartTime
            })
          }

          // IMPROVED: Validate field names before building SQL to prevent injection
          const { validateFieldNames, ALLOWED_BOOKING_FIELDS } = await import('@/lib/sql-field-validation')
          const fieldValidation = validateFieldNames(updateFields, ALLOWED_BOOKING_FIELDS)
          
          if (!fieldValidation.valid) {
            throw new Error(
              `Invalid field names in update: ${fieldValidation.errors?.join(', ')}`
            )
          }
          
          // Execute UPDATE with optimistic locking (check updated_at) within transaction
          const result = await tx.execute({
            sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
            args: [...updateArgs, id, originalUpdatedAt],
          })

          return result
        })

        // Check if update succeeded (optimistic locking)
        if (updateResult.rowsAffected === 0) {
          await logger.warn('Date change rejected: booking was modified by another process', {
            bookingId: id,
            originalUpdatedAt
          })
          // Track monitoring metric
          try {
            const { trackOptimisticLockConflict } = await import('@/lib/monitoring')
            trackOptimisticLockConflict('booking', id, { requestId, action: 'date_change' })
          } catch {
            // Ignore monitoring errors
          }
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            "Booking was modified by another process. Please refresh the page and try again.",
            undefined,
            409,
            { requestId }
          )
        }
      } catch (txError) {
        await logger.error('Date change transaction failed', txError instanceof Error ? txError : new Error(String(txError)), {
          bookingId: id,
          originalUpdatedAt
        })
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to update booking dates. The transaction was rolled back. Please try again.",
          undefined,
          500,
          { requestId }
        )
      }

      await logger.info('Booking dates updated successfully', {
        bookingId: id,
        newStartDate: checkStartDate,
        newEndDate: checkEndDate,
        newStartTime: checkStartTime,
        newEndTime: checkEndTime
      })

      // Invalidate cache to ensure fresh data
      try {
        const { invalidateCache, CacheKeys } = await import("@/lib/cache")
        await invalidateCache(CacheKeys.booking(id))
        await invalidateCache('bookings:list')
      } catch (cacheError) {
        await logger.warn("Failed to invalidate cache after date change", { 
          bookingId: id,
          error: cacheError instanceof Error ? cacheError.message : String(cacheError)
        })
      }

      // Log admin action
      try {
        await logAdminAction({
          actionType: "change_booking_date",
          resourceType: "booking",
          resourceId: id,
          adminEmail,
          adminName,
          description: `Changed booking dates`,
          metadata: {
            oldStartDate: currentBooking.startDate,
            oldEndDate: currentBooking.endDate,
            oldStartTime: currentBooking.startTime,
            oldEndTime: currentBooking.endTime,
            newStartDate: checkStartDate,
            newEndDate: checkEndDate,
            newStartTime: checkStartTime,
            newEndTime: checkEndTime,
            changeReason,
          },
        })
      } catch (logError) {
        await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)), { bookingId: id })
      }

      // Get updated booking
      const updatedBooking = await getBookingById(id)
      if (!updatedBooking) {
        await logger.error('Failed to retrieve updated booking after date change', new Error('Booking not found after date change'), { bookingId: id })
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to retrieve updated booking",
          undefined,
          500,
          { requestId }
        )
      }

      // Transform and return
      const transformedBooking = {
        id: updatedBooking.id,
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
        // Preserve boolean value correctly - use explicit check to avoid undefined -> false conversion
        deposit_verified_from_other_channel: updatedBooking.depositVerifiedFromOtherChannel === true,
        // CRITICAL: Include all fee fields
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

      await logger.info('Booking dates updated successfully', { bookingId: id })

      // Send email notification to user about date change
      try {
        // Format old and new dates for email notification
        // Booking dates are stored as strings (YYYY-MM-DD) in Booking interface
        const formatDateTime = (date: string | number | null, time: string | null | undefined): string => {
          if (!date) return "Not specified"
          
          // Convert to Date object (handle both string and number)
          let dateObj: Date
          if (typeof date === 'string') {
            // String format: YYYY-MM-DD
            const [year, month, day] = date.split('-').map(Number)
            dateObj = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
          } else {
            // Number format: Unix timestamp
            dateObj = new Date(date * 1000)
          }
          
          const formattedDate = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Asia/Bangkok'
          })
          if (time) {
            return `${formattedDate} at ${time}`
          }
          return formattedDate
        }
        
        const oldStart = formatDateTime(currentBooking.startDate, currentBooking.startTime)
        const oldEnd = currentBooking.endDate 
          ? formatDateTime(currentBooking.endDate, currentBooking.endTime)
          : null
        const newStart = formatDateTime(updatedBooking.startDate, updatedBooking.startTime)
        const newEnd = updatedBooking.endDate 
          ? formatDateTime(updatedBooking.endDate, updatedBooking.endTime)
          : null
        
        const oldDateRange = oldEnd && oldEnd !== oldStart 
          ? `${oldStart} to ${oldEnd}`
          : oldStart
        const newDateRange = newEnd && newEnd !== newStart
          ? `${newStart} to ${newEnd}`
          : newStart
        
        const dateChangeReason = changeReason 
          ? `${changeReason}\n\nPrevious Date & Time: ${oldDateRange}\nNew Date & Time: ${newDateRange}`
          : `Your booking dates have been updated.\n\nPrevious Date & Time: ${oldDateRange}\nNew Date & Time: ${newDateRange}`
        
        await sendBookingStatusNotification(updatedBooking, updatedBooking.status, {
          changeReason: dateChangeReason,
        })
        await logger.info('Date change notification email sent successfully', { bookingId: id })
      } catch (emailError) {
        await logger.error("Failed to send date change notification email", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
        // Don't fail the request - email is secondary
      }
      
      // CRITICAL: If this is a restoration with date change, don't return early
      // Continue to status update logic below to update both dates and status together
      if (!isRestorationWithDateChange) {
        return successResponse(
          {
            booking: transformedBooking,
          },
          { requestId }
        )
      }
      // Otherwise, continue to status update logic (dates already updated, now update status)
      // But we need to update status with the new dates, so we'll handle it in updateBookingStatus
    }

    // Delete deposit evidence blob when restoring to pending_deposit (user needs to re-upload)
    // This happens in two cases:
    // 1. Rejecting deposit (pending_deposit -> pending_deposit)
    // 2. Restoring from cancelled to pending_deposit (archive restoration)
    // NOTE: Finished bookings cannot be restored (they are immutable)
    const isRestoringToPendingDeposit = status === "pending_deposit" && 
      (currentBooking.status === "pending_deposit" || 
       currentBooking.status === "cancelled") &&
      currentBooking.depositEvidenceUrl
    
    if (isRestoringToPendingDeposit && currentBooking.depositEvidenceUrl) {
      try {
        await deleteImage(currentBooking.depositEvidenceUrl)
        await logger.info(`Deleted deposit evidence blob for restoration/rejection`, { 
          blobUrl: currentBooking.depositEvidenceUrl,
          fromStatus: currentBooking.status,
          toStatus: status
        })
      } catch (blobError) {
        await logger.error("Failed to delete deposit evidence blob", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: currentBooking.depositEvidenceUrl })
        
        // Queue cleanup job for retry (fail-safe approach - continue with status update)
        // This allows user to re-upload deposit even if blob deletion fails
        // Background cleanup job can retry failed deletions later
        try {
          await enqueueJob('cleanup-orphaned-blob', {
            blobUrl: currentBooking.depositEvidenceUrl,
          }, {
            priority: 5, // Medium priority
            maxRetries: 3,
          })
          
          await logAdminAction({
            actionType: "orphaned_blob_cleanup_queued",
            resourceType: "booking",
            resourceId: id,
            adminEmail,
            adminName,
            description: `Queued orphaned blob cleanup: ${currentBooking.depositEvidenceUrl}`,
            metadata: {
              blobUrl: currentBooking.depositEvidenceUrl,
              error: blobError instanceof Error ? blobError.message : String(blobError),
              bookingStatus: status,
              previousStatus: currentBooking.status,
              action: currentBooking.status === "pending_deposit" ? "deposit_rejection" : "archive_restoration",
            },
          })
          await logger.info(`Queued orphaned blob cleanup job`, { blobUrl: currentBooking.depositEvidenceUrl })
        } catch (queueError) {
          // Don't fail if queueing fails - this is secondary
          await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: currentBooking.depositEvidenceUrl })
          
          // Fallback: log for manual cleanup
          try {
            await logAdminAction({
              actionType: "orphaned_blob_cleanup_failed",
              resourceType: "booking",
              resourceId: id,
              adminEmail,
              adminName,
              description: `Failed to delete and queue cleanup for deposit evidence blob: ${currentBooking.depositEvidenceUrl}`,
              metadata: {
                blobUrl: currentBooking.depositEvidenceUrl,
                error: blobError instanceof Error ? blobError.message : String(blobError),
                queueError: queueError instanceof Error ? queueError.message : String(queueError),
                bookingStatus: status,
                previousStatus: currentBooking.status,
                action: currentBooking.status === "pending_deposit" ? "deposit_rejection" : "archive_restoration",
              },
            })
          } catch (logError) {
            // Don't fail if logging fails - this is tertiary
            await logger.error("Failed to log orphaned blob cleanup failure", logError instanceof Error ? logError : new Error(String(logError)))
          }
        }
        
        // Continue with status update (user can re-upload)
        // URL will be cleared in updateBookingStatus()
      }
    }

    // Set depositVerifiedBy when explicitly verifying deposit (status is confirmed or paid_deposit)
    // Check if depositVerifiedBy is provided (not undefined, not null, and not empty string)
    const shouldVerifyDeposit = (status === "confirmed" || status === "paid_deposit") && 
      depositVerifiedBy !== undefined && 
      depositVerifiedBy !== null && 
      typeof depositVerifiedBy === 'string' && 
      depositVerifiedBy.trim() !== ""
    
    await logger.debug('Deposit verification check', {
      bookingId: id,
      status,
      depositVerifiedBy: depositVerifiedBy || '(not provided)',
      depositVerifiedByType: typeof depositVerifiedBy,
      shouldVerifyDeposit,
      adminEmail: adminEmail || '(not available)'
    })

    // ENHANCED OVERLAP CHECK: Check for overlaps before updating to confirmed
    // This prevents admin from creating overlapping confirmed bookings
    if (status === "confirmed") {
      const { checkBookingOverlap } = await import('@/lib/booking-validations')
      
      // CRITICAL: Use NEW dates if provided (for restoration with date change), otherwise use current dates
      // This ensures overlap check uses the dates that will actually be set, not the old dates
      const checkStartDate = newStartDate
        ? (typeof newStartDate === 'string' ? createBangkokTimestamp(newStartDate) : newStartDate)
        : (typeof currentBooking.startDate === 'number'
            ? currentBooking.startDate
            : createBangkokTimestamp(String(currentBooking.startDate)))
      const checkEndDate = newEndDate !== undefined
        ? (newEndDate === null 
            ? null 
            : (typeof newEndDate === 'string' ? createBangkokTimestamp(newEndDate) : newEndDate))
        : (currentBooking.endDate
            ? (typeof currentBooking.endDate === 'number'
                ? currentBooking.endDate
                : createBangkokTimestamp(String(currentBooking.endDate)))
            : null)
      const checkStartTime = newStartTime !== undefined ? (newStartTime || null) : (currentBooking.startTime || null)
      const checkEndTime = newEndTime !== undefined ? (newEndTime || null) : (currentBooking.endTime || null)
      
      await logger.info('Checking overlap before admin status update', {
        bookingId: id,
        status,
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime,
        hasNewDates: !!(newStartDate || newEndDate || newStartTime !== undefined || newEndTime !== undefined),
        isRestorationWithDateChange,
        currentStartDate: currentBooking.startDate,
        currentEndDate: currentBooking.endDate,
      })
      
      const overlapCheck = await checkBookingOverlap(
        id, // Exclude current booking from overlap check
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime
      )
      
      if (overlapCheck.overlaps) {
        // Format overlapping bookings with reference numbers and dates for detailed error message
        const { dateToBangkokDateString } = await import("@/lib/timezone-client")
        const formatOverlappingBooking = (b: any): string => {
          const ref = b.reference_number || "N/A"
          const startDateStr = b.start_date ? dateToBangkokDateString(new Date(b.start_date * 1000)) : "N/A"
          const endDateStr = b.end_date && b.end_date !== b.start_date 
            ? ` - ${dateToBangkokDateString(new Date(b.end_date * 1000))}` 
            : ""
          const timeStr = b.start_time ? `, ${b.start_time}${b.end_time ? ` - ${b.end_time}` : ""}` : ""
          return `${ref} (${b.name || "Unknown"}) - ${startDateStr}${endDateStr}${timeStr}`
        }
        
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        
        await logger.warn('Admin update rejected: overlap detected', {
          bookingId: id,
          status,
          overlappingNames,
          overlappingCount: overlapCheck.overlappingBookings?.length || 0
        })
        
        const errorMessage = overlapCheck.overlappingBookings && overlapCheck.overlappingBookings.length > 0
          ? `Cannot confirm this booking: The selected date range overlaps with ${overlapCheck.overlappingBookings.length} existing confirmed booking(s).\n\nOverlapping booking(s):\n${overlapCheck.overlappingBookings.map((b: any, idx: number) => `${idx + 1}. ${formatOverlappingBooking(b)}`).join("\n")}\n\nPlease choose a different date range or resolve the conflict first.`
          : `Cannot confirm this booking: The selected date and time overlaps with an existing confirmed booking. Please resolve the conflict first.`
        
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          errorMessage,
          { overlappingBookings: overlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
      
      // FINAL OVERLAP CHECK: Re-check right before updating to prevent race conditions
      await logger.info('Performing final overlap check before admin status update')
      const finalOverlapCheck = await checkBookingOverlap(
        id,
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime
      )
      
      if (finalOverlapCheck.overlaps) {
        // Format overlapping bookings with reference numbers and dates for detailed error message
        const { dateToBangkokDateString } = await import("@/lib/timezone-client")
        const formatOverlappingBooking = (b: any): string => {
          const ref = b.reference_number || "N/A"
          const startDateStr = b.start_date ? dateToBangkokDateString(new Date(b.start_date * 1000)) : "N/A"
          const endDateStr = b.end_date && b.end_date !== b.start_date 
            ? ` - ${dateToBangkokDateString(new Date(b.end_date * 1000))}` 
            : ""
          const timeStr = b.start_time ? `, ${b.start_time}${b.end_time ? ` - ${b.end_time}` : ""}` : ""
          return `${ref} (${b.name || "Unknown"}) - ${startDateStr}${endDateStr}${timeStr}`
        }
        
        const overlappingNames = finalOverlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        
        await logger.warn('Final overlap check detected conflict - booking became unavailable', {
          bookingId: id,
          status,
          overlappingNames,
          overlappingCount: finalOverlapCheck.overlappingBookings?.length || 0
        })
        
        const errorMessage = finalOverlapCheck.overlappingBookings && finalOverlapCheck.overlappingBookings.length > 0
          ? `The selected date range is no longer available. It overlaps with ${finalOverlapCheck.overlappingBookings.length} recently confirmed booking(s).\n\nOverlapping booking(s):\n${finalOverlapCheck.overlappingBookings.map((b: any, idx: number) => `${idx + 1}. ${formatOverlappingBooking(b)}`).join("\n")}\n\nPlease refresh and choose a different date range or resolve the conflict.`
          : `The selected date and time is no longer available. It overlaps with a recently confirmed booking. Please refresh and resolve the conflict.`
        
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          errorMessage,
          { overlappingBookings: finalOverlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
    }

    // Determine if this is an "other channel" verification
    // This happens when:
    // 1. Explicit action: confirm_other_channel or accept_deposit_other_channel
    // 2. Restoring from cancelled to confirmed without deposit evidence (automatic)
    const isExplicitOtherChannel = action === "confirm_other_channel" || action === "accept_deposit_other_channel"
    const isRestoringToConfirmedWithoutDeposit = 
      status === "confirmed" && 
      currentBooking.status === "cancelled" && 
      !currentBooking.depositEvidenceUrl
    const isOtherChannelVerification = isExplicitOtherChannel || isRestoringToConfirmedWithoutDeposit
    
    // Update changeReason to include "other channel" indication if needed
    let finalChangeReason = changeReason
    if (isOtherChannelVerification && status === "confirmed") {
      if (!finalChangeReason || !finalChangeReason.toLowerCase().includes('other channel')) {
        finalChangeReason = finalChangeReason 
          ? `${finalChangeReason} (Verified via other channel)`
          : 'Deposit verified through other channels (phone, in-person, etc.)'
      }
    }

    // Update booking status
    // CRITICAL: If restoring with date changes, update dates first, then status
    // This ensures dates are available when generating tokens
    if (isRestorationWithDateChange) {
      // Dates were already validated above, now update them before status update
      // This ensures token generation uses the new dates
      // CRITICAL: Use optimistic locking to prevent race conditions
      const { dbTransaction } = await import("@/lib/turso")
      const now = Math.floor(Date.now() / 1000)
      
      // Re-fetch booking to get latest updated_at for optimistic locking
      const recheckBookingForDates = await getBookingById(id)
      if (!recheckBookingForDates) {
        await logger.warn('Date update rejected: booking not found during re-check', { bookingId: id })
        return notFoundResponse('Booking', { requestId })
      }
      
      const originalUpdatedAtForDates = recheckBookingForDates.updatedAt
      
      try {
        const updateResult = await dbTransaction(async (tx) => {
          const updateFields: string[] = ["updated_at = ?"]
          const updateArgs: any[] = [now]
          
          if (newStartDate) {
            const startDateValue = typeof newStartDate === 'string' ? createBangkokTimestamp(newStartDate) : newStartDate
            updateFields.push("start_date = ?")
            updateArgs.push(startDateValue)
          }
          
          if (newEndDate !== undefined) {
            if (newEndDate === null) {
              updateFields.push("end_date = NULL")
              updateFields.push("date_range = 0")
            } else {
              const endDateValue = typeof newEndDate === 'string' ? createBangkokTimestamp(newEndDate) : newEndDate
              updateFields.push("end_date = ?")
              updateArgs.push(endDateValue)
              updateFields.push("date_range = 1")
            }
          }
          
          if (newStartTime !== undefined) {
            updateFields.push("start_time = ?")
            updateArgs.push(newStartTime || null)
          }
          
          if (newEndTime !== undefined) {
            updateFields.push("end_time = ?")
            updateArgs.push(newEndTime || null)
          }
          
          // CRITICAL: Use optimistic locking (check updated_at)
          const result = await tx.execute({
            sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
            args: [...updateArgs, id, originalUpdatedAtForDates],
          })
          
          return result
        })
        
        // Check if update succeeded (optimistic locking)
        if (updateResult.rowsAffected === 0) {
          await logger.warn('Date update rejected: booking was modified by another process', {
            bookingId: id,
            originalUpdatedAt: originalUpdatedAtForDates
          })
          // Track monitoring metric
          try {
            const { trackOptimisticLockConflict } = await import('@/lib/monitoring')
            trackOptimisticLockConflict('booking', id, { requestId, action: 'restoration_date_change' })
          } catch {
            // Ignore monitoring errors
          }
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Booking was modified by another process. Please refresh the page and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        
        await logger.info('Dates updated for restoration with date change', {
          bookingId: id,
          newStartDate,
          newEndDate,
          newStartTime,
          newEndTime
        })
      } catch (dateUpdateError) {
        await logger.error('Failed to update dates during restoration', dateUpdateError instanceof Error ? dateUpdateError : new Error(String(dateUpdateError)), { bookingId: id })
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to update booking dates during restoration. Please try again.",
          undefined,
          500,
          { requestId }
        )
      }
    }
    
    let updatedBooking
    try {
      // When restoring from cancelled to confirmed without deposit evidence,
      // automatically set depositVerifiedBy to admin email and mark as other channel
      const shouldAutoVerifyForRestoration = isRestoringToConfirmedWithoutDeposit && adminEmail
      const finalDepositVerifiedBy = shouldAutoVerifyForRestoration
        ? adminEmail
        : (shouldVerifyDeposit ? (typeof depositVerifiedBy === 'string' ? depositVerifiedBy.trim() : depositVerifiedBy) || adminEmail || undefined : undefined)
      
      updatedBooking = await updateBookingStatus(id, status, {
        changedBy: adminEmail,
        changeReason: finalChangeReason,
        adminNotes,
        proposedDate: proposedDate || undefined,
        depositVerifiedBy: finalDepositVerifiedBy,
        depositVerifiedFromOtherChannel: isOtherChannelVerification,
        sendNotification: true, // Always send notification on status change
      })
    } catch (error) {
      // Check if error is due to optimistic locking conflict
      const errorMessage = error instanceof Error ? error.message : "Failed to update booking"
      if (errorMessage.includes("modified by another process")) {
        await logger.warn('Booking update conflict: modified by another process', { bookingId: id })
        return errorResponse(
          ErrorCodes.CONFLICT,
          "Booking was modified by another process. Please refresh the page and try again.",
          undefined,
          409,
          { requestId }
        )
      }
      // Re-throw other errors to be handled by withErrorHandling
      throw error
    }

    // Log admin action
    try {
      await logAdminAction({
        actionType: "update_booking_status",
        resourceType: "booking",
        resourceId: id,
        adminEmail,
        adminName,
        description: `Changed booking status from ${currentBooking.status} to ${status}`,
        metadata: {
          oldStatus: currentBooking.status,
          newStatus: status,
          changeReason,
        },
      })
    } catch (logError) {
      // Don't fail the request if logging fails
      await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)), { bookingId: id })
    }

    // Send email notification to user (don't fail request if email fails)
    // Use updatedBooking.status instead of status, because updateBookingStatus may change the status
    // This ensures emails reflect the actual final status, not just what was requested
    const actualStatus = updatedBooking.status
    const isRestoration = currentBooking.status === "cancelled" && 
      (actualStatus === "pending_deposit" || actualStatus === "paid_deposit" || actualStatus === "confirmed")
    
    // Determine if this is a critical status change that should always send email
    // Critical changes: pending -> pending_deposit, pending_deposit -> paid_deposit, pending_deposit -> confirmed, paid_deposit -> confirmed, any restoration, any cancellation
    const isCriticalStatusChange = 
      (currentBooking.status === "pending" && actualStatus === "pending_deposit") ||
      (currentBooking.status === "pending_deposit" && actualStatus === "paid_deposit") ||
      (currentBooking.status === "pending_deposit" && actualStatus === "confirmed") ||
      (currentBooking.status === "paid_deposit" && actualStatus === "confirmed") ||
      (actualStatus === "cancelled") || // Always send cancellation emails (user needs to know booking is cancelled)
      isRestoration
    
    // CRITICAL: Always send emails for restoration, critical status changes, or when token exists
    // Restoration emails are critical because user needs to know their booking is active again
    // Condition breakdown:
    // 1. If there's a response token (pending_deposit, paid_deposit with token) -> send email
    // 2. If status is not "pending" (all restoration statuses are not pending) -> send email
    // 3. If it's a restoration (explicit check to ensure restoration emails are always sent) -> send email
    // 4. If it's a critical status change (pending -> pending_deposit, etc.) -> always send email
    const shouldSendEmail = updatedBooking.responseToken || 
                            actualStatus !== "pending" || 
                            isRestoration ||
                            isCriticalStatusChange
    
    if (shouldSendEmail) {
      try {
        // Send response token for pending_deposit status (deposit upload link)
        // Also send token for paid_deposit if this is a restoration (user needs to access booking details)
        // CRITICAL: For pending -> pending_deposit, token MUST be present
        const tokenToUse = actualStatus === "pending_deposit" 
          ? updatedBooking.responseToken 
          : (actualStatus === "paid_deposit" && isRestoration && updatedBooking.responseToken)
          ? updatedBooking.responseToken
          : undefined
        
        // CRITICAL: Log detailed info for pending_deposit status to help debug token issues
        if (actualStatus === "pending_deposit") {
          await logger.debug('Token check for pending_deposit email', {
            bookingId: id,
            oldStatus: currentBooking.status,
            actualStatus,
            hasToken: !!tokenToUse,
            tokenPrefix: tokenToUse ? tokenToUse.substring(0, 8) + '...' : '(null)',
            updatedBookingHasToken: !!updatedBooking.responseToken,
            isCriticalStatusChange,
            isPendingToPendingDeposit: currentBooking.status === "pending" && actualStatus === "pending_deposit"
          })
        }
        
        // Log warning if token is missing for pending_deposit status
        // CRITICAL: For pending -> pending_deposit, token should always be generated
        // If token is missing, this is a critical error that needs investigation
        if (actualStatus === "pending_deposit" && !tokenToUse) {
          await logger.error(
            `CRITICAL: No token available for pending_deposit booking - email will be sent without deposit link`,
            new Error(`Token missing for pending_deposit booking`),
            { 
              bookingId: id, 
              actualStatus,
              oldStatus: currentBooking.status,
              hasResponseToken: !!updatedBooking.responseToken,
              responseToken: updatedBooking.responseToken || '(null)',
              isCriticalStatusChange,
              isPendingToPendingDeposit: currentBooking.status === "pending" && actualStatus === "pending_deposit"
            }
          )
          // Still send email even without token - user needs to know booking was accepted
          // Admin can manually send token link if needed
        }
        
        // Enhance changeReason for restoration emails
        let enhancedChangeReason = changeReason
        if (isRestoration && !changeReason?.toLowerCase().includes('restored') && !changeReason?.toLowerCase().includes('restoration')) {
          enhancedChangeReason = changeReason 
            ? `${changeReason}\n\nYour booking has been restored from cancelled status.`
            : 'Your booking has been restored from cancelled status.'
        }
        
        // CRITICAL: Skip duplicate check for critical status changes to ensure user always gets notified
        // This is especially important for:
        // 1. pending -> pending_deposit (admin accepts booking)
        // 2. pending_deposit -> paid_deposit (deposit upload confirmation)
        // 3. pending_deposit -> confirmed (admin confirms via other channel)
        // 4. paid_deposit -> confirmed (deposit verification confirmation)
        // 5. Restoration emails (user needs to know booking is active again)
        await sendBookingStatusNotification(updatedBooking, actualStatus, {
          changeReason: enhancedChangeReason,
          responseToken: tokenToUse,
          skipDuplicateCheck: isCriticalStatusChange, // Skip duplicate check for critical changes
        })
        await logger.info(`Booking status notification email sent successfully`, { 
          bookingId: id, 
          actualStatus, 
          requestedStatus: status, 
          hasToken: !!tokenToUse,
          tokenPrefix: tokenToUse ? tokenToUse.substring(0, 8) + '...' : '(no token)',
          skippedDuplicateCheck: isCriticalStatusChange
        })
      } catch (emailError) {
        await logger.error("Failed to send booking status notification email", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
        // Don't fail the request - email is secondary
      }
    }

    // Send admin notification for status changes (including deposit-related statuses)
    // Use the same actualStatus from above (updatedBooking.status) to ensure consistency
    if (currentBooking.status !== actualStatus) {
      try {
        await sendAdminStatusChangeNotification(
          updatedBooking,
          currentBooking.status,
          actualStatus,
          changeReason,
          adminEmail || adminName || undefined
        )
        await logger.info(`Admin status change notification email sent successfully`, { bookingId: id, oldStatus: currentBooking.status, actualStatus, requestedStatus: status })
      } catch (adminEmailError) {
        await logger.error("Failed to send admin status change notification email", adminEmailError instanceof Error ? adminEmailError : new Error(String(adminEmailError)), { bookingId: id })
        // Don't fail the request - email is secondary
      }
    }

    // Transform booking to match frontend interface (convert ISO strings to Unix timestamps)
    const transformedBooking = {
      id: updatedBooking.id,
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
      // Preserve boolean value correctly - use explicit check to avoid undefined -> false conversion
      deposit_verified_from_other_channel: updatedBooking.depositVerifiedFromOtherChannel === true,
      // CRITICAL: Include all fee fields
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

    await logger.info('Booking updated successfully', { bookingId: id, status: updatedBooking.status })
    
    return successResponse(
      {
        booking: transformedBooking,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

export const DELETE = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin delete booking request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete booking rejected: authentication failed', { bookingId: id })
      return authError
    }

    const db = getTursoClient()

    // Get booking before deletion (for notifications and logging)
    const booking = await getBookingById(id)
    if (!booking) {
      await logger.warn('Admin delete booking failed: booking not found', { bookingId: id })
      return notFoundResponse('Booking', { requestId })
    }

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined
    let deletedBy: string | undefined

    try {
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
        deletedBy = adminName ? `${adminName} (${adminEmail})` : adminEmail
      }
    } catch (sessionError) {
      // Session might not be available, continue without admin info
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // OPTIMIZED: Delete booking from database FIRST (critical operation)
    // This ensures the booking is removed immediately, making the UI responsive
    await db.execute({
      sql: "DELETE FROM bookings WHERE id = ?",
      args: [id],
    })

    // Log admin action (fast database operation, keep synchronous)
    try {
      await logAdminAction({
        actionType: "delete_booking",
        resourceType: "booking",
        resourceId: id,
        adminEmail,
        adminName,
        description: `Deleted booking for ${booking.name} (${booking.email}) - Status: ${booking.status}`,
        metadata: {
          bookingName: booking.name,
          bookingEmail: booking.email,
          bookingStatus: booking.status,
          eventType: booking.eventType,
        },
      })
    } catch (logError) {
      // Don't fail the request if logging fails
      await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)), { bookingId: id })
    }

    // OPTIMIZED: Queue all slow operations for background processing
    // This allows the API to return immediately while cleanup happens asynchronously
    const backgroundOperations: Promise<void>[] = []

    // Queue blob deletion (non-blocking)
    if (booking.depositEvidenceUrl) {
      backgroundOperations.push(
        (async () => {
          try {
            const { deleteImage } = await import("@/lib/blob")
            await deleteImage(booking.depositEvidenceUrl!)
            await logger.info('Deleted deposit evidence blob after booking deletion', { blobUrl: booking.depositEvidenceUrl })
          } catch (blobError) {
            // Log error but don't fail - queue cleanup job as fallback
            await logger.error("Failed to delete deposit evidence blob after booking deletion", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: booking.depositEvidenceUrl })
            
            // Queue cleanup job for retry (fail-safe approach)
            try {
              await enqueueJob("cleanup-orphaned-blob", { blobUrl: booking.depositEvidenceUrl }, { priority: 1 })
              await logger.info('Queued orphaned blob cleanup job for deposit evidence', { blobUrl: booking.depositEvidenceUrl })
            } catch (queueError) {
              await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: booking.depositEvidenceUrl })
            }
          }
        })()
      )
    }

    // Queue user notification email (non-blocking)
    // Only send if booking was not already cancelled or finished
    if (
      booking.status !== "cancelled" &&
      booking.status !== "finished"
    ) {
      backgroundOperations.push(
        (async () => {
          try {
            // Call sendBookingStatusNotification in background
            // It will try to send, and if it fails, it queues automatically
            const { sendBookingStatusNotification } = await import("@/lib/email")
            await sendBookingStatusNotification(
              { ...booking, status: "cancelled" as const },
              "cancelled",
              {
                changeReason: "Booking has been deleted by administrator",
                skipDuplicateCheck: true, // Allow sending even if similar email was sent
              }
            )
            await logger.info("Cancellation notification sent to user for deleted booking", { bookingId: id })
          } catch (emailError) {
            // Email function queues automatically on failure, so this is just logging
            await logger.warn("User notification send failed, should be queued automatically", { bookingId: id, error: emailError instanceof Error ? emailError.message : String(emailError) })
          }
        })()
      )
    } else {
      await logger.debug(`No user notification sent for deleted booking`, { bookingId: id, status: booking.status })
    }

    // Queue admin notification email (non-blocking)
    backgroundOperations.push(
      (async () => {
        try {
          // Call sendAdminBookingDeletionNotification in background
          // It will try to send, and if it fails, it queues automatically
          const { sendAdminBookingDeletionNotification } = await import("@/lib/email")
          await sendAdminBookingDeletionNotification(booking, deletedBy)
          await logger.info("Admin deletion notification sent successfully", { bookingId: id })
        } catch (emailError) {
          // Email function queues automatically on failure, so this is just logging
          await logger.warn("Admin notification send failed, should be queued automatically", { bookingId: id, error: emailError instanceof Error ? emailError.message : String(emailError) })
        }
      })()
    )

    // OPTIMIZED: Start all background operations but don't wait for them
    // IMPROVED: Use Promise.allSettled with explicit error handling to prevent unhandled rejections
    // Store promise reference to ensure it's tracked (prevents garbage collection issues in serverless)
    const backgroundPromise = Promise.allSettled(backgroundOperations)
      .then(async (results) => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          // Log individual failures for debugging
          const failures = results
            .filter(r => r.status === 'rejected')
            .map((r, idx) => ({
              index: idx,
              error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'unknown'
            }))
          
          await logger.warn(`Some background operations failed during booking deletion`, { 
            bookingId: id, 
            failedCount: failed, 
            totalCount: results.length,
            failures
          })
        } else {
          await logger.info('All background operations completed for booking deletion', { bookingId: id })
        }
      })
      .catch(async (error) => {
        // This should rarely happen since Promise.allSettled doesn't reject
        // But we handle it just in case
        await logger.error('Unexpected error in background operations promise handler', 
          error instanceof Error ? error : new Error(String(error)), 
          { bookingId: id }
        )
      })
    
    // IMPROVED: Explicitly track the promise to prevent unhandled rejection warnings
    // In serverless environments, this ensures the promise is tracked even if function returns early
    // The promise will complete in the background, and errors are logged
    void backgroundPromise // Explicitly mark as intentionally not awaited

    await logger.info('Booking deleted successfully (background operations queued)', { bookingId: id })

    return successResponse(
      {
        message: "Booking deleted successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

