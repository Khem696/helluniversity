/**
 * Admin Deposit Image API v1
 * 
 * Versioned endpoint for admin deposit image access
 * Maintains backward compatibility with /api/admin/deposit/[bookingId]/image
 * 
 * GET /api/v1/admin/deposit/[bookingId]/image - Get deposit image
 */

import { NextResponse } from "next/server"
import { getBookingById } from "@/lib/bookings"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { errorResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, ErrorCodes } from "@/lib/api-response"

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
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params
  const requestId = crypto.randomUUID()
  const logger = createRequestLogger(requestId, '/api/v1/admin/deposit/[bookingId]/image')
  
  try {
    await logger.info('Admin deposit image proxy request received', { bookingId })
    
    // Check authentication
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin deposit image proxy rejected: authentication failed', { bookingId })
      return authError
    }
    
    // Get booking
    const booking = await getBookingById(bookingId)
    
    if (!booking) {
      await logger.warn('Admin deposit image proxy rejected: booking not found', { bookingId })
      return notFoundResponse('Booking', { requestId })
    }
    
    // Check if deposit evidence exists
    if (!booking.depositEvidenceUrl) {
      await logger.warn('Admin deposit image proxy rejected: no deposit evidence', { bookingId })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Deposit evidence not found for this booking",
        undefined,
        404,
        { requestId }
      )
    }
    
    await logger.info('Fetching deposit image for admin', {
      bookingId: booking.id,
      blobUrl: booking.depositEvidenceUrl.substring(0, 50) + '...'
    })
    
    // Fetch image from blob storage
    const imageResponse = await fetch(booking.depositEvidenceUrl, {
      headers: {
        'User-Agent': 'HellUniversity-Reservation-System/1.0',
      },
    })
    
    if (!imageResponse.ok) {
      await logger.error('Failed to fetch deposit image from blob storage', 
        new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`),
        {
          bookingId: booking.id,
          blobUrl: booking.depositEvidenceUrl,
          status: imageResponse.status,
          statusText: imageResponse.statusText
        }
      )
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        `Failed to fetch deposit image: ${imageResponse.statusText}`,
        undefined,
        imageResponse.status,
        { requestId }
      )
    }
    
    const imageBuffer = await imageResponse.arrayBuffer()
    const contentType = imageResponse.headers.get('content-type') || 'image/webp'
    
    await logger.info('Deposit image proxied successfully for admin', {
      bookingId: booking.id,
      contentType,
      size: imageBuffer.byteLength
    })
    
    // Return image with proper headers
    // Note: Cache for shorter duration since these are sensitive documents
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour, private only
        'X-Request-ID': requestId,
        // Security headers
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    })
  } catch (error) {
    await logger.error('Error proxying deposit image for admin',
      error instanceof Error ? error : new Error(String(error)),
      { bookingId }
    )
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to retrieve deposit image',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
}

