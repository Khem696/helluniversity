/**
 * Image Optimization API v1
 * 
 * Versioned endpoint for image optimization
 * Maintains backward compatibility with /api/images/optimize
 * 
 * POST /api/v1/images/optimize - Optimize image
 */

import { NextResponse } from "next/server"
import sharp from "sharp"
import { readFile } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Image Optimization API Route
 * 
 * Resizes and optimizes images for thumbnail display in the carousel.
 * This significantly reduces file size and improves scrolling performance.
 * 
 * Query parameters:
 * - path: Image path relative to public directory (e.g., /aispaces/studio/IMG_1067.JPG)
 * - w: Width in pixels (default: 280)
 * - h: Height in pixels (default: 280)
 * - q: Quality 1-100 (default: 80)
 * - format: Output format 'webp' | 'jpeg' | 'png' (default: 'webp')
 */

const CACHE_MAX_AGE = 31536000 // 1 year in seconds
const MAX_DIMENSION = 1000 // Maximum dimension to prevent abuse

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  try {
    await logger.info('Image optimization request received')
    
    const { searchParams } = new URL(request.url)
    const imagePath = searchParams.get("path")
    const width = parseInt(searchParams.get("w") || "280")
    const height = parseInt(searchParams.get("h") || "280")
    const quality = parseInt(searchParams.get("q") || "80")
    const format = (searchParams.get("format") || "webp") as "webp" | "jpeg" | "png"
    
    await logger.debug('Image optimization parameters', { imagePath, width, height, quality, format })

    // Validate inputs
    if (!imagePath) {
      await logger.warn('Image optimization rejected: missing path parameter')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Image path parameter is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Security: Only allow images from public directory
    if (!imagePath.startsWith("/") || imagePath.includes("..")) {
      await logger.warn('Image optimization rejected: invalid path', { imagePath })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid image path",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate dimensions
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width < 1 || height < 1) {
      await logger.warn('Image optimization rejected: invalid dimensions', { width, height })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid dimensions",
        undefined,
        400,
        { requestId }
      )
    }

    if (quality < 1 || quality > 100) {
      await logger.warn('Image optimization rejected: invalid quality', { quality })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid quality",
        undefined,
        400,
        { requestId }
      )
    }

    // Resolve file path
    const publicPath = join(process.cwd(), "public", imagePath)
    
    // Check if file exists
    if (!existsSync(publicPath)) {
      await logger.warn('Image not found', { imagePath })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Image not found",
        undefined,
        404,
        { requestId }
      )
    }

    await logger.debug('Processing image', { imagePath, width, height, format, quality })

    // Read and process image
    const imageBuffer = await readFile(publicPath)
    
    // Determine output content type
    const contentType = format === "webp" ? "image/webp" : format === "png" ? "image/png" : "image/jpeg"
    
    // Process image with Sharp (auto-rotate based on EXIF orientation)
    const optimizedBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation tag
      .resize(width, height, {
        fit: "cover", // Cover the entire area, may crop
        position: "center", // Center the crop
        withoutEnlargement: true, // Don't enlarge if image is smaller
      })
      .toFormat(format, {
        quality: quality,
        ...(format === "jpeg" && { mozjpeg: true }), // Better JPEG compression
      })
      .toBuffer()
    
    await logger.info('Image optimized successfully', {
      imagePath,
      originalSize: imageBuffer.length,
      optimizedSize: optimizedBuffer.length,
      format
    })

    // Return optimized image with caching headers
    // Note: This returns binary data, not JSON, so we use NextResponse directly
    // but we still log the request for tracking
    return new NextResponse(new Uint8Array(optimizedBuffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
        "Content-Length": optimizedBuffer.length.toString(),
        "X-Request-ID": requestId, // Include request ID in headers for tracking
      },
    })
  } catch (error) {
    await logger.error('Error optimizing image',
      error instanceof Error ? error : new Error(String(error)),
      { endpoint }
    )
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to optimize image',
      error instanceof Error ? error.message : undefined,
      500,
      { requestId }
    )
  }
})

