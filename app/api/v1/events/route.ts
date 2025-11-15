/**
 * Events API v1
 * 
 * Versioned endpoint for public events
 * 
 * GET /api/v1/events - Get all events
 * - Public endpoint (no authentication required)
 * 
 * Query parameters:
 * - past: If true, return only past events (default: false)
 * - current: If true, return only current/upcoming events (default: false)
 * - If neither specified, returns both in separate arrays
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Public events list request received')
    
    const { searchParams } = new URL(request.url)
    const pastOnly = searchParams.get("past") === "true"
    const currentOnly = searchParams.get("current") === "true"
    const now = Math.floor(Date.now() / 1000)
    
    await logger.debug('Events list parameters', { pastOnly, currentOnly })

    const db = getTursoClient()

    let whereClause = ""
    let args: any[] = []

    // Optimized: Use explicit date comparisons to leverage indexes
    // Check each date column individually - SQLite can use indexes on each column
    // Priority: end_date > event_date > start_date (handled by COALESCE in ORDER BY)
    if (pastOnly) {
      // Past events: check if any date field indicates past
      // Uses idx_events_end_date, idx_events_event_date, idx_events_start_date
      // SQLite can use multiple indexes with OR conditions
      whereClause = "WHERE (e.end_date < ? OR e.event_date < ? OR e.start_date < ?)"
      args = [now, now, now]
    } else if (currentOnly) {
      // Current/upcoming events: check if any date field indicates future
      // Uses idx_events_end_date, idx_events_event_date, idx_events_start_date
      // SQLite can use multiple indexes with OR conditions
      whereClause = "WHERE (e.end_date >= ? OR e.event_date >= ? OR e.start_date >= ?)"
      args = [now, now, now]
    }

    // Get events with poster image
    // ORDER BY uses COALESCE for sorting (less critical for index usage)
    // But individual date columns have indexes for WHERE clause filtering
    const eventsResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ${whereClause}
        ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC
      `,
      args,
    })

    const events = eventsResult.rows

    // Split events into past and current/upcoming
    const pastEvents: any[] = []
    const currentEvents: any[] = []

    events.forEach((event: any) => {
      const endDate = event.end_date || event.event_date || event.start_date
      if (endDate && endDate < now) {
        pastEvents.push(event)
      } else {
        currentEvents.push(event)
      }
    })

    // Sort past events: newest first
    pastEvents.sort((a, b) => {
      const dateA = a.end_date || a.event_date || a.start_date || 0
      const dateB = b.end_date || b.event_date || b.start_date || 0
      return dateB - dateA
    })

    // If filtering, return only the requested category
    if (pastOnly) {
      await logger.info('Events retrieved (past only)', {
        pastCount: pastEvents.length,
        total: events.length
      })
      
      return successResponse(
        {
          pastEvents,
          currentEvents: [],
          count: {
            past: pastEvents.length,
            current: 0,
            total: events.length,
          },
        },
        { requestId }
      )
    } else if (currentOnly) {
      await logger.info('Events retrieved (current only)', {
        currentCount: currentEvents.length,
        total: events.length
      })
      
      return successResponse(
        {
          pastEvents: [],
          currentEvents,
          count: {
            past: 0,
            current: currentEvents.length,
            total: events.length,
          },
        },
        { requestId }
      )
    }

    // Return both past and current events
    await logger.info('Events retrieved (split)', {
      pastCount: pastEvents.length,
      currentCount: currentEvents.length,
      total: events.length
    })
    
    return successResponse(
      {
        pastEvents,
        currentEvents,
        count: {
          past: pastEvents.length,
          current: currentEvents.length,
          total: events.length,
        },
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

