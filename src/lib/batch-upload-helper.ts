/**
 * Batch Upload Helper
 * 
 * Intelligently splits images into batches based on file sizes and limits.
 * Ensures each batch doesn't exceed request size limits (accounting for FormData overhead).
 */

export interface ProcessedImage {
  file: File
  originalSize: number
  processedSize: number
  width: number
  height: number
  format: string
  compressionRatio: number
}

export interface BatchUploadOptions {
  category?: string | null
  title?: string | null
  titlePrefix?: string | null
  eventInfo?: string | null
}

/**
 * Calculate the maximum request size (Vercel limit or from env)
 * Vercel Hobby/Pro: 4.5MB hard limit
 * Vercel Enterprise: No limit (but we'll use MAX_FORMDATA_SIZE if set)
 */
function getMaxRequestSize(): number {
  // Vercel Hobby/Pro hard limit: 4.5MB
  const VERCEL_HARD_LIMIT = 4718592 // 4.5MB
  
  // If MAX_FORMDATA_SIZE is set and is less than Vercel limit, use it
  // Otherwise, use Vercel limit (for Hobby/Pro) or a large value (for Enterprise)
  const maxFormDataSize = parseInt(
    process.env.NEXT_PUBLIC_MAX_FORMDATA_SIZE || '0',
    10
  )
  
  // If MAX_FORMDATA_SIZE is explicitly set and is reasonable, use it
  // Otherwise, default to Vercel's 4.5MB limit
  if (maxFormDataSize > 0 && maxFormDataSize < VERCEL_HARD_LIMIT) {
    return maxFormDataSize
  }
  
  // Default to Vercel's 4.5MB limit (safe for all plans)
  return VERCEL_HARD_LIMIT
}

/**
 * Get maximum files per batch from environment
 */
function getMaxFilesPerBatch(): number {
  return parseInt(
    process.env.NEXT_PUBLIC_MAX_FILES_PER_BATCH || '50',
    10
  )
}

/**
 * Estimate FormData overhead per request
 * Includes boundaries, headers, and metadata fields
 * 
 * Optimized to maximize batch size while staying under 4.5MB Vercel limit.
 * Uses a conservative overhead calculation to ensure reliable uploads.
 * 
 * The calculation accounts for:
 * - Base overhead: ~2KB for FormData structure and initial boundary
 * - Per-file overhead: ~1KB per file (boundary + field name + headers + Content-Type)
 * - Metadata fields: ~200 bytes each (field name + value + boundary)
 * - Safety margin: 500KB to ensure we stay well under the 4.5MB limit
 * 
 * Goal: Pack as many processed images as possible into each batch, up to 4MB of images.
 * Total per batch: 4MB images + 500KB overhead = 4.5MB total.
 * This allows batches to be as large as possible (can be more or less than any specific number)
 * while ensuring all images upload successfully.
 */
function estimateFormDataOverhead(
  fileCount: number,
  hasCategory: boolean,
  hasTitle: boolean,
  hasEventInfo: boolean
): number {
  // Base overhead: ~2KB for FormData structure and initial boundary
  let overhead = 2048
  
  // Per-file overhead: ~1KB (boundary + field name + headers + Content-Type)
  overhead += fileCount * 1024
  
  // Metadata fields overhead: ~200 bytes each (field name + value + boundary)
  if (hasCategory) overhead += 200
  if (hasTitle) overhead += 200
  if (hasEventInfo) overhead += 200
  
  // Safety margin: 500KB (ensures max image size per batch is 4MB)
  // Max image size per batch: 4MB (4.5MB total - 500KB overhead = 4MB)
  // This provides a large safety buffer to ensure we stay under the 4.5MB limit
  overhead += 512000 // 500KB safety margin
  
  return overhead
}

/**
 * Split processed images into batches based on size limits
 * 
 * Algorithm optimizes to pack as many images as possible into each batch
 * while staying under the 4.5MB Vercel limit (including overhead).
 * 
 * Algorithm:
 * 1. Calculate max request size (4.5MB for Vercel, or from env)
 * 2. Account for FormData overhead (500KB safety margin)
 * 3. Group images to maximize batch efficiency - pack up to 4MB of images per batch
 * 4. Respect MAX_FILES_PER_BATCH limit
 * 
 * The goal is to maximize batch size (can be more or less than any specific number)
 * while ensuring all images upload successfully by staying under 4MB of images + 500KB overhead = 4.5MB total.
 */
export function splitIntoBatches(
  processedImages: ProcessedImage[],
  options: BatchUploadOptions = {}
): ProcessedImage[][] {
  if (processedImages.length === 0) {
    return []
  }
  
  const maxRequestSize = getMaxRequestSize()
  const maxFilesPerBatch = getMaxFilesPerBatch()
  
  // For single image, return it as a single batch
  if (processedImages.length === 1) {
    return [processedImages]
  }
  
  const batches: ProcessedImage[][] = []
  let currentBatch: ProcessedImage[] = []
  let currentBatchSize = 0
  
  // Estimate overhead for metadata fields
  const hasCategory = !!options.category
  const hasTitle = !!(options.title || options.titlePrefix)
  const hasEventInfo = !!options.eventInfo
  
  for (const image of processedImages) {
    const fileSize = image.file.size
    
    // Estimate overhead for current batch + new image
    // This dynamically calculates overhead based on the number of files
    const estimatedOverhead = estimateFormDataOverhead(
      currentBatch.length + 1,
      hasCategory,
      hasTitle,
      hasEventInfo
    )
    
    // Calculate total size if we add this image
    const totalSizeWithNewImage = currentBatchSize + fileSize + estimatedOverhead
    
    // Check if adding this image would exceed limits
    const wouldExceedSize = totalSizeWithNewImage > maxRequestSize
    const wouldExceedFileCount = currentBatch.length >= maxFilesPerBatch
    
    // If current batch is full (by size or count), start a new batch
    if (wouldExceedSize || wouldExceedFileCount) {
      // Save current batch if it has images
      if (currentBatch.length > 0) {
        batches.push([...currentBatch])
        currentBatch = []
        currentBatchSize = 0
      }
      
      // If single image exceeds size limit (even with minimal overhead),
      // it must go in its own batch (will likely fail, but we'll try)
      const singleImageOverhead = estimateFormDataOverhead(1, hasCategory, hasTitle, hasEventInfo)
      if (fileSize + singleImageOverhead > maxRequestSize) {
        batches.push([image])
        continue
      }
    }
    
    // Add image to current batch
    // This maximizes batch size by packing as many images as possible
    currentBatch.push(image)
    currentBatchSize += fileSize
  }
  
  // Add remaining batch (if any images remain)
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  
  return batches
}

/**
 * Upload a single batch of images
 */
export async function uploadBatch(
  batch: ProcessedImage[],
  endpoint: string,
  options: BatchUploadOptions = {}
): Promise<{
  success: boolean
  images?: any[]
  errors?: string[]
  message?: string
}> {
  const formData = new FormData()
  
  // Append all files
  batch.forEach(processed => {
    formData.append("files", processed.file)
  })
  
  // Append metadata
  if (options.category) {
    formData.append("category", options.category)
  }
  if (options.titlePrefix) {
    formData.append("title_prefix", options.titlePrefix)
  }
  if (options.title && !options.titlePrefix) {
    formData.append("title", options.title)
  }
  if (options.eventInfo) {
    formData.append("event_info", options.eventInfo)
  }
  
  // Add timeout for large batch uploads (5 minutes for batch uploads)
  const timeoutMs = 300000 // 5 minutes
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (error) {
    clearTimeout(timeoutId)
    // Network error, timeout, or connection issue
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        errors: [`Upload timed out after ${timeoutMs / 1000} seconds. The batch may be too large or the server is slow. Try uploading fewer images at once.`],
      }
    }
    return {
      success: false,
      errors: [`Network error: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  
  // Check if response is OK before parsing
  if (!response.ok) {
    // Try to get error message from response
    let errorMessage = `Upload failed with status ${response.status}`
    try {
      const contentType = response.headers.get("content-type")
      if (contentType && contentType.includes("application/json")) {
        const json = await response.json()
        errorMessage = json.error?.message || json.error || errorMessage
      } else {
        // Non-JSON response (HTML error page, plain text, etc.)
        const text = await response.text()
        // Try to extract meaningful error from HTML/text
        if (text.length < 500) {
          errorMessage = text.substring(0, 200)
        } else {
          errorMessage = `Server returned ${response.status} ${response.statusText}`
        }
      }
    } catch (parseError) {
      // Failed to parse error response
      errorMessage = `Server returned ${response.status} ${response.statusText} (unable to parse error message)`
    }
    
    return {
      success: false,
      errors: [errorMessage],
    }
  }
  
  // Parse JSON response
  let json: any
  try {
    json = await response.json()
  } catch (parseError) {
    // Response is not valid JSON
    const contentType = response.headers.get("content-type") || "unknown"
    return {
      success: false,
      errors: [`Server returned invalid response (expected JSON, got ${contentType}). Status: ${response.status}`],
    }
  }
  
  if (json.success) {
    return {
      success: true,
      images: json.data?.images || [],
      errors: json.data?.errors || [],
      message: json.data?.message,
    }
  } else {
    return {
      success: false,
      errors: [json.error?.message || json.error || "Upload failed"],
    }
  }
}

/**
 * Upload a single image (non-batch endpoint)
 */
export async function uploadSingle(
  image: ProcessedImage,
  endpoint: string,
  options: BatchUploadOptions = {}
): Promise<{
  success: boolean
  image?: any
  error?: string
}> {
  const formData = new FormData()
  formData.append("file", image.file)
  
  if (options.title) {
    formData.append("title", options.title)
  }
  if (options.category) {
    formData.append("category", options.category)
  }
  if (options.eventInfo) {
    formData.append("event_info", options.eventInfo)
  }
  
  // Add timeout for single uploads (2 minutes)
  const timeoutMs = 120000 // 2 minutes
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (error) {
    clearTimeout(timeoutId)
    // Network error, timeout, or connection issue
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: `Upload timed out after ${timeoutMs / 1000} seconds. The file may be too large or the server is slow.`,
      }
    }
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  
  // Check if response is OK before parsing
  if (!response.ok) {
    // Try to get error message from response
    let errorMessage = `Upload failed with status ${response.status}`
    try {
      const contentType = response.headers.get("content-type")
      if (contentType && contentType.includes("application/json")) {
        const json = await response.json()
        errorMessage = json.error?.message || json.error || errorMessage
      } else {
        // Non-JSON response (HTML error page, plain text, etc.)
        const text = await response.text()
        // Try to extract meaningful error from HTML/text
        if (text.length < 500) {
          errorMessage = text.substring(0, 200)
        } else {
          errorMessage = `Server returned ${response.status} ${response.statusText}`
        }
      }
    } catch (parseError) {
      // Failed to parse error response
      errorMessage = `Server returned ${response.status} ${response.statusText} (unable to parse error message)`
    }
    
    return {
      success: false,
      error: errorMessage,
    }
  }
  
  // Parse JSON response
  let json: any
  try {
    json = await response.json()
  } catch (parseError) {
    // Response is not valid JSON
    const contentType = response.headers.get("content-type") || "unknown"
    return {
      success: false,
      error: `Server returned invalid response (expected JSON, got ${contentType}). Status: ${response.status}`,
    }
  }
  
  if (json.success) {
    return {
      success: true,
      image: json.data?.image || json.image,
    }
  } else {
    return {
      success: false,
      error: json.error?.message || json.error || "Upload failed",
    }
  }
}

