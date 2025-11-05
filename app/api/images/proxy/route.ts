import { NextResponse } from "next/server"

/**
 * Image Proxy Route
 * 
 * Downloads images from BFL delivery URLs and serves them through our own infrastructure.
 * This addresses the following BFL requirements:
 * - Delivery URLs expire after 10 minutes
 * - No CORS support on delivery URLs
 * - Images should be downloaded and re-served from your own infrastructure
 * 
 * Reference: https://docs.bfl.ai/api_integration/integration_guidelines#recommended-image-handling
 * 
 * Note: This route requires a server environment. For static export deployments,
 * consider using a separate service or cloud function for image proxying.
 */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image URL parameter is required" },
        { status: 400 }
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
      return NextResponse.json(
        { error: "Invalid image source domain" },
        { status: 400 }
      )
    }

    // Download image from BFL delivery URL
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${imageResponse.statusText}` },
        { status: imageResponse.status }
      )
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'

    // Return image with proper headers
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
        'Access-Control-Allow-Origin': '*', // Enable CORS
      },
    })
  } catch (error) {
    console.error('Image proxy error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
