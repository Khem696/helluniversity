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
    const { title, description, image_id, event_date, start_date, end_date } = body
    
    await logger.debug('Event creation data', {
      hasTitle: !!title,
      hasDescription: !!description,
      hasImageId: !!image_id,
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
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        eventId,
        title,
        description || null,
        image_id || null,
        eventTimestamp,
        finalStartDate,
        endTimestamp,
        now,
        now,
      ],
    })

    // Fetch created event with image data
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.created_at, e.updated_at,
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
    const title = searchParams.get("title") || undefined
    const eventDate = searchParams.get("eventDate") || undefined
    const eventDateFrom = searchParams.get("eventDateFrom") || undefined
    const eventDateTo = searchParams.get("eventDateTo") || undefined
    const sortBy = (searchParams.get("sortBy") as "created_at" | "updated_at" | "start_date" | "end_date" | "event_date" | "title") || undefined
    const sortOrder = (searchParams.get("sortOrder") as "ASC" | "DESC") || undefined
    
    await logger.debug('List events parameters', { 
      limit, 
      offset, 
      upcoming,
      hasTitle: !!title,
      eventDate,
      eventDateFrom,
      eventDateTo,
      sortBy,
      sortOrder
    })

    const db = getTursoClient()

    // Build query
    // Optimized: Use explicit date comparisons to leverage indexes
    // Check each date column individually - SQLite can use indexes on each column
    // Priority: end_date > event_date > start_date (handled by COALESCE in ORDER BY)
    const conditions: string[] = []
    const args: any[] = []

    if (upcoming) {
      const now = Math.floor(Date.now() / 1000)
      // Current/upcoming events: check if any date field indicates future
      // Uses idx_events_end_date, idx_events_event_date, idx_events_start_date
      // SQLite can use multiple indexes with OR conditions
      conditions.push("(e.end_date >= ? OR e.event_date >= ? OR e.start_date >= ?)")
      args.push(now, now, now)
    }

    if (title) {
      // Uses idx_events_title index for prefix searches (title LIKE 'value%')
      conditions.push("e.title LIKE ?")
      args.push(`${title}%`)
    }

    // Single event date search (exact date match)
    if (eventDate) {
      // Convert YYYY-MM-DD to Unix timestamp (start and end of day in Bangkok timezone)
      const dateStart = new Date(eventDate + "T00:00:00+07:00") // Bangkok timezone
      const dateEnd = new Date(eventDate + "T23:59:59+07:00") // Bangkok timezone
      const startTimestamp = Math.floor(dateStart.getTime() / 1000)
      const endTimestamp = Math.floor(dateEnd.getTime() / 1000)
      // Uses idx_events_event_date index
      conditions.push("e.event_date >= ? AND e.event_date <= ?")
      args.push(startTimestamp, endTimestamp)
    }

    // Date range search (from and to)
    if (eventDateFrom) {
      // Convert YYYY-MM-DD to Unix timestamp (start of day in Bangkok timezone)
      const fromDate = new Date(eventDateFrom + "T00:00:00+07:00") // Bangkok timezone
      const fromTimestamp = Math.floor(fromDate.getTime() / 1000)
      // Uses idx_events_event_date index
      conditions.push("e.event_date >= ?")
      args.push(fromTimestamp)
    }

    if (eventDateTo) {
      // Convert YYYY-MM-DD to Unix timestamp (end of day in Bangkok timezone)
      const toDate = new Date(eventDateTo + "T23:59:59+07:00") // Bangkok timezone
      const toTimestamp = Math.floor(toDate.getTime() / 1000)
      // Uses idx_events_event_date index
      conditions.push("e.event_date <= ?")
      args.push(toTimestamp)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    // Get total count (uses indexes for filtering)
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM events e ${whereClause}`,
      args,
    })
    const total = (countResult.rows[0] as any).count

    // Get events
    // Optimize ORDER BY based on user preferences to leverage composite indexes
    // Default: Sort by date (COALESCE) then created_at DESC
    let orderByClause = ""
    if (sortBy) {
      // User-specified sort field
      const order = sortOrder || "DESC"
      if (sortBy === "title") {
        // Uses idx_events_title for alphabetical sorting
        orderByClause = `ORDER BY e.title ${order}, e.created_at DESC`
      } else if (sortBy === "created_at" || sortBy === "updated_at") {
        // Uses idx_events_created_at or idx_events_updated_at
        orderByClause = `ORDER BY e.${sortBy} ${order}`
      } else if (sortBy === "start_date" || sortBy === "end_date" || sortBy === "event_date") {
        // Uses individual date indexes
        orderByClause = `ORDER BY e.${sortBy} ${order}, e.created_at DESC`
      } else {
        // Fallback to default date sorting
        orderByClause = `ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC, e.created_at DESC`
      }
    } else {
      // Default: Sort by date (COALESCE) then created_at DESC
      // Uses idx_events_end_date_created_at or idx_events_start_date_created_at composite indexes
      orderByClause = `ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC, e.created_at DESC`
    }

    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ${whereClause}
        ${orderByClause}
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    })
    
    const events = result.rows as any[]
    
    // Fetch in-event photos for all events in the list (efficient batch query)
    let inEventPhotosMap: Map<string, any[]> = new Map()
    if (events.length > 0) {
      const eventIds = events.map(e => e.id)
      const placeholders = eventIds.map(() => "?").join(", ")
      
      const inEventPhotosResult = await db.execute({
        sql: `
          SELECT 
            ei.event_id, ei.id, ei.image_id, ei.display_order,
            i.blob_url, i.title, i.width, i.height
          FROM event_images ei
          JOIN images i ON ei.image_id = i.id
          WHERE ei.event_id IN (${placeholders}) AND ei.image_type = 'in_event'
          ORDER BY ei.event_id, ei.display_order ASC
        `,
        args: eventIds,
      })
      
      // Group photos by event_id
      inEventPhotosResult.rows.forEach((row: any) => {
        const eventId = row.event_id
        if (!inEventPhotosMap.has(eventId)) {
          inEventPhotosMap.set(eventId, [])
        }
        inEventPhotosMap.get(eventId)!.push({
          id: row.id,
          image_id: row.image_id,
          display_order: row.display_order,
          blob_url: row.blob_url,
          title: row.title,
          width: row.width,
          height: row.height,
        })
      })
    }
    
    // Attach in-event photos to each event
    const eventsWithPhotos = events.map((event: any) => ({
      ...event,
      in_event_photos: inEventPhotosMap.get(event.id) || [],
    }))
    
    await logger.info('Events list retrieved', {
      count: eventsWithPhotos.length,
      total,
      upcoming
    })

    return successResponse(
      {
        events: eventsWithPhotos,
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

