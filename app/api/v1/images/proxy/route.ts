/**
 * Image Proxy API v1
 * 
 * Versioned endpoint for image proxying
 * 
 * Downloads images from BFL delivery URLs and serves them through our own infrastructure.
 * This addresses the following BFL requirements:
 * - Delivery URLs expire after 10 minutes
 * - No CORS support on delivery URLs
 * - Images should be downloaded and re-served from your own infrastructure
 * 
 * Reference: https://docs.bfl.ai/api_integration/integration_guidelines#recommended-image-handling
 */

import { NextResponse } from "next/server"
import { createRequestLogger } from "@/lib/logger"
import { errorResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  try {
    await logger.info('Image proxy request received')
    
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')

    if (!imageUrl) {
      await logger.warn('Image proxy rejected: missing URL parameter')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Image URL parameter is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate that the URL is from BFL delivery domains
    const allowedDomains = [
      'delivery-eu1.bfl.ai',
      'delivery-us1.bfl.ai',
      'delivery-eu.bfl.ai',
      'delivery-us.bfl.ai',
    ]

    const urlObj = new URL(imageUrl)
    if (!allowedDomains.includes(urlObj.hostname)) {
      await logger.warn('Image proxy rejected: invalid domain', { hostname: urlObj.hostname })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid image source domain",
        undefined,
        400,
        { requestId }
      )
    }

    await logger.debug('Proxying image', { imageUrl: imageUrl.substring(0, 50) + '...' })

    // Download image from BFL delivery URL
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!imageResponse.ok) {
      await logger.error('Failed to fetch image from BFL', new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`), {
        status: imageResponse.status,
        statusText: imageResponse.statusText
      })
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        `Failed to fetch image: ${imageResponse.statusText}`,
        undefined,
        imageResponse.status,
        { requestId }
      )
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
    
    await logger.info('Image proxied successfully', {
      contentType,
      size: imageBuffer.byteLength
    })

    // Return image with proper headers
    // Note: This returns binary data, not JSON, so we use NextResponse directly
    // but we still log the request for tracking
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
        'Access-Control-Allow-Origin': '*', // Enable CORS
        'X-Request-ID': requestId, // Include request ID in headers for tracking
      },
    })
  } catch (error) {
    await logger.error('Error proxying image',
      error instanceof Error ? error : new Error(String(error)),
      { endpoint }
    )
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to proxy image',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
})

