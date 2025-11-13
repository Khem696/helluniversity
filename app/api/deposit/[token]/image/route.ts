import { NextResponse } from "next/server"
import { getBookingByToken } from "@/lib/bookings"
import { createRequestLogger } from "@/lib/logger"
import { errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Deposit Image Proxy (User Access)
 * 
 * GET /api/deposit/[token]/image
 * - Validates booking token
 * - Streams deposit evidence image securely
 * - Only accessible to users with valid token
 * 
 * This endpoint provides secure access to deposit images by validating
 * the booking token before serving the image.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const requestId = crypto.randomUUID()
  const logger = createRequestLogger(requestId, '/api/deposit/[token]/image')
  
  try {
    await logger.info('Deposit image proxy request received', { 
      tokenPrefix: token.substring(0, 8) + '...' 
    })
    
    // Get booking by token (validates token and expiration)
    const booking = await getBookingByToken(token)
    
    if (!booking) {
      await logger.warn('Deposit image proxy rejected: invalid or expired token', {
        tokenPrefix: token.substring(0, 8) + '...'
      })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Invalid or expired token",
        undefined,
        404,
        { requestId }
      )
    }
    
    // Check if deposit evidence exists
    if (!booking.depositEvidenceUrl) {
      await logger.warn('Deposit image proxy rejected: no deposit evidence', {
        bookingId: booking.id,
        tokenPrefix: token.substring(0, 8) + '...'
      })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Deposit evidence not found",
        undefined,
        404,
        { requestId }
      )
    }
    
    await logger.info('Fetching deposit image', {
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
    
    await logger.info('Deposit image proxied successfully', {
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
    await logger.error('Error proxying deposit image',
      error instanceof Error ? error : new Error(String(error)),
      { tokenPrefix: token.substring(0, 8) + '...' }
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

