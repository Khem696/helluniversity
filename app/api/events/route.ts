import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Public Events API
 * 
 * GET /api/events
 * - Get all events, split into past and current/upcoming
 * - Public endpoint (no authentication required)
 * 
 * Query parameters:
 * - past: If true, return only past events (default: false)
 * - current: If true, return only current/upcoming events (default: false)
 * - If neither specified, returns both in separate arrays
 */

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/events')
    
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
    // CRITICAL: For events with same start_date and end_date (or only event_date),
    // we need to treat them as the end of the day (23:59:59) for comparison
    const pastEvents: any[] = []
    const currentEvents: any[] = []

    events.forEach((event: any) => {
      const endDate = event.end_date || event.event_date || event.start_date
      const startDate = event.start_date || event.event_date
      
      if (!endDate) {
        // No date information, treat as current
        currentEvents.push(event)
        return
      }
      
      // If start_date and end_date are the same (or only event_date exists),
      // treat the event as ending at 23:59:59 of that day for comparison
      // This ensures events on the same day are not incorrectly classified as past
      let comparisonTimestamp = endDate
      
      // Check if event has same start and end date (or only event_date)
      const hasEndDate = event.end_date != null
      const hasStartDate = event.start_date != null
      const hasEventDate = event.event_date != null
      
      if (startDate && endDate === startDate) {
        // Same start and end date - treat as end of day (23:59:59)
        // Add 86399 seconds (23 hours, 59 minutes, 59 seconds) to the date timestamp
        comparisonTimestamp = endDate + 86399
      } else if (!hasEndDate && !hasStartDate && hasEventDate) {
        // Only event_date exists - treat as end of day
        comparisonTimestamp = event.event_date + 86399
      }
      
      if (comparisonTimestamp < now) {
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
  }, { endpoint: '/api/events' })
}

