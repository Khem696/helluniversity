/**
 * Admin Event Management API v1
 * 
 * Versioned endpoint for individual event management
 * Maintains backward compatibility with /api/admin/events/[id]
 * 
 * GET /api/v1/admin/events/[id] - Get event details
 * PATCH /api/v1/admin/events/[id] - Update event
 * DELETE /api/v1/admin/events/[id] - Delete event
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { createBangkokTimestamp } from "@/lib/timezone"

/**
 * Admin Event Management API
 * 
 * GET /api/admin/events/[id] - Get event by ID
 * PATCH /api/admin/events/[id] - Update event
 * DELETE /api/admin/events/[id] - Delete event
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

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin get event request', { eventId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get event rejected: authentication failed', { eventId: id })
      return authError
    }
    
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

export const PATCH = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin update event request', { eventId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update event rejected: authentication failed', { eventId: id })
      return authError
    }
    
    const body = await request.json()
    const { title, description, image_id, event_date, start_date, end_date } = body
    
    await logger.debug('Event update data', {
      eventId: id,
      hasTitle: title !== undefined,
      hasDescription: description !== undefined,
      hasImageId: image_id !== undefined,
    })

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Build update query dynamically
    const updates: string[] = []
    const args: any[] = []

    if (title !== undefined) {
      updates.push("title = ?")
      args.push(title)
    }

    if (description !== undefined) {
      updates.push("description = ?")
      args.push(description || null)
    }

    // Handle poster image replacement - check for orphaned old image
    let oldImageId: string | null = null
    if (image_id !== undefined) {
      // Get the old image_id before updating
      const oldEventResult = await db.execute({
        sql: "SELECT image_id FROM events WHERE id = ?",
        args: [id],
      })
      if (oldEventResult.rows.length > 0) {
        oldImageId = (oldEventResult.rows[0] as any).image_id
      }
      
      updates.push("image_id = ?")
      args.push(image_id || null)
    }

    // Convert dates to Unix timestamps
    // CRITICAL: Use createBangkokTimestamp for date strings (YYYY-MM-DD) to handle Bangkok timezone
    const convertToTimestamp = (date: string | number | null | undefined): number | null | undefined => {
      if (date === undefined) return undefined
      if (!date) return null
      if (typeof date === "number") return date
      
      // If it's a date string (YYYY-MM-DD), use createBangkokTimestamp
      // This ensures dates are interpreted in Bangkok timezone (GMT+7)
      if (typeof date === "string") {
        // Check if it's just a date string (YYYY-MM-DD) without time
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return createBangkokTimestamp(date)
        }
        // If it's an ISO string with time (e.g., "2025-11-13T10:00:00Z"), parse as UTC
        // This handles full ISO datetime strings from frontend
        return Math.floor(new Date(date).getTime() / 1000)
      }
      
      return null
    }

    if (event_date !== undefined) {
      updates.push("event_date = ?")
      args.push(convertToTimestamp(event_date))
    }

    if (start_date !== undefined) {
      updates.push("start_date = ?")
      args.push(convertToTimestamp(start_date))
    }

    if (end_date !== undefined) {
      updates.push("end_date = ?")
      args.push(convertToTimestamp(end_date))
    }

    if (updates.length === 0) {
      await logger.warn('Event update rejected: no fields to update', { eventId: id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No fields to update",
        undefined,
        400,
        { requestId }
      )
    }

    updates.push("updated_at = ?")
    args.push(now)
    args.push(id) // For WHERE clause

    await db.execute({
      sql: `UPDATE events SET ${updates.join(", ")} WHERE id = ?`,
      args,
    })
    
    await logger.info('Event updated in database', { eventId: id })

    // If poster image was replaced, check if old image is orphaned and delete it
    if (image_id !== undefined && oldImageId && oldImageId !== image_id) {
      await logger.info('Poster image replaced, checking if old image is orphaned', { 
        eventId: id, 
        oldImageId, 
        newImageId: image_id 
      })
      
      // Check if old image is still used elsewhere
      const usageCheck = await db.execute({
        sql: `
          SELECT 
            (SELECT COUNT(*) FROM events WHERE image_id = ?) as event_count,
            (SELECT COUNT(*) FROM event_images WHERE image_id = ?) as event_image_count
        `,
        args: [oldImageId, oldImageId],
      })

      const usage = usageCheck.rows[0] as any
      const isStillUsed = (usage.event_count > 0) || (usage.event_image_count > 0)

      if (!isStillUsed) {
        // Old image is orphaned - delete it and its blob
        await logger.info('Old poster image is orphaned, deleting image record and blob', { imageId: oldImageId })
        
        try {
          // Get blob URL before deleting
          const imageResult = await db.execute({
            sql: "SELECT blob_url FROM images WHERE id = ?",
            args: [oldImageId],
          })

          if (imageResult.rows.length > 0) {
            const blobUrl = (imageResult.rows[0] as any).blob_url
            
            // Delete blob from storage
            if (blobUrl) {
              try {
                const { deleteImage } = await import("@/lib/blob")
                await deleteImage(blobUrl)
                await logger.info('Deleted orphaned poster image blob', { imageId: oldImageId, blobUrl })
              } catch (blobError) {
                await logger.error('Failed to delete orphaned poster image blob', 
                  blobError instanceof Error ? blobError : new Error(String(blobError)),
                  { imageId: oldImageId, blobUrl }
                )
                // Continue with database deletion even if blob deletion fails
              }
            }
          }

          // Delete image record
          await db.execute({
            sql: "DELETE FROM images WHERE id = ?",
            args: [oldImageId],
          })
          
          await logger.info('Deleted orphaned poster image record', { imageId: oldImageId })
        } catch (deleteError) {
          await logger.error('Failed to delete orphaned poster image', 
            deleteError instanceof Error ? deleteError : new Error(String(deleteError)),
            { imageId: oldImageId }
          )
          // Don't fail the request - the event update succeeded
        }
      } else {
        await logger.info('Old poster image is still in use, keeping image record', { 
          imageId: oldImageId,
          eventCount: usage.event_count,
          eventImageCount: usage.event_image_count
        })
      }
    }

    // Fetch updated event with poster image
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
    
    await logger.info('Event update completed successfully', {
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

export const DELETE = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin delete event request', { eventId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete event rejected: authentication failed', { eventId: id })
      return authError
    }
    const db = getTursoClient()

    await db.execute({
      sql: "DELETE FROM events WHERE id = ?",
      args: [id],
    })
    
    await logger.info('Event deleted successfully', { eventId: id })

    return successResponse(
      {
        message: "Event deleted successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

