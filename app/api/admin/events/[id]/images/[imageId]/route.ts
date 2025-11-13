import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  return withErrorHandling(async () => {
    const { id: eventId, imageId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/events/[id]/images/[imageId]')
    
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
  }, { endpoint: '/api/admin/events/[id]/images/[imageId]' })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  return withErrorHandling(async () => {
    const { id: eventId, imageId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/events/[id]/images/[imageId]')
    
    await logger.info('Admin delete event image request', { eventId, imageId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete event image rejected: authentication failed', { eventId, imageId })
      return authError
    }

    const db = getTursoClient()

    await db.execute({
      sql: "DELETE FROM event_images WHERE id = ?",
      args: [imageId],
    })
    
    await logger.info('Event image deleted successfully', { eventId, imageId })

    return successResponse(
      {
        message: "Event image removed successfully",
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/events/[id]/images/[imageId]' })
}

