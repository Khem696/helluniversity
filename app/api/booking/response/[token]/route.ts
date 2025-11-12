import { NextResponse } from "next/server"
import { getBookingByToken, submitUserResponse } from "@/lib/bookings"
import { sendAdminUserResponseNotification, sendBookingStatusNotification } from "@/lib/email"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * User Booking Response API
 * 
 * GET /api/booking/response/[token] - Get booking details by token
 * POST /api/booking/response/[token] - Submit user response
 * - Public endpoints (authenticated by token)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  return withErrorHandling(async () => {
    const { token } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/booking/response')
    
    await logger.info('Get booking by token request', { tokenPrefix: token.substring(0, 8) + '...' })
    
    const booking = await getBookingByToken(token)

    if (!booking) {
      // Check if booking exists but token is missing/expired for better diagnostics
      const db = (await import("@/lib/turso")).getTursoClient()
      const { getBangkokTime } = await import("@/lib/timezone")
      const now = getBangkokTime()
      
      // Check if any booking has this token (even if expired)
      const tokenCheck = await db.execute({
        sql: "SELECT id, status, response_token, token_expires_at FROM bookings WHERE response_token = ?",
        args: [token],
      })
      
      if (tokenCheck.rows.length > 0) {
        const bookingRow = tokenCheck.rows[0] as any
        if (bookingRow.token_expires_at && bookingRow.token_expires_at < now) {
          // CRITICAL: Format timestamp in Bangkok timezone for logging
          const { TZDate } = await import('@date-fns/tz')
          const { format } = await import('date-fns')
          const BANGKOK_TIMEZONE = 'Asia/Bangkok'
          const expiredDate = new TZDate(bookingRow.token_expires_at * 1000, BANGKOK_TIMEZONE)
          const expiredAtStr = format(expiredDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
          
          await logger.warn('Get booking by token failed: token expired', { 
            tokenPrefix: token.substring(0, 8) + '...',
            bookingId: bookingRow.id,
            status: bookingRow.status,
            expiredAt: expiredAtStr
          })
          return errorResponse(
            ErrorCodes.TOKEN_EXPIRED,
            "This link has expired. Please contact us to receive a new deposit upload link.",
            undefined,
            410, // 410 Gone - resource existed but is no longer available
            { requestId }
          )
        }
      }
      
      await logger.warn('Get booking by token failed: token not found', { 
        tokenPrefix: token.substring(0, 8) + '...',
        tokenExists: tokenCheck.rows.length > 0
      })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "We couldn't find your reservation. Please check the link in your email or contact us for assistance.",
        undefined,
        404,
        { requestId }
      )
    }

    await logger.info('Booking retrieved by token', { bookingId: booking.id, status: booking.status })
    
    // Return booking details (without sensitive admin info)
    return successResponse(
      {
        booking: {
          id: booking.id,
          name: booking.name,
          email: booking.email,
          eventType: booking.eventType,
          otherEventType: booking.otherEventType,
          startDate: booking.startDate,
          endDate: booking.endDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          proposedDate: booking.proposedDate,
          proposedEndDate: booking.proposedEndDate,
          userResponse: booking.userResponse,
          depositEvidenceUrl: booking.depositEvidenceUrl,
        },
      },
      { requestId }
    )
  }, { endpoint: '/api/booking/response' })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  return withErrorHandling(async () => {
    const { token } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/booking/response')
    
    await logger.info('User response request received', { tokenPrefix: token.substring(0, 8) + '...' })
    
    const body = await request.json()
    let { response, proposedDate, proposedEndDate, proposedStartTime, proposedEndTime, message } = body
    
    // Extract date part from ISO strings if needed (frontend sends ISO strings)
    if (proposedDate && proposedDate.includes('T')) {
      proposedDate = proposedDate.split('T')[0]
    }
    if (proposedEndDate && proposedEndDate.includes('T')) {
      proposedEndDate = proposedEndDate.split('T')[0]
    }
    
    await logger.debug('User response data parsed', { 
      response,
      hasProposedDate: !!proposedDate,
      hasMessage: !!message
    })

    // Validate response type
    if (!response || !["accept", "propose", "cancel"].includes(response)) {
      await logger.warn('User response rejected: invalid response type', { response })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid response. Must be: accept, propose, or cancel",
        undefined,
        400,
        { requestId }
      )
    }

    // Get booking by token
    const booking = await getBookingByToken(token)
    if (!booking) {
      // Check if booking exists but token is missing/expired for better diagnostics
      const db = (await import("@/lib/turso")).getTursoClient()
      const { getBangkokTime } = await import("@/lib/timezone")
      const now = getBangkokTime()
      
      // Check if any booking has this token (even if expired)
      const tokenCheck = await db.execute({
        sql: "SELECT id, status, response_token, token_expires_at FROM bookings WHERE response_token = ?",
        args: [token],
      })
      
      if (tokenCheck.rows.length > 0) {
        const bookingRow = tokenCheck.rows[0] as any
        if (bookingRow.token_expires_at && bookingRow.token_expires_at < now) {
          await logger.warn('User response rejected: token expired', { 
            tokenPrefix: token.substring(0, 8) + '...',
            bookingId: bookingRow.id,
            status: bookingRow.status
          })
          return errorResponse(
            ErrorCodes.TOKEN_EXPIRED,
            "This link has expired. Please contact us to receive a new response link.",
            undefined,
            410,
            { requestId }
          )
        }
      }
      
      await logger.warn('User response rejected: token not found', { tokenPrefix: token.substring(0, 8) + '...' })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "We couldn't find your reservation. Please check the link in your email or contact us for assistance.",
        undefined,
        404,
        { requestId }
      )
    }
    
    await logger.info('Booking found for user response', { bookingId: booking.id, currentStatus: booking.status })

    // Validate email matches (extra security)
    const emailHeader = request.headers.get("x-user-email")
    if (emailHeader && emailHeader !== booking.email) {
      await logger.warn('User response rejected: email mismatch', { 
        bookingId: booking.id,
        bookingEmail: booking.email,
        headerEmail: emailHeader 
      })
      return errorResponse(
        ErrorCodes.FORBIDDEN,
        "Email mismatch",
        undefined,
        403,
        { requestId }
      )
    }

    // Validate proposed date if response is "propose"
    if (response === "propose" && !proposedDate) {
      await logger.warn('User response rejected: missing proposed date', { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "proposedDate is required when response is 'propose'",
        undefined,
        400,
        { requestId }
      )
    }

    // Check for overlaps if user is proposing a new date
    if (response === "propose" && proposedDate) {
      const { checkBookingOverlap } = await import('@/lib/booking-validations')
      const { createBangkokTimestamp, getBangkokTime, getBangkokDateString } = await import('@/lib/timezone')
      
      // Validate that proposed date is not today (users cannot propose current date)
      const now = getBangkokTime()
      const todayDateStr = getBangkokDateString()
      if (proposedDate === todayDateStr) {
        await logger.warn('Proposed date is today rejected', { bookingId: booking.id, proposedDate })
        return errorResponse(
          ErrorCodes.INVALID_INPUT,
          'Proposed date cannot be today. Please select a future date.',
          {},
          400,
          { requestId }
        )
      }
      
      const proposedStartTimestamp = createBangkokTimestamp(proposedDate, proposedStartTime || null)
      const proposedEndTimestamp = proposedEndDate
        ? createBangkokTimestamp(proposedEndDate, proposedEndTime || null)
        : null
      
      // Validate that proposed date is in the future
      if (proposedStartTimestamp <= now) {
        await logger.warn('Proposed date is in the past rejected', { bookingId: booking.id, proposedDate, proposedStartTimestamp, now })
        return errorResponse(
          ErrorCodes.INVALID_INPUT,
          'Proposed date must be in the future. Please select a future date.',
          {},
          400,
          { requestId }
        )
      }
      
      await logger.info('Checking overlap for proposed date', { 
        bookingId: booking.id,
        proposedDate,
        proposedEndDate 
      })
      
      const overlapCheck = await checkBookingOverlap(
        booking.id, // Exclude current booking from overlap check
        proposedStartTimestamp,
        proposedEndTimestamp,
        proposedStartTime || null,
        proposedEndTime || null
      )
      
      if (overlapCheck.overlaps) {
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Proposed date overlap detected', { 
          bookingId: booking.id,
          overlappingNames 
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `The proposed date and time overlaps with an existing checked-in booking (${overlappingNames}). Please choose a different date or time.`,
          { overlappingBookings: overlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
      
      // FINAL OVERLAP CHECK: Re-check right before submitting to prevent race conditions
      await logger.info('Performing final overlap check before submitting proposed date')
      const finalOverlapCheck = await checkBookingOverlap(
        booking.id,
        proposedStartTimestamp,
        proposedEndTimestamp,
        proposedStartTime || null,
        proposedEndTime || null
      )
      
      if (finalOverlapCheck.overlaps) {
        const overlappingNames = finalOverlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        await logger.warn('Final overlap check detected conflict - proposed date became unavailable', { 
          bookingId: booking.id,
          overlappingNames 
        })
        return errorResponse(
          ErrorCodes.BOOKING_OVERLAP,
          `The proposed date and time is no longer available. It overlaps with a recently checked-in booking (${overlappingNames}). Please refresh and choose a different date or time.`,
          { overlappingBookings: finalOverlapCheck.overlappingBookings },
          409,
          { requestId }
        )
      }
    }

    // Submit user response
    await logger.info('Submitting user response', { bookingId: booking.id, response })
    let updatedBooking
    try {
      updatedBooking = await submitUserResponse(booking.id, response, {
      proposedDate,
      proposedEndDate,
      proposedStartTime,
      proposedEndTime,
      message,
    })
    } catch (submitError) {
      // Catch validation errors from submitUserResponse and format them properly
      const errorMessage = submitError instanceof Error ? submitError.message : String(submitError)
      await logger.warn('User response submission failed', { 
        bookingId: booking.id, 
        response,
        error: errorMessage 
      })
      
      // Check if it's a validation error
      if (errorMessage.includes('cannot be') || 
          errorMessage.includes('must be') || 
          errorMessage.includes('should be') ||
          errorMessage.includes('Proposed date') ||
          errorMessage.includes('proposed date') ||
          errorMessage.includes('Invalid')) {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          errorMessage,
          undefined,
          400,
          { requestId }
        )
      }
      
      // Re-throw other errors to be handled by withErrorHandling
      throw submitError
    }
    
    await logger.info('User response submitted successfully', { 
      bookingId: booking.id,
      response,
      newStatus: updatedBooking.status
    })

    // Send user confirmation email when they propose a new date
    if (response === "propose") {
      try {
        // Skip duplicate check to ensure user gets confirmation email even if status was already postponed
        // Do NOT include responseToken - user will only get the link again when admin responds
        await sendBookingStatusNotification(updatedBooking, "postponed", {
          changeReason: "Your proposed date has been received. Our admin team will review your proposal and respond shortly.",
          proposedDate: proposedDate || null,
          proposedEndDate: proposedEndDate || null,
          proposedStartTime: proposedStartTime || null,
          proposedEndTime: proposedEndTime || null,
          responseToken: undefined, // No link - user will get link again when admin responds
          skipDuplicateCheck: true, // Skip duplicate check to ensure user always gets confirmation
        })
        await logger.info('User confirmation email sent for proposed date', { bookingId: booking.id })
      } catch (userEmailError) {
        await logger.error('Failed to send user confirmation email for proposed date', userEmailError instanceof Error ? userEmailError : new Error(String(userEmailError)))
        // Don't fail the request - email is secondary
      }
    }

    // Send user confirmation email when they cancel (especially important for checked-in bookings)
    if (response === "cancel") {
      try {
        const changeReason = booking.status === "checked-in" 
          ? "Your checked-in booking cancellation has been confirmed. We're sorry to see you go, but we understand that plans can change. Your booking has been successfully cancelled."
          : "Your booking cancellation has been confirmed. We're sorry to see you go, but we understand that plans can change."
        
        await sendBookingStatusNotification(updatedBooking, "cancelled", {
          changeReason: changeReason,
          skipDuplicateCheck: true, // Skip duplicate check to ensure user always gets confirmation
        })
        await logger.info('User confirmation email sent for cancellation', { 
          bookingId: booking.id, 
          previousStatus: booking.status,
          newStatus: updatedBooking.status 
        })
      } catch (userEmailError) {
        await logger.error('Failed to send user confirmation email for cancellation', userEmailError instanceof Error ? userEmailError : new Error(String(userEmailError)))
        // Don't fail the request - email is secondary
      }
    }

    // Send admin notification for user responses (propose, accept, cancel)
    try {
      await sendAdminUserResponseNotification(updatedBooking, response, {
        proposedDate,
        proposedEndDate,
        proposedStartTime,
        proposedEndTime,
        message,
      })
      await logger.info('Admin notification sent for user response', { bookingId: booking.id, response })
    } catch (adminEmailError) {
      await logger.error('Failed to send admin notification for user response', adminEmailError instanceof Error ? adminEmailError : new Error(String(adminEmailError)))
      // Don't fail the request - email is secondary
    }

    return successResponse(
      {
        message: "Your response has been submitted successfully",
        booking: {
          id: updatedBooking.id,
          status: updatedBooking.status,
          userResponse: updatedBooking.userResponse,
        },
      },
      { requestId }
    )
  }, { endpoint: '/api/booking/response' })
}

