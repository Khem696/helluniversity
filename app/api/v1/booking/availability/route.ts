/**
 * Booking Availability API v1
 * 
 * Versioned endpoint for booking availability checks
 * 
 * GET /api/v1/booking/availability?bookingId=xxx
 * - Returns unavailable dates and time ranges for calendar
 * - Public endpoint (no authentication required)
 * - Only includes checked-in bookings (these occupy time)
 * - If bookingId is provided, excludes that booking's dates (allows users to select their own original dates)
 */

import { NextResponse } from "next/server"
import { getUnavailableDates } from "@/lib/booking-validations"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    // Extract bookingId from query parameters if provided
    const { searchParams } = new URL(request.url)
    const bookingId = searchParams.get('bookingId') || null
    
    await logger.info('Booking availability request received', { bookingId: bookingId || 'none' })
    
    const availability = await getUnavailableDates(bookingId)
    
    await logger.info('Booking availability retrieved', {
      unavailableDatesCount: availability.unavailableDates.length,
      unavailableTimeRangesCount: availability.unavailableTimeRanges.length,
      excludedBookingId: bookingId || 'none',
      unavailableDates: availability.unavailableDates.slice(0, 20) // Log first 20 dates for debugging
    })

    return successResponse(
      {
        unavailableDates: availability.unavailableDates,
        unavailableTimeRanges: availability.unavailableTimeRanges,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

