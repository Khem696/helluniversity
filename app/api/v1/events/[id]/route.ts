/**
 * Event Details API v1
 * 
 * Versioned endpoint for individual event details
 * 
 * GET /api/v1/events/[id] - Get event details with poster and in-event photos
 * - Public endpoint (no authentication required)
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Public get event request', { eventId: id })
    
    const db = getTursoClient()

    // Get event with poster image
    const eventResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [id],
    })

    if (eventResult.rows.length === 0) {
      await logger.warn('Event not found', { eventId: id })
      return notFoundResponse('Event', { requestId })
    }

    // Get in-event photos
    const inEventPhotos = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.image_id, ei.display_order,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.event_id = ? AND ei.image_type = 'in_event'
        ORDER BY ei.display_order ASC
      `,
      args: [id],
    })
    
    await logger.info('Event retrieved', {
      eventId: id,
      inEventPhotosCount: inEventPhotos.rows.length
    })

    return successResponse(
      {
        event: {
          ...eventResult.rows[0],
          in_event_photos: inEventPhotos.rows,
        },
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

