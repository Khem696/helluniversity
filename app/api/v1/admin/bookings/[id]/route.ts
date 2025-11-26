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

    // CRITICAL: Check for cache-busting parameter to bypass cache
    // Frontend sends ?t=timestamp to ensure fresh data after status updates
    const url = new URL(request.url)
    const bypassCache = url.searchParams.has('t') || url.searchParams.has('_refresh')
    
    // Use getBookingById which includes caching
    // Cache will be invalidated automatically when booking is updated
    // But if cache-busting is requested, invalidate cache first to ensure fresh data
    if (bypassCache) {
      const { invalidateCache, CacheKeys } = await import('@/lib/cache')
      await invalidateCache(CacheKeys.booking(id))
      await logger.debug('Cache invalidated due to cache-busting parameter', { bookingId: id })
    }
    
    const booking = await getBookingById(id)
    
    if (!booking) {
      await logger.warn('Admin get booking failed: booking not found', { bookingId: id })
      return notFoundResponse('Booking', { requestId })
    }
    
    // Debug: Log booking data (including fee fields)
    await logger.debug('Booking from cache/DB', {
      bookingId: id,
      feeAmount: booking.feeAmount,
      feeCurrency: booking.feeCurrency,
      feeAmountOriginal: booking.feeAmountOriginal,
      hasFee: !!(booking.feeAmount && Number(booking.feeAmount) > 0),
      feeKeys: Object.keys(booking).filter(k => k.toLowerCase().includes('fee')),
    })

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
      reference_number: booking.referenceNumber,
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
    await logger.debug('Transformed booking fee data', {
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
    
    await logger.debug('Final booking with explicit fee fields', {
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
    // NOTE: Using 'let' instead of 'const' to allow re-assignment after date update
    // This prevents race conditions by ensuring we always use fresh booking data
    let currentBooking = await getBookingById(id)
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

    // CRITICAL: Acquire action lock to prevent concurrent modifications by multiple admins
    // This ensures only one admin can perform an action on a booking at a time
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        const actionType = action || `status_${status}` || 'update'
        actionLockId = await acquireActionLock('booking', id, actionType, adminEmail, adminName)
        
        if (!actionLockId) {
          // Another admin is currently performing this action
          await logger.warn('Action lock acquisition failed: another admin is performing this action', {
            bookingId: id,
            action: actionType,
            adminEmail
          })
          // No lock to release since acquisition failed
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Another admin is currently performing this action on this booking. Please wait a moment and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        
        await logger.debug('Action lock acquired', { bookingId: id, action: actionType, lockId: actionLockId })
      } catch (lockError) {
        // If locking fails, log but continue (fallback to optimistic locking)
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          bookingId: id
        })
      }
    }
    
    // Ensure lock is released even if update fails
    // FIXED: Make releaseLock idempotent and ensure it's always called (Issue #9)
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { bookingId: id, lockId: actionLockId })
          // Clear lock ID to make function idempotent
          actionLockId = null
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            bookingId: id,
            lockId: actionLockId
          })
        }
      }
    }

    // CRITICAL: Set up automatic lock extension for long operations
    // This prevents lock expiration during operations that take longer than 30 seconds
    // Declare lockManager outside try block so it's accessible in finally block
    let lockManager: Awaited<ReturnType<typeof import('@/lib/action-lock').createLockExtensionManager>> | null = null
    if (actionLockId && adminEmail) {
      try {
        const { createLockExtensionManager } = await import('@/lib/action-lock')
        lockManager = createLockExtensionManager(actionLockId, adminEmail)
        if (lockManager) {
          // FIXED: Wrap start() in try-catch to ensure cleanup on failure (Issue #1)
          try {
            lockManager.start()
            await logger.debug('Automatic lock extension started', { bookingId: id, lockId: actionLockId })
          } catch (startError) {
            // If start() fails, stop the manager to prevent memory leaks
            lockManager.stop()
            await logger.warn('Failed to start lock extension manager', {
              bookingId: id,
              lockId: actionLockId,
              error: startError instanceof Error ? startError.message : String(startError),
            })
            lockManager = null // Clear manager reference
          }
        }
      } catch (importError) {
        // If import fails, log but continue (lock extension is optional)
        await logger.warn('Failed to import lock extension manager', {
          bookingId: id,
          error: importError instanceof Error ? importError.message : String(importError),
        })
      }
    }

    // CRITICAL: Use try-finally to ensure lock is ALWAYS released, even on unhandled exceptions
    try {
      // CRITICAL: Validate status transition using state machine guards (CRITICAL-1, CRITICAL-2)
      // This ensures backend validation matches frontend validation and prevents race conditions
      // FIXED: Validate AFTER lock is acquired to prevent race conditions (CRITICAL-2)
      if (status && status !== currentBooking.status) {
        try {
          const { validateTransitionWithGuards, isActionAllowed } = await import('@/lib/booking-state-machine')
          
          // If action is provided, use isActionAllowed for more specific validation
          if (action) {
            const actionValidation = await isActionAllowed(
              action,
              currentBooking.status,
              currentBooking,
              { 
                checkOverlap: true, 
                verifyBlob: true,
                isAdmin: true
              }
            )
            
            if (!actionValidation.allowed) {
              await logger.warn('Status transition rejected by state machine guard', {
                bookingId: id,
                action,
                fromStatus: currentBooking.status,
                toStatus: status,
                reason: actionValidation.reason
              })
              await releaseLock()
              return errorResponse(
                ErrorCodes.VALIDATION_ERROR,
                actionValidation.reason || `Action "${action}" is not allowed for status "${currentBooking.status}"`,
                undefined,
                400,
                { requestId }
              )
            }
          } else {
            // Fallback: validate transition directly if action not provided
            const transitionValidation = await validateTransitionWithGuards(
              currentBooking.status,
              status,
              currentBooking,
              { 
                checkOverlap: true, 
                verifyBlob: true,
                isAdmin: true
              }
            )
            
            if (!transitionValidation.valid) {
              await logger.warn('Status transition rejected by state machine guard', {
                bookingId: id,
                fromStatus: currentBooking.status,
                toStatus: status,
                reason: transitionValidation.reason
              })
              await releaseLock()
              return errorResponse(
                ErrorCodes.VALIDATION_ERROR,
                transitionValidation.reason || `Cannot transition from "${currentBooking.status}" to "${status}"`,
                undefined,
                400,
                { requestId }
              )
            }
          }
        } catch (validationError) {
          // If state machine validation fails, log error but allow basic validation to proceed
          // This is a safety measure - state machine validation should not break the system
          await logger.error('State machine validation error', validationError instanceof Error ? validationError : new Error(String(validationError)), {
            bookingId: id,
            fromStatus: currentBooking.status,
            toStatus: status,
            action
          })
          // Continue with basic validation - don't block the request
          // The basic status validation above will still catch invalid statuses
        }
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
        await releaseLock()
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
        await releaseLock()
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
            await releaseLock()
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
        await releaseLock()
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
        await releaseLock()
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
        await releaseLock()
        return notFoundResponse('Booking', { requestId })
      }
      
      if (recheckBooking.status !== "confirmed") {
        await logger.warn('Date change rejected: booking status changed during update', {
          bookingId: id,
          originalStatus: currentBooking.status,
          currentStatus: recheckBooking.status
        })
        await releaseLock()
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
        await releaseLock()
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
            // NOTE: currentBooking is guaranteed to be non-null (checked at line 303)
            if (currentBooking!.endDate) {
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
          await releaseLock()
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
        await releaseLock()
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
        await releaseLock()
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
          allowIntentionalDuplicate: true, // FIXED: Allow intentional duplicates for admin-initiated date changes (Issue #17)
        })
        await logger.info('Date change notification email sent successfully', { bookingId: id })
      } catch (emailError) {
        await logger.error("Failed to send date change notification email", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
        // Don't fail the request - email is secondary
      }
      
      // FIXED: Send date change email for all scenarios, including restoration with date change (Issue #5)
      // Date change email should be sent even when status is also changing
      // The email will include both date change and status change information
      // Note: For restoration with date change, we'll include date info in the status change email below
      // For date-only changes, send email here
      if (!isRestorationWithDateChange) {
        // Date-only change - send email here
        // (Date change email already sent above at line 922-981)
        
        // FIXED: Broadcast SSE event for date-only updates (Issue #17)
        // This ensures other admins see date changes in real-time
        try {
          const { broadcastBookingEvent } = await import('../stream/route')
          const { prepareBookingDataForSSE } = await import('@/lib/booking-sse-data')
          const { getTursoClient } = await import('@/lib/turso')
          
          // Get fresh booking data from database for SSE broadcast
          const db = getTursoClient()
          const freshBookingRow = await db.execute({
            sql: "SELECT * FROM bookings WHERE id = ?",
            args: [id],
          })
          
          if (freshBookingRow.rows.length > 0) {
            const dbRow = freshBookingRow.rows[0] as any
            const bookingData = prepareBookingDataForSSE(dbRow)
            
            await broadcastBookingEvent('booking:updated', bookingData, {
              changedBy: adminEmail || undefined,
              changeReason: changeReason || 'Date updated',
            })
            
            await logger.debug('Date change SSE broadcast sent', { bookingId: id })
          }
        } catch (broadcastError) {
          // Don't fail the request if broadcast fails - it's non-critical
          await logger.warn('Failed to broadcast date change event', {
            bookingId: id,
            error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
          })
        }
        
        return successResponse(
          {
            booking: transformedBooking,
          },
          { requestId }
        )
      }
      // Otherwise, continue to status update logic (dates already updated, now update status)
      // For restoration with date change, date change info will be included in status change email below
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
        
        await releaseLock() // CRITICAL: Release lock before returning
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
        
        await releaseLock() // CRITICAL: Release lock before returning
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
        await releaseLock() // CRITICAL: Release lock before returning
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
          await releaseLock() // CRITICAL: Release lock before returning
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
        
        // CRITICAL: Re-fetch booking after date update to get fresh data
        // This prevents race conditions where another process modifies the booking
        // between date update and status update
        const freshBookingAfterDateUpdate = await getBookingById(id)
        if (!freshBookingAfterDateUpdate) {
          await logger.error('Failed to fetch booking after date update', new Error('Booking not found after date update'), { bookingId: id })
          await releaseLock() // CRITICAL: Release lock before returning
          return errorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to retrieve booking after date update. Please try again.",
            undefined,
            500,
            { requestId }
          )
        }
        
        // Update currentBooking reference to use fresh data
        // This ensures subsequent validation and status update use the latest booking state
        currentBooking = freshBookingAfterDateUpdate
        await logger.debug('Re-fetched booking after date update for race condition prevention', {
          bookingId: id,
          freshUpdatedAt: currentBooking.updatedAt,
          freshStartDate: currentBooking.startDate,
          freshEndDate: currentBooking.endDate
        })
      } catch (dateUpdateError) {
        await logger.error('Failed to update dates during restoration', dateUpdateError instanceof Error ? dateUpdateError : new Error(String(dateUpdateError)), { bookingId: id })
        await releaseLock() // CRITICAL: Release lock before returning
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to update booking dates during restoration. Please try again.",
          undefined,
          500,
          { requestId }
        )
      }
    }
    
    // CRITICAL: Validate token generation requirements BEFORE updating status
    // For pending_deposit status transitions from pending, token generation requires start_date
    // This ensures atomicity: if token generation would fail, we don't update the database
    // NOTE: currentBooking is now fresh (either from initial fetch or re-fetch after date update)
    const isPendingToPendingDeposit = currentBooking.status === "pending" && status === "pending_deposit"
    const isCancelledToPendingDeposit = currentBooking.status === "cancelled" && status === "pending_deposit"
    const requiresTokenGeneration = isPendingToPendingDeposit || isCancelledToPendingDeposit
    
    if (requiresTokenGeneration) {
      // Check if booking has start_date (required for token expiration calculation)
      // Use effective start date: newStartDate if provided, otherwise currentBooking.startDate
      // NOTE: If dates were just updated, currentBooking.startDate now contains the new date
      const effectiveStartDate = newStartDate || currentBooking.startDate
      
      if (!effectiveStartDate) {
        await logger.error(
          'Cannot transition to pending_deposit: booking missing start_date required for token generation',
          new Error('Missing start_date for token generation'),
          {
            bookingId: id,
            currentStatus: currentBooking.status,
            requestedStatus: status,
            hasStartDate: !!currentBooking.startDate,
            hasNewStartDate: !!newStartDate
          }
        )
        await releaseLock() // CRITICAL: Release lock before returning
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Cannot accept booking: Booking date is required to generate deposit upload link. Please set a booking date first.",
          undefined,
          400,
          { requestId }
        )
      }
      
      // FIXED: Verify that updateBookingStatus will generate token
      // The token generation happens inside updateBookingStatus, but we need to ensure
      // it will succeed. Since updateBookingStatus handles token generation internally,
      // we just need to ensure the booking has the required start_date (already checked above)
      // The actual validation happens after updateBookingStatus returns (see line 1522)
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
      // CRITICAL: finalOverlapCheck is only defined when status === "confirmed" (lines 1099-1227)
      // For status-only updates (non-confirmed) or date-only updates, finalOverlapCheck is undefined
      // DO NOT access finalOverlapCheck.overlappingBookings here - it will cause TypeError
      // Overlap errors are handled before updateBookingStatus is called (lines 1142-1226)
      const errorMessage = error instanceof Error ? error.message : "Failed to update booking"
      if (errorMessage.includes("modified by another process")) {
        await logger.warn('Booking update conflict: modified by another process', { bookingId: id })
        await releaseLock() // CRITICAL: Release lock before returning
        return errorResponse(
          ErrorCodes.CONFLICT,
          "Booking was modified by another process. Please refresh the page and try again.",
          undefined,
          409,
          { requestId }
        )
      }
      // Re-throw other errors to be handled by withErrorHandling
      // Release lock before re-throwing
      await releaseLock()
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
    
    // FIXED: Refactor email sending logic to be explicit and clear (Issue #6)
    /**
     * Determine if email should be sent for status change
     * Returns true if email should be sent, false otherwise
     */
    function shouldSendStatusChangeEmail(
      oldStatus: string,
      newStatus: string,
      hasToken: boolean,
      isStatusChange: boolean,
      isRestoration: boolean
    ): boolean {
      // Don't send if status didn't actually change (no-op update)
      if (!isStatusChange) {
        return false
      }
      
      // Always send for restorations (user needs to know booking is active again)
      if (isRestoration) {
        return true
      }
      
      // Always send cancellation emails (user needs to know booking is cancelled)
      if (newStatus === "cancelled") {
        return true
      }
      
      // Always send for critical status transitions (user action required)
      const criticalTransitions = [
        { from: "pending", to: "pending_deposit" }, // User needs to upload deposit
        { from: "pending_deposit", to: "paid_deposit" }, // Deposit received
        { from: "pending_deposit", to: "confirmed" }, // Booking confirmed
        { from: "paid_deposit", to: "confirmed" }, // Booking confirmed
      ]
      
      const isCriticalTransition = criticalTransitions.some(
        transition => transition.from === oldStatus && transition.to === newStatus
      )
      
      if (isCriticalTransition) {
        return true
      }
      
      // Send if booking has a token (user-facing booking that needs notification)
      // Tokens exist for: pending_deposit, paid_deposit (some cases)
      if (hasToken && newStatus !== "pending") {
        return true
      }
      
      // Send for any status change from pending (except pending -> pending, which is handled above)
      if (oldStatus === "pending" && newStatus !== "pending") {
        return true
      }
      
      // Don't send for other transitions (e.g., confirmed -> confirmed, finished -> finished)
      return false
    }
    
    // Check if status actually changed
    const isStatusChange = currentBooking.status !== actualStatus
    
    // Determine if this is a critical status change (for logging)
    const isCriticalStatusChange = 
      (currentBooking.status === "pending" && actualStatus === "pending_deposit") ||
      (currentBooking.status === "pending_deposit" && actualStatus === "paid_deposit") ||
      (currentBooking.status === "pending_deposit" && actualStatus === "confirmed") ||
      (currentBooking.status === "paid_deposit" && actualStatus === "confirmed") ||
      (actualStatus === "cancelled") ||
      isRestoration
    
    // Use explicit function to determine if email should be sent
    const shouldSendEmail = shouldSendStatusChangeEmail(
      currentBooking.status,
      actualStatus,
      !!updatedBooking.responseToken,
      isStatusChange,
      isRestoration
    )
    
    // CRITICAL: Log email sending decision for debugging
    await logger.debug('Email sending decision', {
      bookingId: id,
      shouldSendEmail,
      isCriticalStatusChange,
      isRestoration,
      hasToken: !!updatedBooking.responseToken,
      actualStatus,
      oldStatus: currentBooking.status,
      isOtherChannelVerification,
      changeReason: finalChangeReason,
      transition: `${currentBooking.status} -> ${actualStatus}`
    })
    
    if (shouldSendEmail) {
      try {
        // FIXED: Simplify token logic and handle all restoration scenarios (Issue #30)
        // Token is required for:
        // 1. pending_deposit status (for deposit upload)
        // 2. paid_deposit status if restoration (user needs access to booking details)
        // Token is optional for other statuses
        let tokenToUse: string | undefined = undefined
        
        if (actualStatus === "pending_deposit") {
          // CRITICAL: Token is REQUIRED for pending_deposit
          tokenToUse = updatedBooking.responseToken || undefined
        } else if (actualStatus === "paid_deposit" && isRestoration) {
          // Token is optional but recommended for paid_deposit restorations
          tokenToUse = updatedBooking.responseToken || undefined
        }
        // For other statuses, token is not needed in email
        
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
        
        // IMPROVED: Token validation for pending_deposit status - allow status update even if token fails
        // For pending -> pending_deposit, token is preferred but not blocking
        // If token generation fails, log error and queue email for manual retry instead of blocking status update
        if (actualStatus === "pending_deposit" && !tokenToUse) {
          await logger.error(
            `WARNING: No token available for pending_deposit booking - email will be queued for manual retry`,
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
          // IMPROVED: Don't block status update - queue email for manual retry instead
          // This allows admin to proceed with status change, and email can be sent later when token is available
          // The email will be queued with error status and can be manually retried
          try {
            const { addEmailToQueue } = await import('@/lib/email-queue')
            // Queue email without token - it will be retried later when token is available
            await addEmailToQueue(
              'status_change',
              updatedBooking.email,
              `Booking Status Update - ${updatedBooking.referenceNumber || id}`,
              `<p>Your booking status has been updated to pending_deposit. However, the deposit upload link could not be generated. Please contact support.</p>`,
              `Your booking status has been updated to pending_deposit. However, the deposit upload link could not be generated. Please contact support.`,
              {
                bookingId: id,
                referenceNumber: updatedBooking.referenceNumber,
                status: actualStatus,
                error: 'Token generation failed'
              },
              { skipDuplicateCheck: true } // Allow queueing even if duplicate exists
            )
            await logger.info('Queued email for manual retry after token generation failure', { bookingId: id })
          } catch (queueError) {
            await logger.error('Failed to queue email after token generation failure', queueError instanceof Error ? queueError : new Error(String(queueError)), { bookingId: id })
          }
          // Continue with status update - don't block it
          // Note: Email will be sent later when token is available or manually retried
        }
        
        // Enhance changeReason for restoration emails and other channel confirmations
        // CRITICAL: Use finalChangeReason which includes "other channel" text if applicable
        let enhancedChangeReason = finalChangeReason || changeReason
        
        // FIXED: Include date change information in status change email for restoration with date change (Issue #5)
        if (isRestorationWithDateChange) {
          // Format date change information
          const formatDateTime = (date: string | number | null, time: string | null | undefined): string => {
            if (!date) return "Not specified"
            let dateObj: Date
            if (typeof date === 'string') {
              const [year, month, day] = date.split('-').map(Number)
              dateObj = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
            } else {
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
          
          const dateChangeInfo = `\n\nDate & Time Change:\nPrevious: ${oldDateRange}\nNew: ${newDateRange}`
          enhancedChangeReason = enhancedChangeReason 
            ? `${enhancedChangeReason}${dateChangeInfo}`
            : `Your booking has been restored and dates have been updated.${dateChangeInfo}`
        }
        
        if (isRestoration && !enhancedChangeReason?.toLowerCase().includes('restored') && !enhancedChangeReason?.toLowerCase().includes('restoration') && !isRestorationWithDateChange) {
          enhancedChangeReason = enhancedChangeReason 
            ? `${enhancedChangeReason}\n\nYour booking has been restored from cancelled status.`
            : 'Your booking has been restored from cancelled status.'
        }
        
        // CRITICAL: Ensure "other channel" confirmation emails have proper messaging
        // This handles pending_deposit -> confirmed via other channel
        if (actualStatus === "confirmed" && 
            currentBooking.status === "pending_deposit" && 
            isOtherChannelVerification &&
            !enhancedChangeReason?.toLowerCase().includes('other channel')) {
          enhancedChangeReason = enhancedChangeReason 
            ? `${enhancedChangeReason}\n\nDeposit verified through other channels (phone, in-person, etc.).`
            : 'Deposit verified through other channels (phone, in-person, etc.). Your booking has been confirmed.'
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
          allowIntentionalDuplicate: isCriticalStatusChange, // FIXED: Allow intentional duplicates for admin-initiated critical changes (Issue #17)
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
    
    // Release action lock after successful update
    await releaseLock()
    
    return successResponse(
      {
        booking: transformedBooking,
      },
      { requestId }
    )
    } finally {
      // CRITICAL: Stop automatic lock extension before releasing lock
      // FIXED: Ensure lockManager is stopped even if it was created but start() failed (Issue #2)
      // FIXED: Add defensive cleanup if stop() throws to prevent memory leaks (HIGH-3)
      if (lockManager) {
        try {
          lockManager.stop()
          await logger.debug('Automatic lock extension stopped', { bookingId: id, lockId: actionLockId })
        } catch (stopError) {
          // FIXED: Log error but continue - lock release is more important (Issue #2)
          await logger.warn('Error stopping lock extension manager', {
            bookingId: id,
            lockId: actionLockId,
            error: stopError instanceof Error ? stopError.message : String(stopError),
          })
          
          // FIXED: Defensive cleanup - try to manually clear interval if stop() failed (HIGH-3)
          // This is a last resort to prevent memory leaks if stop() throws unexpectedly
          try {
            // Access private intervalId via type assertion (last resort defensive measure)
            const manager = lockManager as any
            if (manager.intervalId) {
              clearInterval(manager.intervalId)
              manager.intervalId = null
              manager.isActive = false
              await logger.warn('Manually cleared lock extension interval after stop() failure', {
                bookingId: id,
                lockId: actionLockId,
              })
            }
          } catch (cleanupError) {
            // Ignore cleanup errors - already logged the original error
            // This is a defensive measure, so failure here is acceptable
          }
        }
      }
      
      // CRITICAL: Always release lock, even if an unhandled exception occurs
      // This ensures locks are never left hanging, preventing other admins from being blocked
      // Note: releaseLock is idempotent, so calling it multiple times is safe
      await releaseLock()
    }
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

    // FIXED: Send emails BEFORE deletion (Issue #28)
    // This ensures emails are sent even if deletion fails, and allows retry logic
    // Emails are sent synchronously before deletion to ensure they're sent
    const emailOperations: Promise<void>[] = []
    
    // Send user notification email BEFORE deletion (if not already cancelled/finished)
    if (
      booking.status !== "cancelled" &&
      booking.status !== "finished"
    ) {
      emailOperations.push(
        (async () => {
          try {
            const { sendBookingStatusNotification } = await import("@/lib/email")
            await sendBookingStatusNotification(
              { ...booking, status: "cancelled" as const },
              "cancelled",
              {
                changeReason: "Booking has been deleted by administrator",
                allowIntentionalDuplicate: true, // Allow sending even if similar email was sent
              }
            )
            await logger.info("Cancellation notification sent to user for deleted booking (before deletion)", { bookingId: id })
          } catch (emailError) {
            // Email function queues automatically on failure, so this is just logging
            await logger.warn("User notification send failed, should be queued automatically", { bookingId: id, error: emailError instanceof Error ? emailError.message : String(emailError) })
          }
        })()
      )
    } else {
      await logger.debug(`No user notification sent for deleted booking (already cancelled/finished)`, { bookingId: id, status: booking.status })
    }

    // Send admin notification email BEFORE deletion
    emailOperations.push(
      (async () => {
        try {
          const { sendAdminBookingDeletionNotification } = await import("@/lib/email")
          await sendAdminBookingDeletionNotification(booking, deletedBy)
          await logger.info("Admin deletion notification sent successfully (before deletion)", { bookingId: id })
        } catch (emailError) {
          // Email function queues automatically on failure, so this is just logging
          await logger.warn("Admin notification send failed, should be queued automatically", { bookingId: id, error: emailError instanceof Error ? emailError.message : String(emailError) })
        }
      })()
    )
    
    // Wait for emails to be sent (or queued) before deletion
    // Use Promise.allSettled to ensure all emails are attempted even if some fail
    try {
      await Promise.allSettled(emailOperations)
      await logger.info("All email notifications sent/queued before booking deletion", { bookingId: id })
    } catch (emailError) {
      // Log error but continue with deletion - emails are queued automatically on failure
      await logger.warn("Some email notifications failed before deletion, but continuing with deletion", { 
        bookingId: id, 
        error: emailError instanceof Error ? emailError.message : String(emailError) 
      })
    }

    // CRITICAL: Broadcast booking deletion event BEFORE deletion (need booking data)
    // Fetch raw database row to get Unix timestamps (not formatted dates)
    try {
      const bookingRow = await db.execute({
        sql: "SELECT * FROM bookings WHERE id = ?",
        args: [id],
      })
      
      if (bookingRow.rows.length > 0) {
        const dbRow = bookingRow.rows[0] as any
        const { broadcastBookingEvent } = await import('../stream/route')
        
        // Prepare booking data with raw timestamps (Unix timestamps, not date strings)
        const bookingData = {
          id: dbRow.id,
          reference_number: dbRow.reference_number ?? null,
          name: dbRow.name,
          email: dbRow.email,
          phone: dbRow.phone ?? null,
          participants: dbRow.participants ?? null,
          event_type: dbRow.event_type,
          other_event_type: dbRow.other_event_type ?? null,
          date_range: dbRow.date_range ?? 0,
          start_date: dbRow.start_date ?? null,
          end_date: dbRow.end_date ?? null,
          start_time: dbRow.start_time ?? null,
          end_time: dbRow.end_time ?? null,
          organization_type: dbRow.organization_type ?? null,
          organized_person: dbRow.organized_person ?? null,
          introduction: dbRow.introduction ?? null,
          biography: dbRow.biography ?? null,
          special_requests: dbRow.special_requests ?? null,
          status: dbRow.status,
          admin_notes: dbRow.admin_notes ?? null,
          response_token: dbRow.response_token ?? null,
          token_expires_at: dbRow.token_expires_at ?? null,
          proposed_date: dbRow.proposed_date ?? null,
          proposed_end_date: dbRow.proposed_end_date ?? null,
          user_response: dbRow.user_response ?? null,
          response_date: dbRow.response_date ?? null,
          deposit_evidence_url: dbRow.deposit_evidence_url ?? null,
          deposit_verified_at: dbRow.deposit_verified_at ?? null,
          deposit_verified_by: dbRow.deposit_verified_by ?? null,
          deposit_verified_from_other_channel: dbRow.deposit_verified_from_other_channel ?? false,
          fee_amount: dbRow.fee_amount ?? null,
          fee_amount_original: dbRow.fee_amount_original ?? null,
          fee_currency: dbRow.fee_currency ?? null,
          fee_conversion_rate: dbRow.fee_conversion_rate ?? null,
          fee_rate_date: dbRow.fee_rate_date ?? null,
          fee_recorded_at: dbRow.fee_recorded_at ?? null,
          fee_recorded_by: dbRow.fee_recorded_by ?? null,
          fee_notes: dbRow.fee_notes ?? null,
          created_at: dbRow.created_at,
          updated_at: dbRow.updated_at,
        }
        
        await broadcastBookingEvent('booking:deleted', bookingData, {
          changedBy: deletedBy,
          changeReason: 'Booking deleted by administrator',
        })
        
        await logger.info('Booking deletion broadcast sent to admin clients', { bookingId: id })
      }
    } catch (broadcastError) {
      // Don't fail if broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast booking deletion event', { 
        bookingId: id,
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      })
    }
    
    // Delete booking from database (after emails are sent/queued and broadcast)
    await db.execute({
      sql: "DELETE FROM bookings WHERE id = ?",
      args: [id],
    })
    
    // CRITICAL: Broadcast stats update (deletion affects pending count)
    try {
      const { broadcastStatsUpdate } = await import('../../stats/stream/route')
      const { listBookings } = await import('@/lib/bookings')
      const { getEmailQueueStats } = await import('@/lib/email-queue')
      
      // Get updated stats
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0,
        offset: 0,
      })
      
      const emailQueueStats = await getEmailQueueStats()
      const pendingEmailCount = (emailQueueStats.pending || 0) + (emailQueueStats.failed || 0)
      
      await broadcastStatsUpdate({
        bookings: {
          pending: pendingBookingsResult.total,
        },
        emailQueue: {
          pending: emailQueueStats.pending || 0,
          failed: emailQueueStats.failed || 0,
          total: pendingEmailCount,
        },
      })
      
      await logger.info('Stats update broadcast sent after booking deletion')
    } catch (statsError) {
      // Don't fail if stats broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast stats update after booking deletion', { 
        bookingId: id,
        error: statsError instanceof Error ? statsError.message : String(statsError)
      })
    }

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

