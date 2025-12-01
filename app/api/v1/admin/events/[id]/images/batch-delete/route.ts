/**
 * Admin Event Images Batch Delete API v1
 * 
 * Versioned endpoint for batch deletion of event images
 * Queues background jobs for actual deletion
 * 
 * PATCH /api/v1/admin/events/[id]/images/batch-delete - Queue deletion of multiple event images
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
 * - Queues background jobs to delete multiple event images
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

    // OPTION B: Immediately delete event_images records (makes photos disappear from UI instantly)
    // EDGE CASE FIX: Use transaction to ensure atomicity (all or nothing)
    // Then queue jobs only for orphaned image/blob cleanup
    const deletedEventImageIds: string[] = []
    const failedToDelete: Array<{ eventImageId: string; error: string }> = []
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

    // EDGE CASE FIX: Use transaction for atomic batch deletion
    // If any deletion fails or process crashes, all changes are rolled back
    // HIDDEN ISSUE FIX: Calculate timeout based on batch size (100ms per deletion + 2s buffer)
    const transactionTimeout = Math.max(10000, verifiedImages.length * 100 + 2000)
    
    // REMAINING ISSUE FIX: Idempotency check - verify we're not processing duplicate request
    // Check if any of the photos are already being processed (optional enhancement)
    // For now, action lock provides sufficient protection, but we could add request ID tracking
    
    try {
      const { dbTransaction } = await import('@/lib/turso')
      await dbTransaction(async (tx) => {
        // Step 1: Immediately delete event_images records in transaction
        // Images have been re-verified after lock acquisition, so they should still exist
        for (const eventImage of verifiedImages) {
          try {
            const deleteResult = await tx.execute({
              sql: "DELETE FROM event_images WHERE id = ? AND event_id = ?",
              args: [eventImage.id, eventId],
            })
            
            // EDGE CASE FIX: Validate that deletion actually affected a row
            // If rowsAffected is 0, the record was already deleted (race condition)
            const rowsAffected = deleteResult.rowsAffected || 0
            if (rowsAffected > 0) {
              deletedEventImageIds.push(eventImage.id)
              // HIDDEN ISSUE FIX: Move logging outside transaction to avoid blocking
              // (Logger might do async operations that could slow down transaction)
            } else {
              // Record was already deleted (possibly by another process)
              // Don't add to failedToDelete - this is expected in race conditions
              // Log after transaction commits
            }
          } catch (deleteError) {
            // HIDDEN ISSUE FIX: If DELETE throws a database error, transaction might be rolled back
            // Check if it's a constraint violation or other critical error
            const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError)
            const isCriticalError = errorMessage.includes('constraint') || 
                                   errorMessage.includes('FOREIGN KEY') ||
                                   errorMessage.includes('database is locked')
            
            if (isCriticalError) {
              // Critical error - transaction will likely rollback, throw immediately
              throw deleteError
            }
            
            // Non-critical error - collect and continue
            failedToDelete.push({
              eventImageId: eventImage.id,
              error: errorMessage,
            })
          }
        }
        
        // EDGE CASE FIX: If any deletions failed, rollback entire transaction
        if (failedToDelete.length > 0) {
          throw new Error(`Failed to delete ${failedToDelete.length} event image(s). Transaction rolled back.`)
        }
        
        // If we get here, all deletions succeeded - transaction will commit
      }, { timeout: transactionTimeout, maxRetries: 2 }) // Dynamic timeout, 2 retries for deadlocks
      
      // Log after transaction commits (moved outside to avoid blocking transaction)
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
      
      await logger.info('Batch delete transaction completed successfully', {
        eventId,
        deletedCount: deletedEventImageIds.length,
      })
    } catch (transactionError) {
      await releaseLock()
      const errorMessage = transactionError instanceof Error ? transactionError.message : String(transactionError)
      await logger.error(
        'Batch delete transaction failed',
        transactionError instanceof Error ? transactionError : new Error(errorMessage),
        {
          eventId,
          failedCount: failedToDelete.length,
          failures: failedToDelete,
        }
      )
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to delete event images: ${errorMessage}. No changes were made.`,
        undefined,
        500,
        { requestId }
      )
    }

    // Step 2: Queue background jobs for orphaned image/blob cleanup (only for successfully deleted links)
    // HIDDEN ISSUE FIX: Job queueing happens AFTER transaction commits
    // If queueing fails, images are orphaned but cleanup jobs aren't queued
    // This is acceptable because:
    // 1. We retry queueing up to 3 times with exponential backoff
    // 2. Cleanup jobs can be manually triggered or run periodically
    // 3. Images being orphaned temporarily doesn't affect functionality
    // EDGE CASE FIX: Retry job queueing with exponential backoff to handle temporary failures
    // DEEP REVIEW FIX: Track both eventImageId and imageId for proper fallback handling
    const orphanedCleanups: Array<{ eventImageId: string; imageId: string }> = [] // Track failed cleanup jobs
    
    for (const eventImage of verifiedImages) {
      // Only queue cleanup job if we successfully deleted the event_image link
      if (deletedEventImageIds.includes(eventImage.id)) {
        let queued = false
        let retries = 0
        const maxRetries = 3
        
        while (!queued && retries < maxRetries) {
          try {
            // EDGE CASE FIX: Use optimized job type that skips event_image check
            // Since we already deleted it, we can use a more efficient cleanup job
            const jobId = await enqueueJob(
              'cleanup-orphaned-image', // New optimized job type
              {
                imageId: eventImage.image_id,
                eventId, // For logging context
              },
              {
                priority: 5, // Medium priority
                maxRetries: 3,
              }
            )
            jobIds.push(jobId)
            queued = true
            await logger.info('Queued orphaned image cleanup job', {
              eventId,
              eventImageId: eventImage.id,
              imageId: eventImage.image_id,
              jobId,
            })
          } catch (queueError) {
            retries++
            const errorMessage = queueError instanceof Error ? queueError.message : String(queueError)
            
            if (retries >= maxRetries) {
              // Final retry failed - log and add to failed list
              // DEEP REVIEW FIX: Track both eventImageId and imageId for proper fallback handling
              orphanedCleanups.push({
                eventImageId: eventImage.id,
                imageId: eventImage.image_id,
              })
              await logger.error(
                'Failed to queue orphaned image cleanup job after retries - image may be orphaned',
                queueError instanceof Error ? queueError : new Error(errorMessage),
                {
                  eventId,
                  eventImageId: eventImage.id,
                  imageId: eventImage.image_id,
                  retries,
                  note: 'Image is orphaned but cleanup job not queued. Periodic cleanup job will handle this.',
                }
              )
              failedToQueue.push({
                eventImageId: eventImage.id,
                error: errorMessage,
              })
            } else {
              // Retry with exponential backoff: 100ms, 200ms, 400ms
              const delay = Math.pow(2, retries - 1) * 100
              await logger.warn('Retrying job queue after failure', {
                eventId,
                eventImageId: eventImage.id,
                retry: retries,
                delay,
                error: errorMessage,
              })
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          }
        }
      }
    }
    
    // HIDDEN ISSUE FIX: If many cleanup jobs failed to queue, queue a single fallback cleanup job
    // This ensures orphaned images are eventually cleaned up even if individual job queueing failed
    // DEEP REVIEW FIX: Use proper tracking with both eventImageId and imageId
    if (orphanedCleanups.length > 0 && orphanedCleanups.length <= 10) {
      // Only queue fallback if reasonable number of failures (avoid queueing 55 individual jobs)
      try {
        for (const { eventImageId, imageId } of orphanedCleanups) {
          // Try one more time with lower priority
          try {
            const fallbackJobId = await enqueueJob(
              'cleanup-orphaned-image',
              { imageId, eventId },
              { priority: 1, maxRetries: 3 } // Lower priority, will run later
            )
            await logger.info('Queued fallback cleanup job for orphaned image', {
              eventId,
              eventImageId,
              imageId,
              fallbackJobId,
            })
            // Remove from failed list since we queued it
            const failedIndex = failedToQueue.findIndex(f => f.eventImageId === eventImageId)
            if (failedIndex >= 0) {
              failedToQueue.splice(failedIndex, 1)
              jobIds.push(fallbackJobId)
            }
          } catch (fallbackError) {
            // Fallback also failed - log but don't fail the request
            await logger.warn('Fallback cleanup job queueing also failed', {
              eventId,
              eventImageId,
              imageId,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            })
          }
        }
      } catch (fallbackBatchError) {
        await logger.warn('Failed to queue fallback cleanup jobs', {
          eventId,
          orphanedCount: orphanedCleanups.length,
          error: fallbackBatchError instanceof Error ? fallbackBatchError.message : String(fallbackBatchError),
        })
      }
    } else if (orphanedCleanups.length > 10) {
      // Too many failures - log prominently for manual intervention
      await logger.error(
        'Many cleanup jobs failed to queue - manual intervention may be needed',
        new Error(`${orphanedCleanups.length} cleanup jobs failed to queue`),
        {
          eventId,
          orphanedImageCount: orphanedCleanups.length,
          orphanedImageIds: orphanedCleanups.slice(0, 10).map(c => c.imageId), // Log first 10 imageIds
          note: 'Consider running periodic cleanup job or manual cleanup',
        }
      )
    }
    
    // Release lock after job queueing (deletions are already committed)
    await releaseLock()

    // Determine overall success
    // DEEP REVIEW FIX: Use verifiedImages.length (what we actually tried to delete) instead of validImageIds.length (original request)
    // This ensures response counts are accurate - if photos were deleted between verification and lock, counts reflect reality
    const totalDeleted = deletedEventImageIds.length
    const totalAttempted = verifiedImages.length // What we actually tried to delete (after re-verification)
    const totalRequested = validImageIds.length // Original request count (for reference)
    const hasFailures = failedToDelete.length > 0 || failedToQueue.length > 0

    if (totalDeleted === 0) {
      // No images were deleted at all
      await logger.error(
        'Failed to delete any event images',
        new Error('All deletions failed'),
        { 
          eventId, 
          imageIds: validImageIds,
          deleteFailures: failedToDelete,
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
      await logger.warn('Batch delete completed with some failures', {
        eventId,
        originallyRequested: totalRequested,
        attempted: totalAttempted,
        deleted: totalDeleted,
        deleteFailures: failedToDelete.length,
        queueFailures: failedToQueue.length,
        deleteFailureDetails: failedToDelete,
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
    // DEEP REVIEW FIX: Use totalAttempted for comparisons (what we actually tried) but show totalRequested for context
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
      message = `Deleted ${totalDeleted} of ${totalAttempted} photo${totalAttempted !== 1 ? 's' : ''} attempted${totalAttempted < totalRequested ? ` (${totalRequested - totalAttempted} were already deleted)` : ''}. ${failedToDelete.length} failed to delete.`
    }

    return successResponse(
      {
        message,
        deleted: totalDeleted,
        requested: totalRequested, // Original request count
        attempted: totalAttempted, // What we actually tried to delete (after re-verification)
        failed: failedToDelete.length,
        cleanupJobsQueued: jobIds.length,
        cleanupJobsFailed: failedToQueue.length,
        jobIds,
        warnings: hasFailures ? {
          message: failedToDelete.length > 0 
            ? `${failedToDelete.length} photo${failedToDelete.length !== 1 ? 's' : ''} failed to delete. ${failedToQueue.length > 0 ? `${failedToQueue.length} cleanup job${failedToQueue.length !== 1 ? 's' : ''} failed to queue.` : ''}`
            : `${failedToQueue.length} cleanup job${failedToQueue.length !== 1 ? 's' : ''} failed to queue (photos are deleted, cleanup will retry).`,
          deleteFailures: failedToDelete.length > 0 ? failedToDelete : undefined,
          queueFailures: failedToQueue.length > 0 ? failedToQueue : undefined,
        } : undefined,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

