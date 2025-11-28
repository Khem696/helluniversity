/**
 * Admin Events API v1
 * 
 * Versioned endpoint for admin event management
 * Maintains backward compatibility with /api/admin/events
 * 
 * GET /api/v1/admin/events - List events
 * POST /api/v1/admin/events - Create event
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { randomUUID } from "crypto"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { createBangkokTimestamp, getBangkokTime } from "@/lib/timezone"

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

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin create event request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin create event rejected: authentication failed')
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 512000) // 500KB limit for event creation data
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
    // CRITICAL: Use Bangkok timezone for all timestamps
    const now = getBangkokTime()

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

    // Broadcast event created via SSE (after successful DB insert)
    try {
      const { broadcastEventUpdate } = await import('./stream/route')
      const eventRow = result.rows[0] as any
      
      broadcastEventUpdate('event:created', {
        id: eventRow.id || '',
        title: eventRow.title || '',
        description: eventRow.description || null,
        image_id: eventRow.image_id || null,
        event_date: eventRow.event_date || null,
        start_date: eventRow.start_date || null,
        end_date: eventRow.end_date || null,
        image_url: eventRow.image_url || null,
        image_title: eventRow.image_title || null,
        created_at: eventRow.created_at || Math.floor(Date.now() / 1000),
        updated_at: eventRow.updated_at || Math.floor(Date.now() / 1000),
      })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - logging is optional
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      try {
        const { logWarn } = await import('@/lib/logger')
        await logWarn('Failed to broadcast event created', {
          eventId,
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }

    return successResponse(
      {
        event: result.rows[0],
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin events list request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin events list rejected: authentication failed')
      return authError
    }
    
    const { searchParams } = new URL(request.url)
    // CRITICAL: Validate and clamp limit/offset to prevent DoS
    const rawLimit = parseInt(searchParams.get("limit") || "50")
    const rawOffset = parseInt(searchParams.get("offset") || "0")
    const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(1000, rawLimit))
    const offset = isNaN(rawOffset) ? 0 : Math.max(0, Math.min(1000000, rawOffset))
    
    const upcoming = searchParams.get("upcoming") === "true"
    const title = searchParams.get("title") || undefined
    const eventDate = searchParams.get("eventDate") || undefined
    const eventDateFrom = searchParams.get("eventDateFrom") || undefined
    const eventDateTo = searchParams.get("eventDateTo") || undefined
    
    // CRITICAL: Validate sortBy and sortOrder to prevent SQL injection
    const ALLOWED_SORT_FIELDS = ["created_at", "updated_at", "start_date", "end_date", "event_date", "title"] as const
    const ALLOWED_SORT_ORDERS = ["ASC", "DESC"] as const
    
    const rawSortBy = searchParams.get("sortBy")
    const sortBy = (rawSortBy && ALLOWED_SORT_FIELDS.includes(rawSortBy as any))
      ? (rawSortBy as typeof ALLOWED_SORT_FIELDS[number])
      : undefined
    
    const rawSortOrder = searchParams.get("sortOrder")
    const sortOrder = (rawSortOrder && ALLOWED_SORT_ORDERS.includes(rawSortOrder as any))
      ? (rawSortOrder as typeof ALLOWED_SORT_ORDERS[number])
      : undefined
    
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
      // CRITICAL: Use Bangkok timezone for all date comparisons
      const now = getBangkokTime()
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
    // CRITICAL: sortBy and sortOrder are already validated above
    let orderByClause = ""
    if (sortBy) {
      // User-specified sort field
      const order = sortOrder || "DESC" // sortOrder is validated, safe to use
      if (sortBy === "title") {
        // Uses idx_events_title for alphabetical sorting
        orderByClause = `ORDER BY e.title ${order}, e.created_at DESC`
      } else if (sortBy === "created_at" || sortBy === "updated_at") {
        // Uses idx_events_created_at or idx_events_updated_at - sortBy is validated, safe to use
        orderByClause = `ORDER BY e.${sortBy} ${order}`
      } else if (sortBy === "start_date" || sortBy === "end_date" || sortBy === "event_date") {
        // Uses individual date indexes - sortBy is validated, safe to use
        orderByClause = `ORDER BY e.${sortBy} ${order}, e.created_at DESC`
      } else {
        // Fallback to default date sorting (should not happen due to validation, but safe fallback)
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
  }, { endpoint: getRequestPath(request) })
})

