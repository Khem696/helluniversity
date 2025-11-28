/**
 * Admin Images Batch Upload API v1
 * 
 * Versioned endpoint for batch image uploads
 * Handles multiple images in a single request
 * 
 * POST /api/v1/admin/images/batch - Upload multiple images
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { processAndUploadImage, validateImageFile } from "@/lib/image-processor"
import { requireAuthorizedDomain } from "@/lib/auth"
import { randomUUID } from "crypto"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Batch Image Upload API
 * 
 * POST /api/v1/admin/images/batch
 * - Uploads multiple images, converts to WebP, stores in Vercel Blob, saves metadata to Turso
 * - Requires Google Workspace authentication
 * - Processes images in parallel with concurrency limit
 * 
 * Body (FormData):
 * - files: Multiple image files (File[]) - use FormData.append("files", file) multiple times
 * - category: Optional category (string) - applied to all images
 * - title_prefix: Optional title prefix (string) - will be appended with image number
 * - event_info: Optional event information (string) - applied to all images
 * 
 * Limits:
 * - Maximum files per batch: 50 (configurable via MAX_FILES_PER_BATCH)
 * - Maximum file size: MAX_IMAGE_FILE_SIZE (default: 20MB)
 * - Maximum FormData size: MAX_FORMDATA_SIZE (default: 20MB)
 * - Maximum concurrent processing: 5 (configurable via MAX_CONCURRENT_PROCESSING)
 */

// Increase timeout for batch operations
export const maxDuration = 60 // 60 seconds for batch uploads

// Maximum files per batch request
const MAX_FILES_PER_BATCH = parseInt(
  process.env.MAX_FILES_PER_BATCH || '50',
  10
)

// Maximum concurrent processing operations
const MAX_CONCURRENT_PROCESSING = parseInt(
  process.env.MAX_CONCURRENT_PROCESSING || '5',
  10
)

/**
 * Process images in parallel with concurrency limit
 * Returns both successes and failures to allow partial success handling
 */
async function processImagesInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrent: number = MAX_CONCURRENT_PROCESSING
): Promise<{ 
  successes: Array<{ index: number; result: R }>
  failures: Array<{ index: number; error: Error; fileName?: string }>
}> {
  const successes: Array<{ index: number; result: R }> = []
  const failures: Array<{ index: number; error: Error; fileName?: string }> = []
  
  // Process in chunks
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const chunk = items.slice(i, i + maxConcurrent)
    const chunkPromises = chunk.map((item, chunkIndex) => {
      const globalIndex = i + chunkIndex
      return processor(item, globalIndex)
        .then(result => ({ success: true, index: globalIndex, result }))
        .catch(error => ({ 
          success: false, 
          index: globalIndex, 
          error: error instanceof Error ? error : new Error(String(error)),
          fileName: item instanceof File ? item.name : undefined
        }))
    })
    
    const chunkResults = await Promise.all(chunkPromises)
    
    // Collect results and errors
    for (const result of chunkResults) {
      if (result.success) {
        successes.push({ index: result.index, result: (result as { success: true; index: number; result: R }).result })
      } else {
        const failure = result as { success: false; index: number; error: Error; fileName?: string }
        failures.push({ 
          index: failure.index, 
          error: failure.error,
          fileName: failure.fileName
        })
      }
    }
  }
  
  return { successes, failures }
}

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin batch image upload request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Admin batch image upload rejected: authentication failed')
        return unauthorizedResponse("Authentication required", { requestId })
      }
      await logger.warn('Admin batch image upload rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
    }
    
    // CRITICAL: Validate FormData size before parsing to prevent DoS
    const { validateFormDataSize } = await import('@/lib/formdata-validation')
    const formDataSizeCheck = await validateFormDataSize(request)
    if (!formDataSizeCheck.valid) {
      await logger.warn('Admin batch image upload rejected: FormData too large', { 
        error: formDataSizeCheck.error,
        size: formDataSizeCheck.size 
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        formDataSizeCheck.error || "Request body is too large. Please reduce the file size and try again.",
        undefined,
        413, // 413 Payload Too Large
        { requestId }
      )
    }
    
    const formData = await request.formData()
    
    // Get all files (FormData.getAll returns all values for a key)
    const files = formData.getAll("files") as File[]
    const category = formData.get("category") as string | null
    const titlePrefix = formData.get("title_prefix") as string | null
    const eventInfo = formData.get("event_info") as string | null
    
    if (!files || files.length === 0) {
      await logger.warn('Admin batch image upload rejected: no files provided')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No files provided. Use FormData.append('files', file) for each file.",
        undefined,
        400,
        { requestId }
      )
    }
    
    // Validate file count
    if (files.length > MAX_FILES_PER_BATCH) {
      await logger.warn('Admin batch image upload rejected: too many files', { 
        fileCount: files.length,
        maxFiles: MAX_FILES_PER_BATCH
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Too many files. Maximum ${MAX_FILES_PER_BATCH} files per batch.`,
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.info('Batch image upload started', {
      fileCount: files.length,
      category: category || undefined,
      titlePrefix: titlePrefix || undefined,
      eventInfo: eventInfo || undefined
    })
    
    // Validate all files first
    const validationErrors: Array<{ index: number; fileName: string; error: string }> = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const validation = validateImageFile(file)
      if (!validation.valid) {
        validationErrors.push({
          index: i,
          fileName: file.name,
          error: validation.error || "Invalid image file"
        })
      }
    }
    
    if (validationErrors.length > 0) {
      await logger.warn('Admin batch image upload rejected: validation errors', { 
        errors: validationErrors 
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Validation failed for ${validationErrors.length} file(s): ${validationErrors.map(e => `${e.fileName}: ${e.error}`).join('; ')}`,
        undefined,
        400,
        { requestId }
      )
    }
    
    // Process and upload images in parallel (with concurrency limit)
    const db = getTursoClient()
    const successfulImages: any[] = []
    const errors: Array<{ fileName: string; error: string }> = []
    
    // Process all images (handles partial failures)
    const { successes, failures } = await processImagesInParallel(
      files,
      async (file: File, index: number) => {
        let processed: any = null
        
        try {
          // Process and upload image (converts to WebP)
          processed = await processAndUploadImage(
            file,
            file.name,
            {
              maxWidth: 1920,
              maxHeight: 1920,
              quality: 85,
              format: "webp",
            }
          )
          
          // Save metadata to database
          // CRITICAL: Wrap in try-catch to cleanup blob if database insert fails
          try {
            const imageId = randomUUID()
            const now = Math.floor(Date.now() / 1000)
            
            // Generate title
            const title = titlePrefix 
              ? `${titlePrefix} ${index + 1}`
              : file.name.replace(/\.[^/.]+$/, "") // Use filename without extension
            
            // Get max display_order for this category if provided
            let displayOrder = 0
            if (category) {
              const maxResult = await db.execute({
                sql: `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM images WHERE category = ?`,
                args: [category],
              })
              displayOrder = (maxResult.rows[0] as any).next_order
            }
            
            await db.execute({
              sql: `
                INSERT INTO images (
                  id, blob_url, title, event_info, category, display_order, format, 
                  width, height, file_size, original_filename, 
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              args: [
                imageId,
                processed.url,
                title,
                eventInfo || null, // event_info from FormData
                category || null,
                displayOrder,
                processed.format,
                processed.width,
                processed.height,
                processed.fileSize,
                file.name,
                now,
                now,
              ],
            })
            
            return {
              success: true,
              image: {
                id: imageId,
                url: processed.url,
                pathname: processed.pathname,
                title,
                event_info: eventInfo || null,
                category: category || null,
                display_order: displayOrder,
                width: processed.width,
                height: processed.height,
                file_size: processed.fileSize,
                format: processed.format,
                created_at: now,
              },
              fileName: file.name,
            }
          } catch (dbError) {
            // CRITICAL: Cleanup orphaned blob if database insert failed
            // The blob was uploaded successfully but database insert failed, leaving it orphaned
            if (processed?.url) {
              try {
                const { deleteImage } = await import("@/lib/blob")
                await deleteImage(processed.url)
                await logger.info('Cleaned up orphaned image blob after database insert failure', {
                  blobUrl: processed.url,
                  fileName: file.name
                })
              } catch (cleanupError) {
                // If cleanup fails, queue it for background cleanup
                await logger.error('Failed to cleanup orphaned image blob, queueing for background cleanup', 
                  cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)), 
                  {
                    blobUrl: processed.url,
                    fileName: file.name
                  }
                )
                try {
                  const { enqueueJob } = await import("@/lib/job-queue")
                  await enqueueJob("cleanup-orphaned-blob", { blobUrl: processed.url }, { priority: 1 })
                  await logger.info('Queued orphaned blob cleanup job for failed image upload', { 
                    blobUrl: processed.url 
                  })
                } catch (queueError) {
                  await logger.error("Failed to queue orphaned blob cleanup", 
                    queueError instanceof Error ? queueError : new Error(String(queueError)), 
                    { blobUrl: processed.url }
                  )
                }
              }
            }
            
            // Re-throw the database error
            throw dbError
          }
        } catch (error) {
          // Log error for this file
          const errorMessage = error instanceof Error ? error.message : String(error)
          await logger.error(`Failed to process file ${index + 1} (${file.name})`, 
            error instanceof Error ? error : new Error(errorMessage)
          )
          // Re-throw to be caught by processImagesInParallel
          throw error
        }
      },
      MAX_CONCURRENT_PROCESSING
    )
    
    // Collect successful results
    successes.forEach(({ result }) => {
      if (result?.image) {
        successfulImages.push(result.image)
      }
    })
    
    // Collect errors
    failures.forEach(({ error, fileName }, index) => {
      errors.push({
        fileName: fileName || `File ${index + 1}`,
        error: error.message
      })
    })
    
    // Determine if partial success or full success
    const hasFailures = failures.length > 0
    const hasSuccesses = successes.length > 0
    
    if (hasFailures && hasSuccesses) {
      // Partial success
      await logger.warn('Batch image upload completed with partial success', {
        fileCount: files.length,
        successful: successes.length,
        failed: failures.length,
        category: category || undefined
      })
      return successResponse(
        {
          success: true,
          partial: true,
          message: `Uploaded ${successes.length} of ${files.length} images. ${failures.length} file(s) failed.`,
          images: successfulImages,
          errors: errors.map(e => `${e.fileName}: ${e.error}`),
          stats: {
            total: files.length,
            successful: successes.length,
            failed: failures.length,
          }
        },
        { requestId }
      )
    } else if (hasFailures && !hasSuccesses) {
      // All failed
      await logger.error('Batch image upload failed for all files', 
        new Error(`All ${files.length} files failed to upload`),
        {
          fileCount: files.length,
          errors: errors
        }
      )
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to upload all images: ${errors.map(e => `${e.fileName}: ${e.error}`).join('; ')}`,
        undefined,
        500,
        { requestId }
      )
    } else {
      // All successful
      await logger.info('Batch image upload completed successfully', {
        fileCount: files.length,
        successful: successes.length,
        category: category || undefined
      })
      return successResponse(
        {
          success: true,
          message: `Successfully uploaded ${successes.length} image${successes.length !== 1 ? 's' : ''}`,
          images: successfulImages,
          stats: {
            total: files.length,
            successful: successes.length,
            failed: 0,
          }
        },
        { requestId }
      )
    }
  }, { endpoint: getRequestPath(request) })
})
