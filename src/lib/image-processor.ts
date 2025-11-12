import sharp from "sharp"
import { uploadImage } from "./blob"

/**
 * Image Processing Utilities
 * 
 * Handles image conversion, optimization, and upload.
 * Converts images to WebP format for optimal performance.
 */

export interface ImageProcessingOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  format?: "webp" | "jpeg" | "png"
}

export interface ProcessedImageResult {
  url: string
  pathname: string
  width: number
  height: number
  fileSize: number
  format: string
}

/**
 * Process and upload an image
 * Converts to WebP format and optimizes for web delivery
 */
export async function processAndUploadImage(
  file: File | Buffer,
  filename: string,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImageResult> {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 85,
    format = "webp",
  } = options

  try {
    // Convert file to buffer if it's a File
    const buffer = file instanceof File 
      ? Buffer.from(await file.arrayBuffer())
      : file

    // Get image metadata
    const metadata = await sharp(buffer).metadata()

    // Process image with Sharp
    // .rotate() auto-rotates based on EXIF orientation tag and strips orientation metadata
    // This ensures images are displayed correctly regardless of how they were captured
    const processedBuffer = await sharp(buffer)
      .rotate() // Auto-rotate based on EXIF orientation tag
      .resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(format, {
        quality,
        effort: 6, // Higher effort = better compression (0-6)
      })
      .toBuffer()

    // Determine content type
    const contentType = format === "webp" 
      ? "image/webp" 
      : format === "png" 
      ? "image/png" 
      : "image/jpeg"

    // Generate filename with proper extension
    const fileExtension = format === "webp" ? ".webp" : format === "png" ? ".png" : ".jpg"
    const finalFilename = filename.endsWith(fileExtension) 
      ? filename 
      : `${filename.replace(/\.[^/.]+$/, "")}${fileExtension}`

    // Upload to Vercel Blob Storage
    const { url, pathname } = await uploadImage(processedBuffer, finalFilename, {
      contentType,
      addRandomSuffix: true,
    })

    // Get final dimensions (may have changed after resize)
    const finalMetadata = await sharp(processedBuffer).metadata()

    return {
      url,
      pathname,
      width: finalMetadata.width || metadata.width || 0,
      height: finalMetadata.height || metadata.height || 0,
      fileSize: processedBuffer.length,
      format,
    }
  } catch (error) {
    console.error("Image processing error:", error)
    throw new Error(
      `Failed to process image: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Generate thumbnail from an image
 */
export async function generateThumbnail(
  file: File | Buffer,
  filename: string,
  width: number = 280,
  height: number = 280,
  quality: number = 80
): Promise<ProcessedImageResult> {
  const buffer = file instanceof File 
    ? Buffer.from(await file.arrayBuffer())
    : file

  const thumbnailBuffer = await sharp(buffer)
    .rotate() // Auto-rotate based on EXIF orientation tag
    .resize(width, height, {
      fit: "cover",
      position: "center",
    })
    .toFormat("webp", {
      quality,
      effort: 6,
    })
    .toBuffer()

  const thumbnailFilename = `thumb_${filename.replace(/\.[^/.]+$/, "")}.webp`

  const { url, pathname } = await uploadImage(thumbnailBuffer, thumbnailFilename, {
    contentType: "image/webp",
    addRandomSuffix: true,
  })

  const metadata = await sharp(thumbnailBuffer).metadata()

  return {
    url,
    pathname,
    width: metadata.width || width,
    height: metadata.height || height,
    fileSize: thumbnailBuffer.length,
    format: "webp",
  }
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024 // 10MB
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Image size exceeds maximum of ${maxSize / 1024 / 1024}MB`,
    }
  }

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid image type. Allowed types: ${allowedTypes.join(", ")}`,
    }
  }

  return { valid: true }
}


