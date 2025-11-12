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

    if (pastOnly) {
      // Past events: end_date < now
      whereClause = "WHERE COALESCE(e.end_date, e.event_date, e.start_date) < ?"
      args = [now]
    } else if (currentOnly) {
      // Current/upcoming events: end_date >= now
      whereClause = "WHERE COALESCE(e.end_date, e.event_date, e.start_date) >= ?"
      args = [now]
    }

    // Get events with poster image
    const eventsResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ${whereClause}
        ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC
      `,
      args,
    })

    const events = eventsResult.rows

    // If not filtering, split into past and current
    if (!pastOnly && !currentOnly) {
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
    }

    await logger.info('Events retrieved', { count: events.length })
    
    return successResponse(
      {
        events,
        count: events.length,
      },
      { requestId }
    )
  }, { endpoint: '/api/events' })
}

