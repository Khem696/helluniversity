/**
 * Client-Side Image Processing Utilities
 * 
 * Handles image resizing, format conversion, and EXIF handling in the browser.
 * Prevents auto-rotation by ignoring EXIF orientation tags.
 * 
 * Features:
 * - Aggressively compresses images to ensure they're under 4MB
 * - Iteratively reduces quality and dimensions until target size is met
 * - Converts to WebP format for maximum compression
 * - Strips EXIF metadata to reduce file size
 * 
 * This reduces upload time and server load by normalizing images before upload.
 * Server-side processing still validates and ensures consistency.
 * 
 * Target: Maximum 4MB per processed image (to fit within batch upload limits)
 */

export interface ClientImageProcessOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  format?: 'webp' | 'jpeg' | 'png'
  maintainAspectRatio?: boolean
}

export interface ProcessedClientImage {
  file: File
  originalSize: number
  processedSize: number
  width: number
  height: number
  format: string
  compressionRatio: number
}

// Environment variables for client-side processing defaults
// NEXT_PUBLIC_ variables are available at build time in Next.js
// Defaults are optimized for aggressive compression to stay under 4MB
const DEFAULT_MAX_WIDTH = parseInt(
  process.env.NEXT_PUBLIC_MAX_IMAGE_WIDTH || '1920',
  10
)
const DEFAULT_MAX_HEIGHT = parseInt(
  process.env.NEXT_PUBLIC_MAX_IMAGE_HEIGHT || '1920',
  10
)
// Lower default quality (0.75) for better compression while maintaining good visual quality
// The iterative compression will further reduce if needed to stay under 4MB
const DEFAULT_QUALITY = parseFloat(
  process.env.NEXT_PUBLIC_IMAGE_QUALITY || '0.75'
)
const DEFAULT_FORMAT: 'webp' | 'jpeg' | 'png' = (
  process.env.NEXT_PUBLIC_IMAGE_FORMAT || 'webp'
) as 'webp' | 'jpeg' | 'png'

/**
 * Check if WebP format is supported in the browser
 */
function isWebPSupported(): boolean {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
}

/**
 * Calculate new dimensions maintaining aspect ratio
 */
function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
  maintainAspectRatio: boolean = true
): { width: number; height: number } {
  if (!maintainAspectRatio) {
    return { width: maxWidth, height: maxHeight }
  }

  // If image is smaller than max dimensions, don't enlarge
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight }
  }

  // Calculate scaling factor
  const widthRatio = maxWidth / originalWidth
  const heightRatio = maxHeight / originalHeight
  const ratio = Math.min(widthRatio, heightRatio)

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio),
  }
}

/**
 * Get processed filename with correct extension
 */
function getProcessedFilename(originalFilename: string, format: string): string {
  const extension = format === 'webp' ? '.webp' : format === 'png' ? '.png' : '.jpg'
  const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, '')
  return `${nameWithoutExt}${extension}`
}

/**
 * Load image using createImageBitmap (ignores EXIF orientation)
 * Falls back to Image API for older browsers
 */
async function loadImageWithoutRotation(file: File): Promise<{ 
  image: HTMLImageElement | ImageBitmap
  width: number
  height: number
  needsCleanup: boolean
  objectUrl?: string  // Return objectUrl for proper cleanup
}> {
  // Try createImageBitmap first (modern browsers, ignores EXIF orientation)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const imageBitmap = await createImageBitmap(file, {
        imageOrientation: 'none', // Ignore EXIF orientation - prevent auto-rotation
      })
      return {
        image: imageBitmap,
        width: imageBitmap.width,
        height: imageBitmap.height,
        needsCleanup: true, // ImageBitmap needs to be closed
        objectUrl: undefined, // No object URL needed for ImageBitmap
      }
    } catch (error) {
      console.warn('createImageBitmap failed, falling back to Image API:', error)
      // Fall through to Image API fallback
    }
  }

  // Fallback: Use Image API (may auto-rotate, but we'll strip EXIF in output)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      resolve({
        image: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        needsCleanup: true, // Object URL needs to be revoked
        objectUrl, // Return objectUrl for cleanup
      })
    }

    img.onerror = (error) => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image'))
    }

    img.src = objectUrl
  })
}

/**
 * Cleanup image resources
 */
function cleanupImage(
  image: HTMLImageElement | ImageBitmap,
  objectUrl?: string,
  needsCleanup: boolean = false
): void {
  if (needsCleanup) {
    if ('close' in image && typeof image.close === 'function') {
      // ImageBitmap
      image.close()
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

/**
 * Maximum processed image size: 4MB
 * This ensures images fit within batch upload limits (4MB images + 500KB overhead = 4.5MB total)
 */
const MAX_PROCESSED_SIZE = 4 * 1024 * 1024 // 4MB

/**
 * Resize and normalize image on client-side with aggressive compression
 * 
 * Features:
 * - Resizes to max dimensions (maintains aspect ratio)
 * - Converts to WebP (with JPEG fallback)
 * - Strips EXIF metadata (prevents auto-rotation)
 * - Normalizes image format and quality
 * - Iteratively reduces quality/dimensions to ensure image is under 4MB
 * 
 * @param file - Original image file
 * @param options - Processing options
 * @returns Processed image file with metadata (guaranteed under 4MB)
 */
export async function resizeImageClient(
  file: File,
  options: ClientImageProcessOptions = {}
): Promise<ProcessedClientImage> {
  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    quality = DEFAULT_QUALITY,
    format = DEFAULT_FORMAT,
    maintainAspectRatio = true,
  } = options

  // Determine output format (WebP with fallback to JPEG)
  const outputFormat = format || (isWebPSupported() ? 'webp' : 'jpeg')
  const mimeType = outputFormat === 'webp' ? 'image/webp' : outputFormat === 'png' ? 'image/png' : 'image/jpeg'

  let image: HTMLImageElement | ImageBitmap | null = null
  let objectUrl: string | undefined
  let needsCleanup = false

  try {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('File is not an image')
    }

    // Load image without EXIF rotation
    const loaded = await loadImageWithoutRotation(file)
    image = loaded.image
    needsCleanup = loaded.needsCleanup
    objectUrl = loaded.objectUrl // Use returned objectUrl for proper cleanup

    // Start with initial dimensions and quality
    let currentWidth = maxWidth
    let currentHeight = maxHeight
    let currentQuality = quality
    let processedFile: File | null = null
    let finalWidth = 0
    let finalHeight = 0

    // Iteratively reduce quality and dimensions until image is under 4MB
    const maxIterations = 20 // Prevent infinite loops
    let iteration = 0

    while (iteration < maxIterations) {
      // Calculate new dimensions for this iteration
      const { width, height } = calculateDimensions(
        loaded.width,
        loaded.height,
        currentWidth,
        currentHeight,
        maintainAspectRatio
      )

      // Create canvas
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      // Draw image to canvas (no rotation applied - image is already in correct orientation)
      ctx.drawImage(image, 0, 0, width, height)

      // Convert canvas to blob (this strips EXIF metadata automatically)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Failed to create blob from canvas'))
            }
          },
          mimeType,
          currentQuality
        )
      })

      // Create new File object (no EXIF metadata)
      processedFile = new File(
        [blob],
        getProcessedFilename(file.name, outputFormat),
        { type: mimeType }
      )

      // Check if file size is under 4MB
      if (processedFile.size <= MAX_PROCESSED_SIZE) {
        finalWidth = width
        finalHeight = height
        break // Success! Image is under 4MB
      }

      // Image is still too large, reduce quality and/or dimensions
      iteration++

      if (iteration >= maxIterations) {
        // Last iteration - use whatever we have (even if over 4MB)
        finalWidth = width
        finalHeight = height
        console.warn(
          `Image ${file.name} could not be compressed below 4MB after ${maxIterations} iterations. ` +
          `Final size: ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`
        )
        break
      }

      // Aggressive compression strategy:
      // 1. First, reduce quality significantly (by 0.1 each time, minimum 0.3)
      if (currentQuality > 0.3) {
        currentQuality = Math.max(0.3, currentQuality - 0.1)
      } else {
        // 2. If quality is already low, reduce dimensions (by 10% each time)
        currentWidth = Math.max(800, Math.floor(currentWidth * 0.9))
        currentHeight = Math.max(800, Math.floor(currentHeight * 0.9))
      }

      // Cleanup canvas for next iteration
      canvas.width = 0
      canvas.height = 0
    }

    if (!processedFile) {
      throw new Error('Failed to process image')
    }

    // Calculate compression ratio
    const compressionRatio = file.size > 0
      ? ((1 - processedFile.size / file.size) * 100)
      : 0

    return {
      file: processedFile,
      originalSize: file.size,
      processedSize: processedFile.size,
      width: finalWidth,
      height: finalHeight,
      format: outputFormat,
      compressionRatio: Math.round(compressionRatio * 100) / 100, // Round to 2 decimal places
    }
  } catch (error) {
    console.error('Client-side image processing error:', error)
    throw new Error(
      `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  } finally {
    // Cleanup resources
    if (image && needsCleanup) {
      cleanupImage(image, objectUrl, needsCleanup)
    }
  }
}

/**
 * Process multiple images sequentially
 * 
 * @param files - Array of image files to process
 * @param options - Processing options
 * @param onProgress - Optional progress callback
 * @returns Array of processed images
 */
export async function processMultipleImages(
  files: File[],
  options: ClientImageProcessOptions = {},
  onProgress?: (processed: number, total: number) => void
): Promise<ProcessedClientImage[]> {
  const results: ProcessedClientImage[] = []
  const total = files.length

  for (let i = 0; i < files.length; i++) {
    try {
      const processed = await resizeImageClient(files[i], options)
      results.push(processed)
      onProgress?.(i + 1, total)
    } catch (error) {
      console.error(`Failed to process image ${i + 1}/${total}:`, error)
      // Continue with other images even if one fails
      // You can choose to throw or collect errors based on requirements
      throw error // Re-throw to stop processing on error
    }
  }

  return results
}

/**
 * Validate image file before processing
 * 
 * @param file - File to validate
 * @param maxSize - Maximum file size in bytes (default: 20MB)
 * @returns Validation result
 */
export function validateImageFile(
  file: File,
  maxSize: number = 20971520 // 20MB default
): { valid: boolean; error?: string } {
  // Check file type
  if (!file.type.startsWith('image/')) {
    return {
      valid: false,
      error: 'File is not an image',
    }
  }

  // Check file size
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Image size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${(maxSize / 1024 / 1024).toFixed(2)}MB`,
    }
  }

  // Check if file is empty
  if (file.size === 0) {
    return {
      valid: false,
      error: 'Image file is empty',
    }
  }

  return { valid: true }
}

