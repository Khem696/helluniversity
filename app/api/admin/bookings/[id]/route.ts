import { NextResponse } from "next/server"
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/[id]')
    
    await logger.info('Admin get booking request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get booking request rejected: authentication failed', { bookingId: id })
      return authError
    }

    // Invalidate cache to ensure fresh data when admin views booking
    // This prevents showing stale status (e.g., pending_deposit when it should be paid_deposit)
    const { invalidateCache, CacheKeys } = await import("@/lib/cache")
    invalidateCache(CacheKeys.booking(id))
    
    const booking = await getBookingById(id)

    if (!booking) {
      await logger.warn('Admin get booking failed: booking not found', { bookingId: id })
      return notFoundResponse('Booking', { requestId })
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
      deposit_verified_from_other_channel: booking.depositVerifiedFromOtherChannel || false,
      created_at: booking.createdAt,
      updated_at: booking.updatedAt,
    }

    return successResponse(
      {
        booking: transformedBooking,
        statusHistory,
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
  }, { endpoint: '/api/admin/bookings/[id]' })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/[id]')
    
    await logger.info('Admin update booking request', { bookingId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update booking rejected: authentication failed', { bookingId: id })
      return authError
    }

    const body = await request.json()
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

    // Handle date change for confirmed bookings (before status update)
    if (newStartDate || newEndDate || newStartTime !== undefined || newEndTime !== undefined) {
      // Date changes are only allowed for confirmed bookings
      if (currentBooking.status !== "confirmed") {
        await logger.warn('Date change rejected: booking not confirmed', { bookingId: id, status: currentBooking.status })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Date changes are only allowed for confirmed bookings.",
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

      // Update booking dates directly in database
      const db = getTursoClient()
      const now = Math.floor(Date.now() / 1000)
      
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

      await db.execute({
        sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ?`,
        args: [...updateArgs, id],
      })

      await logger.info('Booking dates updated successfully', {
        bookingId: id,
        newStartDate: checkStartDate,
        newEndDate: checkEndDate,
        newStartTime: checkStartTime,
        newEndTime: checkEndTime
      })

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
        deposit_verified_from_other_channel: updatedBooking.depositVerifiedFromOtherChannel || false,
        created_at: updatedBooking.createdAt,
        updated_at: updatedBooking.updatedAt,
      }

      await logger.info('Booking dates updated successfully', { bookingId: id })
      
      return successResponse(
        {
          booking: transformedBooking,
        },
        { requestId }
      )
    }

    // If rejecting deposit (pending_deposit -> pending_deposit), delete the deposit evidence blob
    // This happens when admin rejects deposit and user needs to re-upload
    if (status === "pending_deposit" && currentBooking.status === "pending_deposit" && currentBooking.depositEvidenceUrl) {
      try {
        await deleteImage(currentBooking.depositEvidenceUrl)
        await logger.info(`Deleted deposit evidence blob`, { blobUrl: currentBooking.depositEvidenceUrl })
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
              action: "deposit_rejection",
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
                action: "deposit_rejection",
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

    // Only set depositVerifiedBy when explicitly verifying deposit (status is confirmed)
    // Check if depositVerifiedBy is provided (not undefined, not null, and not empty string)
    const shouldVerifyDeposit = status === "confirmed" && 
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
      
      // Use current booking dates (no proposed dates in new flow)
        // CRITICAL: Use createBangkokTimestamp to handle date strings in Bangkok timezone
      const checkStartDate = typeof currentBooking.startDate === 'number'
          ? currentBooking.startDate
          : createBangkokTimestamp(String(currentBooking.startDate))
      const checkEndDate = currentBooking.endDate
          ? (typeof currentBooking.endDate === 'number'
              ? currentBooking.endDate
              : createBangkokTimestamp(String(currentBooking.endDate)))
          : null
      const checkStartTime = currentBooking.startTime || null
      const checkEndTime = currentBooking.endTime || null
      
      await logger.info('Checking overlap before admin status update', {
        bookingId: id,
        status,
        checkStartDate,
        checkEndDate
      })
      
      const overlapCheck = await checkBookingOverlap(
        id, // Exclude current booking from overlap check
        checkStartDate,
        checkEndDate,
        checkStartTime,
        checkEndTime
      )
      
      if (overlapCheck.overlaps) {
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Admin update rejected: overlap detected', {
          bookingId: id,
          status,
          overlappingNames
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `Cannot confirm this booking: the selected date and time overlaps with an existing confirmed booking (${overlappingNames}). Please resolve the conflict first.`,
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
        const overlappingNames = finalOverlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Final overlap check detected conflict - booking became unavailable', {
          bookingId: id,
          status,
          overlappingNames
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `The selected date and time is no longer available. It overlaps with a recently confirmed booking (${overlappingNames}). Please refresh and resolve the conflict.`,
          { overlappingBookings: finalOverlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
    }

    // Determine if this is an "other channel" verification
    const isOtherChannelVerification = action === "confirm_other_channel" || action === "accept_deposit_other_channel"
    
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
    let updatedBooking
    try {
      updatedBooking = await updateBookingStatus(id, status, {
        changedBy: adminEmail,
        changeReason: finalChangeReason,
        adminNotes,
        proposedDate: proposedDate || undefined,
        depositVerifiedBy: shouldVerifyDeposit ? (typeof depositVerifiedBy === 'string' ? depositVerifiedBy.trim() : depositVerifiedBy) || adminEmail || undefined : undefined,
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
    if (updatedBooking.responseToken || actualStatus !== "pending") {
      try {
        // Send response token for pending_deposit status (deposit upload link)
        // Token expires at booking start date/time
        const tokenToUse = actualStatus === "pending_deposit" ? updatedBooking.responseToken : undefined
        
        // Log warning if token is missing for pending_deposit status
        if (actualStatus === "pending_deposit" && !tokenToUse) {
          await logger.warn(`WARNING: No token available for pending_deposit booking`, { 
            bookingId: id, 
            actualStatus, 
            hasResponseToken: !!updatedBooking.responseToken,
            responseToken: updatedBooking.responseToken || '(null)'
          })
        }
        
        await sendBookingStatusNotification(updatedBooking, actualStatus, {
          changeReason: changeReason,
          responseToken: tokenToUse,
        })
        await logger.info(`Booking status notification email sent successfully`, { 
          bookingId: id, 
          actualStatus, 
          requestedStatus: status, 
          hasToken: !!tokenToUse,
          tokenPrefix: tokenToUse ? tokenToUse.substring(0, 8) + '...' : '(no token)'
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
  }, { endpoint: '/api/admin/bookings/[id]' })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/[id]')
    
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

    // Delete deposit evidence image from blob storage before deleting booking
    if (booking.depositEvidenceUrl) {
      try {
        const { deleteImage } = await import("@/lib/blob")
        await deleteImage(booking.depositEvidenceUrl)
        await logger.info('Deleted deposit evidence blob before booking deletion', { blobUrl: booking.depositEvidenceUrl })
      } catch (blobError) {
        // Log error but don't fail the deletion - queue cleanup job as fallback
        await logger.error("Failed to delete deposit evidence blob before booking deletion", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: booking.depositEvidenceUrl })
        
        // Queue cleanup job for retry (fail-safe approach)
        try {
          await enqueueJob("cleanup-orphaned-blob", { blobUrl: booking.depositEvidenceUrl }, { priority: 1 })
          await logger.info('Queued orphaned blob cleanup job for deposit evidence', { blobUrl: booking.depositEvidenceUrl })
        } catch (queueError) {
          await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: booking.depositEvidenceUrl })
        }
      }
    }

    // Delete booking (status history will cascade automatically due to foreign key)
    await db.execute({
      sql: "DELETE FROM bookings WHERE id = ?",
      args: [id],
    })

    // Log admin action
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

    // Send user notification based on booking status
    // Only send if booking was not already cancelled or finished
    if (
      booking.status !== "cancelled" &&
      booking.status !== "finished"
    ) {
      try {
        // For all active bookings (pending, pending_deposit, confirmed), send cancellation notification
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
        // Don't fail the request if email fails
        await logger.error("Failed to send user notification for deleted booking", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
      }
    } else {
      await logger.debug(`No user notification sent for deleted booking`, { bookingId: id, status: booking.status })
    }

    // Always send admin notification
    try {
      await sendAdminBookingDeletionNotification(booking, deletedBy)
      await logger.info("Admin deletion notification sent successfully", { bookingId: id })
    } catch (emailError) {
      // Don't fail the request if email fails
      await logger.error("Failed to send admin deletion notification", emailError instanceof Error ? emailError : new Error(String(emailError)), { bookingId: id })
    }

    await logger.info('Booking deleted successfully', { bookingId: id })

    return successResponse(
      {
        message: "Booking deleted successfully",
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/bookings/[id]' })
}

