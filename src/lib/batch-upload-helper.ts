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
 */
function estimateFormDataOverhead(
  fileCount: number,
  hasCategory: boolean,
  hasTitle: boolean,
  hasEventInfo: boolean
): number {
  // Base overhead: ~2KB for FormData structure
  let overhead = 2048
  
  // Per-file overhead: ~1KB (boundary + field name + headers)
  overhead += fileCount * 1024
  
  // Metadata fields overhead: ~200 bytes each
  if (hasCategory) overhead += 200
  if (hasTitle) overhead += 200
  if (hasEventInfo) overhead += 200
  
  // Safety margin: ~50KB
  overhead += 51200
  
  return overhead
}

/**
 * Split processed images into batches based on size limits
 * 
 * Algorithm:
 * 1. Calculate max request size (4.5MB for Vercel, or from env)
 * 2. Account for FormData overhead (~150KB)
 * 3. Group images to maximize batch efficiency
 * 4. Respect MAX_FILES_PER_BATCH limit
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
    const estimatedOverhead = estimateFormDataOverhead(
      currentBatch.length + 1,
      hasCategory,
      hasTitle,
      hasEventInfo
    )
    
    const totalSizeWithNewImage = currentBatchSize + fileSize + estimatedOverhead
    
    // Check if adding this image would exceed limits
    const wouldExceedSize = totalSizeWithNewImage > maxRequestSize
    const wouldExceedFileCount = currentBatch.length >= maxFilesPerBatch
    
    // If current batch is full (by size or count), start a new batch
    if (wouldExceedSize || wouldExceedFileCount) {
      if (currentBatch.length > 0) {
        batches.push([...currentBatch])
        currentBatch = []
        currentBatchSize = 0
      }
      
      // If single image exceeds size limit, it must go in its own batch
      // (will likely fail, but we'll try)
      if (fileSize + estimateFormDataOverhead(1, hasCategory, hasTitle, hasEventInfo) > maxRequestSize) {
        batches.push([image])
        continue
      }
    }
    
    // Add image to current batch
    currentBatch.push(image)
    currentBatchSize += fileSize
  }
  
  // Add remaining batch
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
  
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  })
  
  const json = await response.json()
  
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
  
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  })
  
  const json = await response.json()
  
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

