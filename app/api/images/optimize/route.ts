import { NextResponse } from "next/server"
import sharp from "sharp"
import { readFile } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const imagePath = searchParams.get("path")
    const width = parseInt(searchParams.get("w") || "280")
    const height = parseInt(searchParams.get("h") || "280")
    const quality = parseInt(searchParams.get("q") || "80")
    const format = (searchParams.get("format") || "webp") as "webp" | "jpeg" | "png"

    // Validate inputs
    if (!imagePath) {
      return NextResponse.json({ error: "Image path parameter is required" }, { status: 400 })
    }

    // Security: Only allow images from public directory
    if (!imagePath.startsWith("/") || imagePath.includes("..")) {
      return NextResponse.json({ error: "Invalid image path" }, { status: 400 })
    }

    // Validate dimensions
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width < 1 || height < 1) {
      return NextResponse.json({ error: "Invalid dimensions" }, { status: 400 })
    }

    if (quality < 1 || quality > 100) {
      return NextResponse.json({ error: "Invalid quality" }, { status: 400 })
    }

    // Resolve file path
    const publicPath = join(process.cwd(), "public", imagePath)
    
    // Check if file exists
    if (!existsSync(publicPath)) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 })
    }

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

    // Return optimized image with caching headers
    return new NextResponse(optimizedBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
        "Content-Length": optimizedBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error("Image optimization error:", error)
    return NextResponse.json(
      { error: "Failed to optimize image" },
      { status: 500 }
    )
  }
}

