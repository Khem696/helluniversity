import sharp from "sharp"
import { uploadImage } from "./blob"
import { logError } from "./logger"

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
 * IMPROVED: Added memory limits and proper cleanup
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

  // Memory limits: Configurable via environment variables
  const MAX_FILE_SIZE = parseInt(
    process.env.MAX_IMAGE_FILE_SIZE || '20971520', // 20MB default
    10
  )
  const MAX_PROCESSED_SIZE = parseInt(
    process.env.MAX_IMAGE_PROCESSED_SIZE || '5242880', // 5MB default
    10
  )

  let buffer: Buffer | null = null
  let sharpInstance: any = null
  let processedBuffer: Buffer | null = null

  try {
    // Convert file to buffer if it's a File
    buffer = file instanceof File 
      ? Buffer.from(await file.arrayBuffer())
      : file

    // Check file size before processing
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(
        `File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      )
    }

    // Get image metadata
    sharpInstance = sharp(buffer)
    const metadata = await sharpInstance.metadata()

    // Process image with Sharp
    // .rotate() auto-rotates based on EXIF orientation tag and strips orientation metadata
    // This ensures images are displayed correctly regardless of how they were captured
    processedBuffer = await sharpInstance
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

    // Ensure processedBuffer is not null
    if (!processedBuffer) {
      throw new Error('Failed to process image: processed buffer is null')
    }

    // Check processed buffer size
    if (processedBuffer.length > MAX_PROCESSED_SIZE) {
      throw new Error(
        `Processed image size (${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${MAX_PROCESSED_SIZE / 1024 / 1024}MB. Please use a smaller or lower quality image.`
      )
    }

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

    const result = {
      url,
      pathname,
      width: finalMetadata.width || metadata.width || 0,
      height: finalMetadata.height || metadata.height || 0,
      fileSize: processedBuffer.length,
      format,
    }

    // Cleanup: Clear references to help GC
    buffer = null
    processedBuffer = null
    sharpInstance = null

    return result
  } catch (error) {
    // Cleanup on error
    buffer = null
    processedBuffer = null
    sharpInstance = null

    // Fire-and-forget logging
    logError("Image processing error", {}, error instanceof Error ? error : new Error(String(error))).catch(() => {})
    throw new Error(
      `Failed to process image: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Generate thumbnail from an image
 * IMPROVED: Added memory limits and proper cleanup
 */
export async function generateThumbnail(
  file: File | Buffer,
  filename: string,
  width: number = 280,
  height: number = 280,
  quality: number = 80
): Promise<ProcessedImageResult> {
  // Memory limits: Configurable via environment variables
  const MAX_FILE_SIZE = parseInt(
    process.env.MAX_IMAGE_FILE_SIZE || '20971520', // 20MB default
    10
  )
  const MAX_THUMBNAIL_SIZE = parseInt(
    process.env.MAX_IMAGE_THUMBNAIL_SIZE || '512000', // 500KB default
    10
  )

  let buffer: Buffer | null = null
  let sharpInstance: any = null
  let thumbnailBuffer: Buffer | null = null

  try {
    buffer = file instanceof File 
      ? Buffer.from(await file.arrayBuffer())
      : file

    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(
        `File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      )
    }

    sharpInstance = sharp(buffer)
    thumbnailBuffer = await sharpInstance
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

    // Ensure thumbnailBuffer is not null
    if (!thumbnailBuffer) {
      throw new Error('Failed to generate thumbnail: thumbnail buffer is null')
    }

    // Check thumbnail size
    if (thumbnailBuffer.length > MAX_THUMBNAIL_SIZE) {
      throw new Error(
        `Generated thumbnail size (${(thumbnailBuffer.length / 1024).toFixed(2)}KB) exceeds maximum of ${MAX_THUMBNAIL_SIZE / 1024}KB`
      )
    }

    const thumbnailFilename = `thumb_${filename.replace(/\.[^/.]+$/, "")}.webp`

    const { url, pathname } = await uploadImage(thumbnailBuffer, thumbnailFilename, {
      contentType: "image/webp",
      addRandomSuffix: true,
    })

    const metadata = await sharp(thumbnailBuffer).metadata()

    const result = {
      url,
      pathname,
      width: metadata.width || width,
      height: metadata.height || height,
      fileSize: thumbnailBuffer.length,
      format: "webp",
    }

    // Cleanup
    buffer = null
    thumbnailBuffer = null
    sharpInstance = null

    return result
  } catch (error) {
    // Cleanup on error
    buffer = null
    thumbnailBuffer = null
    sharpInstance = null

    throw error
  }
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Use environment variable or default to 20MB (matches backend FormData limit)
  const maxSize = parseInt(
    process.env.MAX_IMAGE_FILE_SIZE || '20971520', // 20MB default
    10
  )
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


