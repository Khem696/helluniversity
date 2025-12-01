/**
 * Admin Event Images Batch Delete API v1
 * 
 * Versioned endpoint for batch deletion of event images
 * Immediately deletes event_images records for instant UI update
 * Queues background jobs for orphaned image/blob cleanup
 * 
 * PATCH /api/v1/admin/events/[id]/images/batch-delete - Delete multiple event images
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { enqueueJob } from "@/lib/job-queue"

/**
 * Admin Event Images Batch Delete API
 * 
 * PATCH /api/v1/admin/events/[id]/images/batch-delete
 * - Immediately deletes event_images records (instant UI update)
 * - Queues background jobs for orphaned image/blob cleanup
 * - Optimized for Vercel Pro execution limits (no transaction timeouts)
 * - Requires Google Workspace authentication
 * 
 * Body (JSON):
 * - imageIds: Array of event_image IDs to delete (string[])
 */

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

export const PATCH = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id: eventId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin batch delete event images request', { eventId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin batch delete event images rejected: authentication failed', { eventId })
      return authError
    }

    const db = getTursoClient()

    // Verify event exists
    const eventCheck = await db.execute({
      sql: "SELECT id FROM events WHERE id = ?",
      args: [eventId],
    })

    if (eventCheck.rows.length === 0) {
      await logger.warn('Event not found', { eventId })
      return notFoundResponse('Event', { requestId })
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 102400) // 100KB limit for batch delete data
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }

    const { imageIds } = body

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      await logger.warn('Batch delete rejected: invalid imageIds', { eventId })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "imageIds must be a non-empty array of event_image IDs",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate maximum batch size
    const MAX_BATCH_SIZE = 100
    if (imageIds.length > MAX_BATCH_SIZE) {
      await logger.warn('Batch delete rejected: too many images', { 
        eventId, 
        count: imageIds.length,
        max: MAX_BATCH_SIZE
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Too many images. Maximum ${MAX_BATCH_SIZE} images per batch.`,
        undefined,
        400,
        { requestId }
      )
    }

    // Validate that all imageIds are strings and remove duplicates
    // Silently deduplicate for better UX (user might accidentally send duplicates)
    const validImageIds = imageIds.filter((id: any, index: number) => {
      return typeof id === 'string' && id.trim().length > 0 && imageIds.indexOf(id) === index
    })

    // Validate that we have at least one valid ID after filtering
    if (validImageIds.length === 0) {
      await logger.warn('Batch delete rejected: no valid image IDs', { eventId })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No valid image IDs provided. All imageIds must be non-empty strings.",
        undefined,
        400,
        { requestId }
      )
    }

    // Log if duplicates were removed (informational, not an error)
    if (validImageIds.length < imageIds.length) {
      await logger.info('Batch delete: duplicates removed', { 
        eventId,
        originalCount: imageIds.length,
        validCount: validImageIds.length,
        duplicatesRemoved: imageIds.length - validImageIds.length
      })
    }

    // Verify that all event_images belong to this event and exist
    // Use parameterized query to prevent SQL injection
    const placeholders = validImageIds.map(() => '?').join(',')
    const verificationResult = await db.execute({
      sql: `
        SELECT id, image_id 
        FROM event_images 
        WHERE id IN (${placeholders}) AND event_id = ?
      `,
      args: [...validImageIds, eventId],
    })

    // REMAINING ISSUE FIX: Make operation idempotent - if some photos are already deleted, 
    // continue with the ones that still exist (if any)
    if (verificationResult.rows.length !== validImageIds.length) {
      const alreadyDeletedCount = validImageIds.length - verificationResult.rows.length
      
      if (verificationResult.rows.length === 0) {
        // All photos already deleted - return success (idempotent)
        // FINAL REVIEW FIX: Add 'attempted' field for consistency with other responses
        await logger.info('All requested photos were already deleted (idempotent operation)', {
          eventId,
          requested: validImageIds.length,
        })
        return successResponse(
          {
            message: "All requested photos were already deleted",
            deleted: 0,
            requested: validImageIds.length,
            attempted: 0, // We didn't attempt any deletions (all already deleted)
            alreadyDeleted: validImageIds.length,
          },
          { requestId }
        )
      }
      
      // Some photos exist, some don't - continue with existing ones (idempotent)
      await logger.info('Some photos already deleted, continuing with remaining photos (idempotent operation)', {
        eventId,
        requested: validImageIds.length,
        found: verificationResult.rows.length,
        alreadyDeleted: alreadyDeletedCount,
        note: 'Operation is idempotent - will delete only remaining photos',
      })
      // Continue with the photos that still exist
    }


    // Get admin info for action lock
    let adminEmail: string | undefined
    let adminName: string | undefined
    try {
      const { getAuthSession } = await import('@/lib/auth')
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { 
        error: sessionError instanceof Error ? sessionError.message : String(sessionError) 
      })
    }

    // EDGE CASE FIX: Add action lock to prevent concurrent deletions
    // REMAINING ISSUE FIX: Use broader lock scope 'event-images' to coordinate with single photo deletes
    // This prevents race conditions between batch delete and single photo delete operations
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        // Use 'event-images' instead of 'batch-delete-images' to coordinate with all image operations
        actionLockId = await acquireActionLock('event', eventId, 'event-images', adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is modifying event images', {
            eventId,
            action: 'event-images',
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Another admin is currently modifying photos for this event. Please wait a moment and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { eventId, action: 'event-images', lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          eventId
        })
      }
    }
    
    // Ensure lock is released even if deletion fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { eventId, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            eventId,
            lockId: actionLockId
          })
        }
      }
    }

    // VERCEL PRO OPTIMIZATION: Immediately delete event_images records (makes photos disappear from UI instantly)
    // Use batch DELETE for fast execution, then queue jobs for orphaned image/blob cleanup
    const deletedEventImageIds: string[] = []
    const jobIds: string[] = []
    const failedToQueue: Array<{ eventImageId: string; error: string }> = []
    
    // Map database rows to typed objects
    let verifiedImages: Array<{ id: string; image_id: string }> = verificationResult.rows.map((row: any) => ({
      id: row.id as string,
      image_id: row.image_id as string,
    }))

    // REMAINING ISSUE FIX: Re-verify images exist after acquiring lock (prevent race condition)
    // Between initial verification and lock acquisition, another process might have deleted some photos
    // Re-checking here ensures we only try to delete photos that still exist
    // DEEP REVIEW FIX: Re-verify even without lock (if lock acquisition failed, still check)
    if (verifiedImages.length > 0) {
      const placeholders = verifiedImages.map(() => '?').join(',')
      const reVerificationResult = await db.execute({
        sql: `
          SELECT id, image_id 
          FROM event_images 
          WHERE id IN (${placeholders}) AND event_id = ?
        `,
        args: [...verifiedImages.map(ei => ei.id), eventId],
      })
      
      const stillExist = new Set(reVerificationResult.rows.map((row: any) => row.id as string))
      const originalCount = verifiedImages.length
      verifiedImages = verifiedImages.filter(ei => stillExist.has(ei.id))
      
      if (verifiedImages.length < originalCount) {
        const removedCount = originalCount - verifiedImages.length
        await logger.info('Some photos were deleted between verification and lock acquisition', {
          eventId,
          originalCount,
          remainingCount: verifiedImages.length,
          removedCount,
          note: 'This is expected in concurrent operations - will only delete remaining photos',
        })
        
        // Update validImageIds to match what still exists
        // This ensures response counts are accurate
        if (verifiedImages.length === 0) {
          await releaseLock()
          // FINAL REVIEW FIX: Idempotent operation - if all photos already deleted, return success
          // Use validImageIds.length (original request) not originalCount (after initial verification)
          // This ensures response accurately reflects what was originally requested
          await logger.info('All requested photos were already deleted by another process (idempotent operation)', {
            eventId,
            originallyRequested: validImageIds.length,
            attempted: originalCount,
          })
          return successResponse(
            {
              message: "All requested photos were already deleted",
              deleted: 0,
              requested: validImageIds.length, // Original request count
              attempted: originalCount, // What we actually tried (after initial verification)
              alreadyDeleted: validImageIds.length,
            },
            { requestId }
          )
        }
      }
    }

    // VERCEL PRO OPTIMIZATION: Use immediate batch deletion (no transaction loop)
    // This matches the single delete pattern - fast, immediate deletion for UI update
    // Then queue cleanup jobs in background
    // This avoids transaction timeout issues on Vercel Pro's execution limits
    
    // EDGE CASE: Safety check - if no images remain after re-verification, return success (idempotent)
    // This handles the edge case where all images were deleted between initial verification and lock acquisition
    // Note: This should have been caught in the re-verification block above, but this is a safety net
    if (verifiedImages.length === 0) {
      await releaseLock()
      await logger.info('No photos to delete after re-verification (idempotent operation)', {
        eventId,
        originallyRequested: validImageIds.length,
      })
      return successResponse(
        {
          message: "All requested photos were already deleted",
          deleted: 0,
          requested: validImageIds.length,
          attempted: verificationResult.rows.length, // What we found in initial verification
          alreadyDeleted: validImageIds.length,
        },
        { requestId }
      )
    }
    
    try {
      // Step 1: Immediately delete all event_images records in a single batch operation
      // Use IN clause for efficient batch deletion (much faster than loop)
      const placeholders = verifiedImages.map(() => '?').join(',')
      const imageIdsToDelete = verifiedImages.map(ei => ei.id)
      
      const batchDeleteResult = await db.execute({
        sql: `DELETE FROM event_images WHERE id IN (${placeholders}) AND event_id = ?`,
        args: [...imageIdsToDelete, eventId],
      })
      
      const totalRowsAffected = batchDeleteResult.rowsAffected || 0
      
      await logger.info('Batch delete executed', {
        eventId,
        attempted: verifiedImages.length,
        deleted: totalRowsAffected,
      })
      
      // Step 2: Determine which images were actually deleted
      // If some were already deleted (race condition), that's OK - idempotent operation
      if (totalRowsAffected === 0) {
        // All images were already deleted - idempotent success
        await releaseLock()
        await logger.info('All requested photos were already deleted (idempotent operation)', {
          eventId,
          requested: verifiedImages.length,
        })
        return successResponse(
          {
            message: "All requested photos were already deleted",
            deleted: 0,
            requested: validImageIds.length,
            attempted: verifiedImages.length,
            alreadyDeleted: verifiedImages.length,
          },
          { requestId }
        )
      }
      
      // Verify which specific images were deleted by checking what still exists
      // This handles partial deletions gracefully
      const remainingPlaceholders = verifiedImages.map(() => '?').join(',')
      const stillExistResult = await db.execute({
        sql: `SELECT id FROM event_images WHERE id IN (${remainingPlaceholders}) AND event_id = ?`,
        args: [...imageIdsToDelete, eventId],
      })
      
      const stillExistSet = new Set(stillExistResult.rows.map((row: any) => row.id as string))
      
      // Track which images were successfully deleted
      for (const eventImage of verifiedImages) {
        if (!stillExistSet.has(eventImage.id)) {
          deletedEventImageIds.push(eventImage.id)
        }
      }
      
      // Log deletion results
      for (const eventImage of verifiedImages) {
        if (deletedEventImageIds.includes(eventImage.id)) {
          await logger.info('Deleted event image link immediately', {
            eventId,
            eventImageId: eventImage.id,
            imageId: eventImage.image_id,
          })
        } else {
          await logger.warn('Event image link already deleted (race condition)', {
            eventId,
            eventImageId: eventImage.id,
            imageId: eventImage.image_id,
          })
        }
      }
      
      await logger.info('Batch delete completed successfully', {
        eventId,
        deletedCount: deletedEventImageIds.length,
        attempted: verifiedImages.length,
      })
      
    } catch (deleteError) {
      await releaseLock()
      const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError)
      await logger.error(
        'Batch delete failed',
        deleteError instanceof Error ? deleteError : new Error(errorMessage),
        {
          eventId,
          error: errorMessage,
        }
      )
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to delete event images: ${errorMessage}. Please try again.`,
        undefined,
        500,
        { requestId }
      )
    }

    // Step 2: Queue background jobs for orphaned image/blob cleanup (only for successfully deleted links)
    // VERCEL PRO OPTIMIZATION: Queue jobs in parallel for faster response
    // If queueing fails, images are orphaned but cleanup jobs aren't queued
    // This is acceptable because:
    // 1. Cleanup jobs can be manually triggered or run periodically
    // 2. Images being orphaned temporarily doesn't affect functionality
    // 3. The UI has already updated (photos are deleted from event_images)
    
    const jobQueuePromises = deletedEventImageIds.map(async (deletedEventImageId) => {
      const eventImage = verifiedImages.find(ei => ei.id === deletedEventImageId)
      if (!eventImage) return null
      
      try {
        const jobId = await enqueueJob(
          'cleanup-orphaned-image',
          {
            imageId: eventImage.image_id,
            eventId, // For logging context
          },
          {
            priority: 5, // Medium priority
            maxRetries: 3,
          }
        )
        await logger.info('Queued orphaned image cleanup job', {
          eventId,
          eventImageId: eventImage.id,
          imageId: eventImage.image_id,
          jobId,
        })
        return { jobId, eventImageId: eventImage.id }
      } catch (queueError) {
        const errorMessage = queueError instanceof Error ? queueError.message : String(queueError)
        await logger.warn('Failed to queue orphaned image cleanup job - image may be orphaned', {
          eventId,
          eventImageId: eventImage.id,
          imageId: eventImage.image_id,
          error: errorMessage,
          note: 'Image is orphaned but cleanup job not queued. Periodic cleanup job will handle this.',
        })
        failedToQueue.push({
          eventImageId: eventImage.id,
          error: errorMessage,
        })
        return null
      }
    })
    
    // Wait for all job queueing to complete (but don't fail if some fail)
    const jobResults = await Promise.allSettled(jobQueuePromises)
    for (const result of jobResults) {
      if (result.status === 'fulfilled' && result.value?.jobId) {
        jobIds.push(result.value.jobId)
      }
    }
    
    // Release lock after job queueing (deletions are already committed)
    await releaseLock()

    // Determine overall success
    // Use verifiedImages.length (what we actually tried to delete) instead of validImageIds.length (original request)
    // This ensures response counts are accurate - if photos were deleted between verification and lock, counts reflect reality
    const totalDeleted = deletedEventImageIds.length
    const totalAttempted = verifiedImages.length // What we actually tried to delete (after re-verification)
    const totalRequested = validImageIds.length // Original request count (for reference)
    const hasFailures = failedToQueue.length > 0

    if (totalDeleted === 0) {
      // No images were deleted at all
      await logger.error(
        'Failed to delete any event images',
        new Error('All deletions failed'),
        { 
          eventId, 
          imageIds: validImageIds,
          queueFailures: failedToQueue
        }
      )
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to delete event images. Please try again later.",
        undefined,
        500,
        { requestId }
      )
    }

    if (hasFailures) {
      await logger.warn('Batch delete completed with some queue failures', {
        eventId,
        originallyRequested: totalRequested,
        attempted: totalAttempted,
        deleted: totalDeleted,
        queueFailures: failedToQueue.length,
        queueFailureDetails: failedToQueue,
      })
    } else {
      await logger.info('Batch delete event images completed successfully', {
        eventId,
        originallyRequested: totalRequested,
        attempted: totalAttempted,
        deleted: totalDeleted,
        cleanupJobsQueued: jobIds.length,
        jobIds,
      })
    }

    // Build response message
    // Use totalAttempted for comparisons (what we actually tried) but show totalRequested for context
    let message: string
    if (totalDeleted === totalAttempted && !hasFailures) {
      if (totalAttempted === totalRequested) {
        message = `Successfully deleted ${totalDeleted} photo${totalDeleted !== 1 ? 's' : ''}`
      } else {
        message = `Successfully deleted ${totalDeleted} photo${totalDeleted !== 1 ? 's' : ''} (${totalRequested - totalAttempted} were already deleted)`
      }
    } else if (totalDeleted === totalAttempted && failedToQueue.length > 0) {
      message = `Deleted ${totalDeleted} photo${totalDeleted !== 1 ? 's' : ''}. ${failedToQueue.length} cleanup job${failedToQueue.length !== 1 ? 's' : ''} failed to queue (photos are deleted, cleanup will retry).`
    } else {
      message = `Deleted ${totalDeleted} of ${totalAttempted} photo${totalAttempted !== 1 ? 's' : ''} attempted${totalAttempted < totalRequested ? ` (${totalRequested - totalAttempted} were already deleted)` : ''}.`
    }

    return successResponse(
      {
        message,
        deleted: totalDeleted,
        requested: totalRequested, // Original request count
        attempted: totalAttempted, // What we actually tried to delete (after re-verification)
        cleanupJobsQueued: jobIds.length,
        cleanupJobsFailed: failedToQueue.length,
        jobIds,
        warnings: hasFailures ? {
          message: `${failedToQueue.length} cleanup job${failedToQueue.length !== 1 ? 's' : ''} failed to queue (photos are deleted, cleanup will retry).`,
          queueFailures: failedToQueue.length > 0 ? failedToQueue : undefined,
        } : undefined,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

