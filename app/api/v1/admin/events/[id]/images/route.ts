/**
 * Admin Event Images API v1
 * 
 * Versioned endpoint for event image management
 * Maintains backward compatibility with /api/admin/events/[id]/images
 * 
 * GET /api/v1/admin/events/[id]/images - Get event images
 * POST /api/v1/admin/events/[id]/images - Add image to event
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { randomUUID } from "crypto"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Event Images Management API
 * 
 * POST /api/admin/events/[id]/images - Add image to event
 * GET /api/admin/events/[id]/images - List event images
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

export const POST = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id: eventId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin add event image request', { eventId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin add event image rejected: authentication failed', { eventId })
      return authError
    }

    const body = await request.json()
    const { image_id, image_type = "in_event", display_order } = body
    
    await logger.debug('Add event image data', { eventId, image_id, image_type, display_order })

    if (!image_id) {
      await logger.warn('Add event image rejected: missing image_id', { eventId })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "image_id is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate image_type
    if (image_type !== "poster" && image_type !== "in_event") {
      await logger.warn('Add event image rejected: invalid image_type', { eventId, image_type })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "image_type must be 'poster' or 'in_event'",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()
    const eventImageId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Get max display_order if not provided
    let finalDisplayOrder = display_order
    if (finalDisplayOrder === undefined || finalDisplayOrder === null) {
      const maxResult = await db.execute({
        sql: `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM event_images WHERE event_id = ? AND image_type = ?`,
        args: [eventId, image_type],
      })
      finalDisplayOrder = (maxResult.rows[0] as any).next_order
    }

    await db.execute({
      sql: `
        INSERT INTO event_images (
          id, event_id, image_id, image_type, display_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [eventImageId, eventId, image_id, image_type, finalDisplayOrder, now],
    })

    // Fetch created event_image with image data
    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.id = ?
      `,
      args: [eventImageId],
    })

    await logger.info('Event image added successfully', {
      eventId,
      eventImageId: eventImageId,
      image_type
    })
    
    return successResponse(
      {
        event_image: result.rows[0],
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id: eventId } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin get event images request', { eventId })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get event images rejected: authentication failed', { eventId })
      return authError
    }

    const { searchParams } = new URL(request.url)
    const imageType = searchParams.get("image_type") || null
    
    await logger.debug('Get event images parameters', { eventId, imageType: imageType || undefined })

    const db = getTursoClient()

    let whereClause = "WHERE ei.event_id = ?"
    const args: any[] = [eventId]

    if (imageType) {
      whereClause += " AND ei.image_type = ?"
      args.push(imageType)
    }

    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        ${whereClause}
        ORDER BY ei.display_order ASC
      `,
      args,
    })
    
    await logger.info('Event images retrieved', {
      eventId,
      imagesCount: result.rows.length,
      imageType: imageType || undefined
    })

    return successResponse(
      {
        event_images: result.rows,
        count: result.rows.length,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

