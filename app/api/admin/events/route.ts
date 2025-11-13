import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { randomUUID } from "crypto"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { createBangkokTimestamp } from "@/lib/timezone"

/**
 * Admin Events CRUD API
 * 
 * POST /api/admin/events - Create event
 * GET /api/admin/events - List events
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

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/events')
    
    await logger.info('Admin create event request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin create event rejected: authentication failed')
      return authError
    }
    
    const body = await request.json()
    const { title, description, image_id, event_date, start_date, end_date, location } = body
    
    await logger.debug('Event creation data', {
      hasTitle: !!title,
      hasDescription: !!description,
      hasImageId: !!image_id,
      hasLocation: !!location
    })

    if (!title) {
      await logger.warn('Event creation rejected: missing title')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Title is required",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()
    const eventId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Convert dates to Unix timestamps
    // CRITICAL: Use createBangkokTimestamp for date strings (YYYY-MM-DD) to handle Bangkok timezone
    const convertToTimestamp = (date: string | number | null | undefined): number | null => {
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

    const eventTimestamp = convertToTimestamp(event_date)
    const startTimestamp = convertToTimestamp(start_date)
    const endTimestamp = convertToTimestamp(end_date)

    // Use start_date if provided, otherwise fall back to event_date
    const finalStartDate = startTimestamp || eventTimestamp

    await db.execute({
      sql: `
        INSERT INTO events (
          id, title, description, image_id, event_date, start_date, end_date,
          location, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        eventId,
        title,
        description || null,
        image_id || null,
        eventTimestamp,
        finalStartDate,
        endTimestamp,
        location || null,
        now,
        now,
      ],
    })

    // Fetch created event with image data
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [eventId],
    })
    
    await logger.info('Event created successfully', { eventId, title })

    return successResponse(
      {
        event: result.rows[0],
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/events' })
}

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/events')
    
    await logger.info('Admin events list request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin events list rejected: authentication failed')
      return authError
    }
    
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const upcoming = searchParams.get("upcoming") === "true"
    
    await logger.debug('List events parameters', { limit, offset, upcoming })

    const db = getTursoClient()

    // Build query
    let whereClause = ""
    const args: any[] = []

    if (upcoming) {
      const now = Math.floor(Date.now() / 1000)
      // Use end_date if available, otherwise fall back to event_date
      whereClause = "WHERE COALESCE(e.end_date, e.event_date, e.start_date) >= ?"
      args.push(now)
    }

    // Get total count
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM events e ${whereClause}`,
      args: upcoming ? args : [],
    })
    const total = (countResult.rows[0] as any).count

    // Get events
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ${whereClause}
        ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC, e.created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...(upcoming ? args : []), limit, offset],
    })
    
    await logger.info('Events list retrieved', {
      count: result.rows.length,
      total,
      upcoming
    })

    return successResponse(
      {
        events: result.rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/events' })
}

