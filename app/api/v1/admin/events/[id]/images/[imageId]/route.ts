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

    const body = await request.json()
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

    const db = getTursoClient()

    // Get the image_id before deleting the event_images record
    const eventImageResult = await db.execute({
      sql: "SELECT image_id FROM event_images WHERE id = ?",
      args: [imageId],
    })

    if (eventImageResult.rows.length === 0) {
      await logger.warn('Event image not found', { eventId, imageId })
      return notFoundResponse('Event image', { requestId })
    }

    const linkedImageId = (eventImageResult.rows[0] as any).image_id

    // Delete the event_images link
    await db.execute({
      sql: "DELETE FROM event_images WHERE id = ?",
      args: [imageId],
    })
    
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
      await logger.info('Image is orphaned, deleting image record and blob', { imageId: linkedImageId })
      
      try {
        // Get blob URL before deleting
        const imageResult = await db.execute({
          sql: "SELECT blob_url FROM images WHERE id = ?",
          args: [linkedImageId],
        })

        if (imageResult.rows.length > 0) {
          const blobUrl = (imageResult.rows[0] as any).blob_url
          
          // Delete blob from storage
          if (blobUrl) {
            try {
              const { deleteImage } = await import("@/lib/blob")
              await deleteImage(blobUrl)
              await logger.info('Deleted orphaned image blob', { imageId: linkedImageId, blobUrl })
            } catch (blobError) {
              await logger.error('Failed to delete orphaned image blob', 
                blobError instanceof Error ? blobError : new Error(String(blobError)),
                { imageId: linkedImageId, blobUrl }
              )
              // Continue with database deletion even if blob deletion fails
            }
          }
        }

        // Delete image record
        await db.execute({
          sql: "DELETE FROM images WHERE id = ?",
          args: [linkedImageId],
        })
        
        await logger.info('Deleted orphaned image record', { imageId: linkedImageId })
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

    return successResponse(
      {
        message: "Event image removed successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

