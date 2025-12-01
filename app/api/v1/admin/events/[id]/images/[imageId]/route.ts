/**
 * Admin Event Image Management API v1
 * 
 * Versioned endpoint for individual event image management
 * Maintains backward compatibility with /api/admin/events/[id]/images/[imageId]
 * 
 * DELETE /api/v1/admin/events/[id]/images/[imageId] - Remove image from event
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Event Image Management API
 * 
 * PATCH /api/admin/events/[id]/images/[imageId] - Update event image (display_order)
 * DELETE /api/admin/events/[id]/images/[imageId] - Remove image from event
 * - All routes require Google Workspace authentication
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
  { params }: { params: Promise<{ id: string; imageId: string }> }
) => {
  return withErrorHandling(async () => {
    const { id: eventId, imageId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin update event image request', { eventId, imageId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update event image rejected: authentication failed', { eventId, imageId })
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10240) // 10KB limit for event image update data
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
    const { display_order } = body
    
    await logger.debug('Update event image data', { eventId, imageId, display_order })

    if (display_order === undefined) {
      await logger.warn('Update event image rejected: missing display_order', { eventId, imageId })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "display_order is required",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()

    await db.execute({
      sql: `UPDATE event_images SET display_order = ? WHERE id = ?`,
      args: [parseInt(String(display_order)), imageId],
    })

    // Fetch updated event_image
    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.id = ?
      `,
      args: [imageId],
    })

    if (result.rows.length === 0) {
      await logger.warn('Event image not found', { eventId, imageId })
      return notFoundResponse('Event image', { requestId })
    }
    
    await logger.info('Event image updated successfully', { eventId, imageId })

    return successResponse(
      {
        event_image: result.rows[0],
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

export const DELETE = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) => {
  return withErrorHandling(async () => {
    const { id: eventId, imageId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin delete event image request', { eventId, imageId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete event image rejected: authentication failed', { eventId, imageId })
      return authError
    }

    // REMAINING ISSUE FIX: Add action lock to coordinate with batch delete operations
    // Use same lock scope 'event-images' as batch delete to prevent race conditions
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

    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        // Use same lock scope as batch delete to coordinate operations
        actionLockId = await acquireActionLock('event', eventId, 'event-images', adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is modifying event images', {
            eventId,
            imageId,
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
        await logger.debug('Action lock acquired', { eventId, imageId, action: 'event-images', lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          eventId,
          imageId
        })
      }
    }
    
    // Ensure lock is released even if deletion fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { eventId, imageId, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            eventId,
            imageId,
            lockId: actionLockId
          })
        }
      }
    }

    const db = getTursoClient()

    // REMAINING ISSUE FIX: Re-verify image exists after acquiring lock (idempotency check)
    // This ensures the image wasn't deleted between initial check and lock acquisition
    // Also provides idempotency - if already deleted, return success (idempotent operation)
    const eventImageResult = await db.execute({
      sql: "SELECT image_id FROM event_images WHERE id = ? AND event_id = ?",
      args: [imageId, eventId],
    })

    if (eventImageResult.rows.length === 0) {
      await releaseLock()
      // REMAINING ISSUE FIX: Idempotent operation - if already deleted, return success
      // This makes the operation safe to retry
      await logger.info('Event image already deleted (idempotent operation)', { eventId, imageId })
      return successResponse(
        {
          message: "Photo was already deleted",
          alreadyDeleted: true,
        },
        { requestId }
      )
    }

    const linkedImageId = (eventImageResult.rows[0] as any).image_id

    // Delete the event_images link
    const deleteResult = await db.execute({
      sql: "DELETE FROM event_images WHERE id = ? AND event_id = ?",
      args: [imageId, eventId],
    })
    
    // REMAINING ISSUE FIX: Validate deletion actually occurred
    const rowsAffected = deleteResult.rowsAffected || 0
    if (rowsAffected === 0) {
      await releaseLock()
      // Another process deleted it between lock and delete - idempotent success
      await logger.info('Event image was deleted by another process (idempotent operation)', { eventId, imageId })
      return successResponse(
        {
          message: "Photo was already deleted",
          alreadyDeleted: true,
        },
        { requestId }
      )
    }
    
    await logger.info('Event image link deleted', { eventId, imageId, linkedImageId })

    // Check if the image is still used elsewhere (other events or event_images)
    const usageCheck = await db.execute({
      sql: `
        SELECT 
          (SELECT COUNT(*) FROM events WHERE image_id = ?) as event_count,
          (SELECT COUNT(*) FROM event_images WHERE image_id = ?) as event_image_count
      `,
      args: [linkedImageId, linkedImageId],
    })

    const usage = usageCheck.rows[0] as any
    const isStillUsed = (usage.event_count > 0) || (usage.event_image_count > 0)

    if (!isStillUsed) {
      // Image is orphaned - delete it and its blob
      // CRITICAL: Use atomic check-and-delete pattern to prevent race conditions
      await logger.info('Image is orphaned, attempting to delete image record and blob', { imageId: linkedImageId })
      
      try {
        // CRITICAL: Get blob URL BEFORE attempting to delete (atomic operation)
        const imageResult = await db.execute({
          sql: "SELECT blob_url FROM images WHERE id = ?",
          args: [linkedImageId],
        })

        let blobUrl: string | null = null
        if (imageResult.rows.length > 0) {
          blobUrl = (imageResult.rows[0] as any).blob_url || null
        }

        // CRITICAL: Atomic delete with orphan check in WHERE clause
        // This ensures the image is only deleted if it's STILL orphaned at the moment of deletion
        // Prevents race condition where another process adds a reference between check and delete
        // Only one process will succeed (rowsAffected > 0) if image is still orphaned
        // If another process already deleted it or it's no longer orphaned, rowsAffected will be 0
        const deleteResult = await db.execute({
          sql: `
            DELETE FROM images 
            WHERE id = ? 
            AND (SELECT COUNT(*) FROM events WHERE image_id = ?) = 0 
            AND (SELECT COUNT(*) FROM event_images WHERE image_id = ?) = 0
          `,
          args: [linkedImageId, linkedImageId, linkedImageId],
        })

        const wasDeleted = (deleteResult.rowsAffected || 0) > 0

        if (wasDeleted) {
          // We successfully deleted the image record - now delete the blob
          await logger.info('Deleted orphaned image record', { imageId: linkedImageId })

          if (blobUrl) {
            // DEEP REVIEW FIX: Use non-blocking blob deletion for consistency with batch delete
            // Queue blob deletion as separate job instead of blocking
            try {
              const { enqueueJob } = await import('@/lib/job-queue')
              await enqueueJob(
                'delete-orphaned-blob',
                { blobUrl, imageId: linkedImageId },
                {
                  priority: 3, // Lower priority than event image deletion
                  maxRetries: 3,
                }
              )
              await logger.info('Queued orphaned blob deletion job', { imageId: linkedImageId, blobUrl })
            } catch (queueError) {
              // Fallback to immediate deletion if queueing fails
              await logger.warn(
                'Failed to queue blob deletion job, attempting immediate deletion',
                { imageId: linkedImageId, blobUrl },
                queueError instanceof Error ? queueError : new Error(String(queueError))
              )
              try {
                const { deleteImage } = await import("@/lib/blob")
                await deleteImage(blobUrl)
                await logger.info('Deleted orphaned image blob (fallback)', { imageId: linkedImageId, blobUrl })
              } catch (blobError) {
                await logger.error('Failed to delete orphaned image blob (fallback also failed)', 
                  blobError instanceof Error ? blobError : new Error(String(blobError)),
                  { imageId: linkedImageId, blobUrl }
                )
                // Image record is already deleted, blob deletion failure is logged but doesn't fail request
              }
            }
          } else {
            await logger.info('Image record deleted but no blob_url to delete', { imageId: linkedImageId })
          }
        } else {
          // Another process already deleted the image record - this is OK
          await logger.info('Image record already deleted by another process', { imageId: linkedImageId })
        }
      } catch (deleteError) {
        await logger.error('Failed to delete orphaned image', 
          deleteError instanceof Error ? deleteError : new Error(String(deleteError)),
          { imageId: linkedImageId }
        )
        // Don't fail the request - the link is already deleted
      }
    } else {
      await logger.info('Image is still in use, keeping image record', { 
        imageId: linkedImageId,
        eventCount: usage.event_count,
        eventImageCount: usage.event_image_count
      })
    }

    // Release lock after successful deletion
    await releaseLock()

    return successResponse(
      {
        message: "Event image removed successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

