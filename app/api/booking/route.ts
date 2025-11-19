import { NextResponse } from "next/server"
import { verifyEmailConfig } from "@/lib/email"
import { createBookingWithEmailStatus } from "@/lib/booking-email-status"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { checkBookingOverlap } from "@/lib/booking-validations"
import { validateBookingData } from "@/lib/input-validation"
import { createRequestLogger, withLogging } from "@/lib/logger"
import { withErrorHandling, successResponse, validationErrorResponse, errorResponse, ErrorCodes, type ApiResponse } from "@/lib/api-response"
import { withRateLimit, getRateLimitOptions } from "@/lib/rate-limit-middleware"
import { getTursoClient } from "@/lib/turso"

// Helper function to get client IP address
function getClientIP(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  const realIP = request.headers.get("x-real-ip")
  const cfConnectingIP = request.headers.get("cf-connecting-ip") // Cloudflare

  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim()
  }

  if (realIP) {
    return realIP
  }

  if (cfConnectingIP) {
    return cfConnectingIP
  }

  return null
}

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(async (): Promise<NextResponse<ApiResponse>> => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/booking')
    
    await logger.info('Booking request received')
    
    // Check if bookings are enabled
    let bookingsEnabled = true
    try {
      const db = getTursoClient()
      
      // Check if settings table exists
      const tableCheck = await db.execute({
        sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
        args: [],
      })

      if (tableCheck.rows.length > 0) {
        // Table exists, check the setting
        const settingsResult = await db.execute({
          sql: `SELECT value FROM settings WHERE key = 'bookings_enabled'`,
          args: [],
        })

        if (settingsResult.rows.length > 0) {
          const setting = settingsResult.rows[0] as any
          bookingsEnabled = setting.value === '1' || setting.value === 1 || setting.value === true
        }
      }
      // If table doesn't exist, default to enabled (allow bookings)
    } catch (error) {
      // If there's any error checking settings, default to enabled
      await logger.warn('Error checking booking enabled status, defaulting to enabled', error instanceof Error ? error : new Error(String(error)))
      bookingsEnabled = true
    }

    if (!bookingsEnabled) {
      await logger.warn('Booking request rejected: bookings are disabled')
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Booking submissions are currently disabled. Please contact us directly or try again later.',
        undefined,
        503,
        { requestId }
      )
    }
    
    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 1048576) // 1MB limit for booking data
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
    
    const { token, ...bookingData } = body

    // Check rate limit (using middleware)
    const rateLimit = await withRateLimit(request, getRateLimitOptions('booking'))
    if (!rateLimit.allowed && rateLimit.response) {
      await logger.warn('Rate limit exceeded')
      return rateLimit.response as NextResponse<ApiResponse>
    }
    
    // Validate reCAPTCHA token
    if (!token) {
      await logger.warn('reCAPTCHA token missing')
      return validationErrorResponse(['reCAPTCHA token is required'], { requestId })
    }

    const secretKey = process.env.RECAPTCHA_SECRET_KEY

    if (!secretKey) {
      await logger.error('RECAPTCHA_SECRET_KEY not configured', new Error('RECAPTCHA_SECRET_KEY is not set'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        'Server configuration error',
        undefined,
        500,
        { requestId }
      )
    }

    // Get client IP address for verification
    const remoteip = getClientIP(request)

    // Verify token with Google reCAPTCHA API
    const params = new URLSearchParams()
    params.append("secret", secretKey)
    params.append("response", token)
    if (remoteip) {
      params.append("remoteip", remoteip)
    }

    const recaptchaResponse = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    )

    // Check if HTTP response is OK
    if (!recaptchaResponse.ok) {
      const errorText = await recaptchaResponse.text()
      await logger.error('reCAPTCHA API HTTP error', new Error(`HTTP ${recaptchaResponse.status}: ${recaptchaResponse.statusText}`))
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'reCAPTCHA verification service error',
        `HTTP ${recaptchaResponse.status}: ${recaptchaResponse.statusText}`,
        500,
        { requestId }
      )
    }

    // Parse JSON response
    let recaptchaData: any
    try {
      recaptchaData = await recaptchaResponse.json()
    } catch (jsonError) {
      await logger.error('Failed to parse reCAPTCHA response', jsonError instanceof Error ? jsonError : new Error(String(jsonError)))
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Invalid response from verification service',
        undefined,
        500,
        { requestId }
      )
    }

    // Validate response structure and success field
    if (!recaptchaData || typeof recaptchaData.success !== "boolean") {
      await logger.error('Invalid reCAPTCHA response structure')
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Invalid verification response',
        undefined,
        500,
        { requestId }
      )
    }

    // Check if verification was successful
    if (!recaptchaData.success) {
      await logger.warn('reCAPTCHA verification failed', { errorCodes: recaptchaData["error-codes"] || [] })
      return validationErrorResponse(
        ['reCAPTCHA verification failed'],
        { requestId, errorCodes: recaptchaData["error-codes"] || [] }
      )
    }

    // Validate booking data using comprehensive validation
    const validation = validateBookingData(bookingData)
    if (!validation.valid) {
      await logger.warn('Booking validation failed', { errors: validation.errors })
      return validationErrorResponse(validation.errors, { requestId })
    }

    // Use sanitized data from validation
    const sanitizedData = validation.sanitized!

    // Verify email configuration first
    const emailConfigCheck = verifyEmailConfig()
    if (!emailConfigCheck.valid) {
      await logger.error('Email service not configured', new Error('Email configuration invalid'))
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Email service is not configured. Please contact support.',
        emailConfigCheck.errors,
        500,
        { requestId }
      )
    }

    // Check for booking overlaps with checked-in bookings
    // Use timezone library to properly convert Bangkok timezone dates to timestamps
    const { createBangkokTimestamp, getBangkokTime, getBangkokDateString } = await import('@/lib/timezone')
    const { calculateStartTimestamp } = await import('@/lib/booking-validations')
    
    // CRITICAL: Calculate timestamps correctly (date + time)
    // Pattern: createBangkokTimestamp(dateString, null) then calculateStartTimestamp(timestamp, timeString)
    const startDateTimestamp = createBangkokTimestamp(sanitizedData.startDate, null)
    const startTimestamp = calculateStartTimestamp(
      startDateTimestamp,
      sanitizedData.startTime || null
    )
    
    let endTimestamp: number
    if (sanitizedData.endDate) {
      const endDateTimestamp = createBangkokTimestamp(sanitizedData.endDate, null)
      if (sanitizedData.endTime) {
        // Multi-day booking: calculate end timestamp from end_date + end_time
        // Parse time string locally (parseTimeString is not exported from booking-validations)
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
        const { TZDate } = await import('@date-fns/tz')
        const BANGKOK_TIMEZONE = 'Asia/Bangkok'
        const parsed = parseTime(sanitizedData.endTime)
        if (parsed) {
          try {
            const utcDate = new Date(endDateTimestamp * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            endTimestamp = endDateTimestamp
          }
        } else {
          endTimestamp = endDateTimestamp
        }
      } else {
        endTimestamp = endDateTimestamp
      }
    } else {
      // Single-day booking: calculate end timestamp from start_date + end_time
      endTimestamp = calculateStartTimestamp(
        startDateTimestamp,
        sanitizedData.endTime || null
      )
    }
    
    // CRITICAL: Validate that end timestamp > start timestamp (accounts for dates + times)
    // This catches edge cases like: same date but invalid times, or dates valid but times make it invalid
    if (endTimestamp <= startTimestamp) {
      await logger.warn('Booking rejected: end timestamp is not after start timestamp', {
        startTimestamp,
        endTimestamp,
        startDate: sanitizedData.startDate,
        endDate: sanitizedData.endDate,
        startTime: sanitizedData.startTime,
        endTime: sanitizedData.endTime
      })
      return errorResponse(
        ErrorCodes.INVALID_INPUT,
        'The booking end date and time must be after the start date and time.',
        {},
        400,
        { requestId }
      )
    }
    
    // Validate that start date is not today (users cannot book current date)
    const now = getBangkokTime()
    const todayDateStr = getBangkokDateString()
    if (sanitizedData.startDate === todayDateStr) {
      await logger.warn('Booking attempt for today rejected', { startDate: sanitizedData.startDate })
      return errorResponse(
        ErrorCodes.INVALID_INPUT,
        'Start date cannot be today. Please select a future date.',
        {},
        400,
        { requestId }
      )
    }
    
    // Validate that start date is in the future
    if (startTimestamp <= now) {
      await logger.warn('Booking attempt for past date rejected', { startDate: sanitizedData.startDate, startTimestamp, now })
      return errorResponse(
        ErrorCodes.INVALID_INPUT,
        'Start date must be in the future. Please select a future date.',
        {},
        400,
        { requestId }
      )
    }
    
    const overlapCheck = await checkBookingOverlap(
      null, // New booking
      startDateTimestamp, // Pass date timestamp (without time) - checkBookingOverlap will add time
      sanitizedData.endDate ? createBangkokTimestamp(sanitizedData.endDate, null) : null,
      sanitizedData.startTime || null,
      sanitizedData.endTime || null
    )
    
    if (overlapCheck.overlaps) {
      const overlappingNames = overlapCheck.overlappingBookings
        ?.map((b: any) => b.name || "Unknown")
        .join(", ") || "existing booking"
      await logger.warn('Booking overlap detected', { overlappingNames })
      return errorResponse(
        ErrorCodes.BOOKING_OVERLAP,
        `The selected date and time overlaps with an existing confirmed booking (${overlappingNames}). Please choose a different date or time.`,
        { overlappingBookings: overlapCheck.overlappingBookings },
        409,
        { requestId }
      )
    }
    
    // Note: Final overlap check is now performed WITHIN the transaction in createBookingWithEmailStatus
    // This prevents race conditions by ensuring the check and save are atomic
    
    // Prepare booking data for creation
    const bookingDataForCreation = {
      name: sanitizedData.name,
      email: sanitizedData.email,
      phone: sanitizedData.phone,
      participants: sanitizedData.participants,
      eventType: sanitizedData.eventType,
      otherEventType: sanitizedData.otherEventType,
      dateRange: !!sanitizedData.endDate,
      startDate: sanitizedData.startDate,
      endDate: sanitizedData.endDate,
      startTime: sanitizedData.startTime,
      endTime: sanitizedData.endTime,
      organizationType: (bookingData.organizationType as "Tailor Event" | "Space Only" | "" | undefined) || undefined,
      introduction: sanitizedData.introduction,
      biography: sanitizedData.biography,
      specialRequests: sanitizedData.specialRequests,
    }
    
    // Generate reference number (same logic as createBooking)
    // IMPROVED: Increased capacity from 60M to 2.2B combinations
    // Format: HU-XXXXXX (3 chars timestamp + 3 chars random)
    const generateBookingReference = () => {
      const timestamp = Math.floor(Date.now() / 1000)
      const randomBytes = require('crypto').randomBytes(4)
      const randomValue = parseInt(randomBytes.toString('hex'), 16)
      const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
      const randomPart = (randomValue % 46656).toString(36).toUpperCase().padStart(3, '0')
      return `HU-${timestampPart}${randomPart}`
    }
    const tempReferenceNumber = generateBookingReference()
    
    // TRANSACTIONAL: Save booking first, then send emails
    // If database saves but emails fail → emails queued for retry (booking exists)
    // If database fails → no emails sent (transaction rollback)
    await logger.info('Creating booking with transactional email sending', {
      referenceNumber: tempReferenceNumber
    })
    
    const bookingResult = await createBookingWithEmailStatus(
      bookingDataForCreation,
      tempReferenceNumber,
      requestId
    )
    
    // Check result
    if (!bookingResult.success) {
      await logger.error(
        'Booking creation failed',
        bookingResult.error ? new Error(bookingResult.error) : undefined,
        {
          error: bookingResult.error,
          emailErrors: bookingResult.emailStatus?.errors
        }
      )
      
      // Database failed - return error (no emails sent)
      return errorResponse(
        ErrorCodes.DATABASE_ERROR,
        bookingResult.error || 'Failed to create booking',
        undefined,
        500,
        { requestId }
      )
    }
    
    // Success - booking exists (emails may be queued for retry)
    await logger.info('Booking created successfully with transactional emails', {
      bookingId: bookingResult.bookingId,
      referenceNumber: bookingResult.referenceNumber,
      emailStatus: bookingResult.emailStatus
    })
    
    // Determine success message based on email status
    let successMessage = 'Booking created successfully. Confirmation emails have been sent.'
    if (bookingResult.emailStatus?.queued) {
      if (!bookingResult.emailStatus.adminSent || !bookingResult.emailStatus.userSent) {
        successMessage = 'Booking created successfully. Confirmation emails are being processed and will be sent shortly.'
      }
    }
    
    // Return success response with email status
    return successResponse(
      {
        bookingId: bookingResult.bookingId,
        referenceNumber: bookingResult.referenceNumber,
        message: successMessage,
        emailStatus: bookingResult.emailStatus,
      },
      { requestId }
    )
  }, { endpoint: '/api/booking' })
}

