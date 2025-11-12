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
  unauthorizedResponse,
  forbiddenResponse,
  getAuthSession,
} from "@/lib/auth"
import { deleteImage } from "@/lib/blob"
import { enqueueJob } from "@/lib/job-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Admin Booking Management API
 * 
 * GET /api/admin/bookings/[id] - Get booking details
 * PATCH /api/admin/bookings/[id] - Update booking status
 * DELETE /api/admin/bookings/[id] - Delete booking
 * - All routes require Google Workspace authentication
 */

async function checkAuth() {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required")
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
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
    
    const authError = await checkAuth()
    if (authError) {
      await logger.warn('Admin get booking request rejected: authentication failed', { bookingId: id })
      return authError
    }

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

    // Transform booking to match frontend interface (convert date strings to Unix timestamps)
    // CRITICAL: Use createBangkokTimestamp to handle YYYY-MM-DD strings in Bangkok timezone
    const { createBangkokTimestamp } = await import('@/lib/timezone')
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
      created_at: booking.createdAt,
      updated_at: booking.updatedAt,
    }

    return successResponse(
      {
        booking: transformedBooking,
        statusHistory,
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
    
    const authError = await checkAuth()
    if (authError) {
      await logger.warn('Admin update booking rejected: authentication failed', { bookingId: id })
      return authError
    }

    const body = await request.json()
    const { status, changeReason, adminNotes, proposedDate, depositVerifiedBy } = body
    
    await logger.debug('Booking update data', {
      bookingId: id,
      status,
      hasChangeReason: !!changeReason,
      hasAdminNotes: !!adminNotes,
      hasProposedDate: !!proposedDate,
      hasDepositVerifiedBy: !!depositVerifiedBy,
      depositVerifiedBy: depositVerifiedBy || '(not provided)'
    })

    // Validate status
    const validStatuses = ["pending", "accepted", "rejected", "postponed", "cancelled", "paid_deposit", "checked-in", "pending_deposit"]
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

    // If rejecting deposit (paid_deposit -> pending_deposit), delete the deposit evidence blob
    if (status === "pending_deposit" && currentBooking.status === "paid_deposit" && currentBooking.depositEvidenceUrl) {
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

    // Only set depositVerifiedBy when explicitly verifying deposit (status is checked-in)
    // Check if depositVerifiedBy is provided (not undefined, not null, and not empty string)
    const shouldVerifyDeposit = status === "checked-in" && 
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

    // ENHANCED OVERLAP CHECK: Check for overlaps before updating to checked-in or accepting proposed dates
    // This prevents admin from creating overlapping bookings
    if (status === "checked-in" || (status === "accepted" && currentBooking.proposed_date)) {
      const { checkBookingOverlap } = await import('@/lib/booking-validations')
      const { createBangkokTimestamp } = await import('@/lib/timezone')
      
      // Determine which dates to check
      let checkStartDate: number
      let checkEndDate: number | null
      let checkStartTime: string | null
      let checkEndTime: string | null
      
      if (currentBooking.proposed_date && status === "accepted") {
        // Accepting a proposed date - check proposed dates
        // CRITICAL: Use createBangkokTimestamp to handle date strings in Bangkok timezone
        const { createBangkokTimestamp: createBangkokTimestampForCheck } = await import('@/lib/timezone')
        checkStartDate = typeof currentBooking.proposed_date === 'number' 
          ? currentBooking.proposed_date 
          : createBangkokTimestampForCheck(String(currentBooking.proposed_date))
        checkEndDate = currentBooking.proposed_end_date
          ? (typeof currentBooking.proposed_end_date === 'number'
              ? currentBooking.proposed_end_date
              : createBangkokTimestampForCheck(String(currentBooking.proposed_end_date)))
          : null
        // Parse times from user_response if available
        if (currentBooking.userResponse) {
          const startTimeMatch = currentBooking.userResponse.match(/Start Time: ([^,)]+)/)
          const endTimeMatch = currentBooking.userResponse.match(/End Time: ([^,)]+)/)
          checkStartTime = startTimeMatch ? startTimeMatch[1].trim() : currentBooking.start_time
          checkEndTime = endTimeMatch ? endTimeMatch[1].trim() : currentBooking.end_time
        } else {
          checkStartTime = currentBooking.start_time
          checkEndTime = currentBooking.end_time
        }
      } else {
        // Checking in with original dates
        // CRITICAL: Use createBangkokTimestamp to handle date strings in Bangkok timezone
        const { createBangkokTimestamp: createBangkokTimestampForCheck2 } = await import('@/lib/timezone')
        checkStartDate = typeof currentBooking.start_date === 'number'
          ? currentBooking.start_date
          : createBangkokTimestampForCheck2(String(currentBooking.start_date))
        checkEndDate = currentBooking.end_date
          ? (typeof currentBooking.end_date === 'number'
              ? currentBooking.end_date
              : createBangkokTimestampForCheck2(String(currentBooking.end_date)))
          : null
        checkStartTime = currentBooking.start_time
        checkEndTime = currentBooking.end_time
      }
      
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
          `Cannot ${status === "checked-in" ? "check in" : "accept"} this booking: the selected date and time overlaps with an existing checked-in booking (${overlappingNames}). Please resolve the conflict first.`,
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
          `The selected date and time is no longer available. It overlaps with a recently checked-in booking (${overlappingNames}). Please refresh and resolve the conflict.`,
          { overlappingBookings: finalOverlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
    }

    // Update booking status
    let updatedBooking
    try {
      updatedBooking = await updateBookingStatus(id, status, {
        changedBy: adminEmail,
        changeReason,
        adminNotes,
        proposedDate: proposedDate || undefined,
        depositVerifiedBy: shouldVerifyDeposit ? (typeof depositVerifiedBy === 'string' ? depositVerifiedBy.trim() : depositVerifiedBy) || adminEmail || undefined : undefined,
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
    // (e.g., "accepted" -> "checked-in" for previously checked-in bookings)
    // This ensures emails reflect the actual final status, not just what was requested
    const actualStatus = updatedBooking.status
    if (updatedBooking.responseToken || actualStatus !== "pending") {
      try {
        // Send response form link (responseToken) for:
        // - "checked-in": User can view reservation and propose new date
        // - "postponed": User can propose new date or cancel
        // - "accepted" and "pending_deposit": For deposit upload link only
        // - "paid_deposit": No links (just confirmation message)
        const tokenToUse = actualStatus === "checked-in" ? updatedBooking.responseToken : 
                          actualStatus === "postponed" ? updatedBooking.responseToken : // User can propose new date or cancel
                          (actualStatus === "accepted" || actualStatus === "pending_deposit") ? updatedBooking.responseToken : // For deposit upload link only
                          undefined
        
        // Skip duplicate check when admin postpones again (postponed -> postponed) to ensure user gets email
        const isAdminPostponingAgain = actualStatus === "postponed" && currentBooking.status === "postponed" && !updatedBooking.proposedDate
        
        // When admin postpones again, capture previous proposed dates and times before they were cleared
        let previousProposedDate: string | null = null
        let previousProposedEndDate: string | null = null
        let previousProposedStartTime: string | null = null
        let previousProposedEndTime: string | null = null
        if (isAdminPostponingAgain && currentBooking.proposedDate) {
          // CRITICAL: Convert date string (YYYY-MM-DD) or timestamp to date string in Bangkok timezone
          // Don't use toISOString() as it converts to UTC which can shift dates
          const { TZDate } = await import('@date-fns/tz')
          const { format } = await import('date-fns')
          const BANGKOK_TIMEZONE = 'Asia/Bangkok'
          const { createBangkokTimestamp } = await import('@/lib/timezone')
          
          const proposedDateValue = typeof currentBooking.proposedDate === 'number' 
            ? currentBooking.proposedDate 
            : createBangkokTimestamp(String(currentBooking.proposedDate))
          const utcDate = new Date(proposedDateValue * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          previousProposedDate = format(tzDate, 'yyyy-MM-dd')
          
          if (currentBooking.proposedEndDate) {
            const proposedEndDateValue = typeof currentBooking.proposedEndDate === 'number'
              ? currentBooking.proposedEndDate
              : createBangkokTimestamp(String(currentBooking.proposedEndDate))
            const utcEndDate = new Date(proposedEndDateValue * 1000)
            const tzEndDate = new TZDate(utcEndDate.getTime(), BANGKOK_TIMEZONE)
            previousProposedEndDate = format(tzEndDate, 'yyyy-MM-dd')
          }
          
          // Parse times from user_response if available
          if (currentBooking.userResponse) {
            const startTimeMatch = currentBooking.userResponse.match(/Start Time: ([^,)]+)/)
            const endTimeMatch = currentBooking.userResponse.match(/End Time: ([^,)]+)/)
            if (startTimeMatch) {
              previousProposedStartTime = startTimeMatch[1].trim()
            }
            if (endTimeMatch) {
              previousProposedEndTime = endTimeMatch[1].trim()
            }
          }
        }
        
        // When admin accepts a proposed date, the proposed dates are moved to actual dates
        // So we need to check if this was an acceptance of a user's proposal
        const wasProposalAccepted = Boolean(
          (status === "accepted" || actualStatus === "accepted" || actualStatus === "checked-in" || actualStatus === "paid_deposit") && 
          currentBooking.status === "postponed" && 
          currentBooking.proposedDate
        )
        
        // If accepting a proposal, provide a clear confirmation message about the date change
        let finalChangeReason = changeReason
        if (wasProposalAccepted && !changeReason) {
          finalChangeReason = "Your proposed date has been accepted and confirmed. The reservation details below reflect your new confirmed date."
        } else if (wasProposalAccepted && changeReason) {
          finalChangeReason = `${changeReason}\n\nYour proposed date has been accepted and confirmed. The reservation details below reflect your new confirmed date.`
        }
        
        await sendBookingStatusNotification(updatedBooking, actualStatus, {
          changeReason: finalChangeReason,
          proposedDate: updatedBooking.proposedDate, // This will be null after acceptance, but we pass it anyway
          responseToken: tokenToUse,
          previousProposedDate: previousProposedDate,
          previousProposedEndDate: previousProposedEndDate,
          previousProposedStartTime: previousProposedStartTime,
          previousProposedEndTime: previousProposedEndTime,
          skipDuplicateCheck: isAdminPostponingAgain || wasProposalAccepted, // Skip duplicate check for admin postpone again OR when accepting a proposal
        })
        await logger.info(`Booking status notification email sent successfully`, { bookingId: id, actualStatus, requestedStatus: status, hasToken: !!tokenToUse, skipDuplicate: isAdminPostponingAgain || wasProposalAccepted, wasProposalAccepted })
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
    
    const authError = await checkAuth()
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
    // Only send if booking was not already rejected, cancelled, or finished
    if (
      booking.status !== "rejected" &&
      booking.status !== "cancelled" &&
      booking.status !== "finished"
    ) {
      try {
        // For all active bookings (accepted, checked-in, pending, postponed), send cancellation notification
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

