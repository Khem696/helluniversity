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

    if (verificationResult.rows.length !== validImageIds.length) {
      await logger.warn('Batch delete rejected: some images not found or belong to different event', { 
        eventId,
        requested: validImageIds.length,
        found: verificationResult.rows.length
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Some images were not found or do not belong to this event",
        undefined,
        404,
        { requestId }
      )
    }

    // Get admin info from session for logging
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

    // Queue background jobs for each image deletion
    const jobIds: string[] = []
    const failedToQueue: Array<{ eventImageId: string; error: string }> = []
    // Map database rows to typed objects
    const verifiedImages: Array<{ id: string; image_id: string }> = verificationResult.rows.map((row: any) => ({
      id: row.id as string,
      image_id: row.image_id as string,
    }))

    for (const eventImage of verifiedImages) {
      try {
        const jobId = await enqueueJob(
          'delete-event-image',
          {
            eventId,
            eventImageId: eventImage.id,
            imageId: eventImage.image_id,
          },
          {
            priority: 5, // Medium priority
            maxRetries: 3,
          }
        )
        jobIds.push(jobId)
        await logger.info('Queued event image deletion job', {
          eventId,
          eventImageId: eventImage.id,
          imageId: eventImage.image_id,
          jobId,
        })
      } catch (queueError) {
        const errorMessage = queueError instanceof Error ? queueError.message : String(queueError)
        await logger.error(
          'Failed to queue event image deletion job',
          queueError instanceof Error ? queueError : new Error(errorMessage),
          {
            eventId,
            eventImageId: eventImage.id,
            imageId: eventImage.image_id,
          }
        )
        failedToQueue.push({
          eventImageId: eventImage.id,
          error: errorMessage,
        })
        // Continue with other images even if one fails to queue
      }
    }

    if (jobIds.length === 0) {
      await logger.error(
        'Failed to queue any deletion jobs',
        new Error('All deletion jobs failed to queue'),
        { 
          eventId, 
          imageIds: validImageIds,
          failures: failedToQueue
        }
      )
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to queue deletion jobs. The job queue may be unavailable. Please try again later.",
        undefined,
        500,
        { requestId }
      )
    }

    if (jobIds.length < validImageIds.length) {
      await logger.warn('Some deletion jobs failed to queue', {
        eventId,
        requested: validImageIds.length,
        queued: jobIds.length,
        failed: failedToQueue.length,
        failures: failedToQueue,
      })
    }

    await logger.info('Batch delete event images queued successfully', {
      eventId,
      imageCount: jobIds.length,
      jobIds,
    })

    return successResponse(
      {
        message: jobIds.length === validImageIds.length
          ? `Queued deletion for ${jobIds.length} image${jobIds.length !== 1 ? 's' : ''}`
          : `Queued deletion for ${jobIds.length} of ${validImageIds.length} image${validImageIds.length !== 1 ? 's' : ''}. ${failedToQueue.length} failed to queue.`,
        queued: jobIds.length,
        requested: validImageIds.length,
        failed: failedToQueue.length,
        jobIds,
        warnings: failedToQueue.length > 0 ? {
          message: "Some deletions failed to queue. They may need to be retried.",
          failedItems: failedToQueue,
        } : undefined,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

