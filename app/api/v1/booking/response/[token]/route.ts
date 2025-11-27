/**
 * Booking Response API v1
 * 
 * Versioned endpoint for user booking responses
 * 
 * GET /api/v1/booking/response/[token] - Get booking details by token
 * POST /api/v1/booking/response/[token] - Submit user response
 * - Public endpoints (authenticated by token)
 */

import { NextResponse } from "next/server"
import { getBookingByToken, submitUserResponse } from "@/lib/bookings"
import { sendAdminUserResponseNotification, sendBookingStatusNotification } from "@/lib/email"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) => {
  return withErrorHandling(async () => {
    const { token } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
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
        // Check token expiration with 5-minute grace period (matches getBookingByToken logic)
        const TOKEN_GRACE_PERIOD = 5 * 60 // 5 minutes in seconds
        const effectiveExpirationTime = bookingRow.token_expires_at 
          ? bookingRow.token_expires_at + TOKEN_GRACE_PERIOD 
          : null
        
        if (effectiveExpirationTime && now > effectiveExpirationTime) {
          // CRITICAL: Format timestamp in Bangkok timezone for logging
          const { TZDate } = await import('@date-fns/tz')
          const { format } = await import('date-fns')
          const BANGKOK_TIMEZONE = 'Asia/Bangkok'
          const expiredDate = new TZDate(bookingRow.token_expires_at * 1000, BANGKOK_TIMEZONE)
          const expiredAtStr = format(expiredDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
          
          await logger.warn('Get booking by token failed: token expired (after grace period)', { 
            tokenPrefix: token.substring(0, 8) + '...',
            bookingId: bookingRow.id,
            status: bookingRow.status,
            expiredAt: expiredAtStr,
            gracePeriod: TOKEN_GRACE_PERIOD
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
  }, { endpoint: getRequestPath(request) })
})

export const POST = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) => {
  return withErrorHandling(async () => {
    const { token } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('User response request received', { tokenPrefix: token.substring(0, 8) + '...' })
    
    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 512000) // 500KB limit for user response data
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
    const { response, message } = body
    
    await logger.debug('User response data parsed', { 
      response,
      hasMessage: !!message
    })

    // Validate response type
    // NOTE: Only "cancel" is supported in the current booking flow
    // Legacy responses ("accept", "propose", "check-in") have been removed
    if (!response || response !== "cancel") {
      await logger.warn('User response rejected: invalid response type', { response })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid response. Only 'cancel' is supported.",
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
        // Check token expiration with 5-minute grace period (matches getBookingByToken logic)
        // This allows users who are mid-submission to complete their action
        const TOKEN_GRACE_PERIOD = 5 * 60 // 5 minutes in seconds
        const effectiveExpirationTime = bookingRow.token_expires_at 
          ? bookingRow.token_expires_at + TOKEN_GRACE_PERIOD 
          : null
        
        if (effectiveExpirationTime && now > effectiveExpirationTime) {
          await logger.warn('User response rejected: token expired (after grace period)', { 
            tokenPrefix: token.substring(0, 8) + '...',
            bookingId: bookingRow.id,
            status: bookingRow.status,
            expiredAt: bookingRow.token_expires_at,
            now,
            gracePeriod: TOKEN_GRACE_PERIOD
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

    // NOTE: "propose" response handling has been removed
    // Only "cancel" is supported in the current booking flow

    // CRITICAL: Re-validate token before database update
    // This prevents token expiration during long validation/processing operations
    // Re-fetch booking to get latest token expiration
    const { getBookingById } = await import("@/lib/bookings")
    const latestBooking = await getBookingById(booking.id)
    
    if (!latestBooking) {
      await logger.error('Booking not found before user response submission', new Error('Booking not found'), { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Booking not found. Please refresh and try again.",
        undefined,
        404,
        { requestId }
      )
    }
    
    try {
      const { revalidateTokenBeforeOperation } = await import("@/lib/token-validation")
      revalidateTokenBeforeOperation(latestBooking, "user_response", false) // false = use standard grace period
      await logger.info('Token re-validated before user response submission', { bookingId: booking.id })
    } catch (tokenError) {
      await logger.warn('Token expired during user response operation', {
        bookingId: booking.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError)
      })
      return errorResponse(
        ErrorCodes.TOKEN_EXPIRED,
        "Your session expired during the submission process. Please refresh and try again, or contact support for a new link.",
        undefined,
        410, // 410 Gone
        { requestId }
      )
    }

    // Submit user response (only "cancel" is supported)
    await logger.info('Submitting user response', { bookingId: booking.id, response })
    let updatedBooking
    try {
      updatedBooking = await submitUserResponse(booking.id, response, {
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

    // Send user confirmation email when they cancel
    if (response === "cancel") {
      try {
        // Note: "checked-in" is not a valid status in the current booking status type
        // All bookings that can be cancelled are in: pending, pending_deposit, paid_deposit, confirmed
        const changeReason = "Your booking cancellation has been confirmed. We're sorry to see you go, but we understand that plans can change."
        
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

    // Send admin notification for user cancellation
    try {
      await sendAdminUserResponseNotification(updatedBooking, response, {
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
  }, { endpoint: getRequestPath(request) })
})
