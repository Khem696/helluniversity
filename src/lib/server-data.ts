/**
 * Server-side data fetching functions
 * 
 * These functions are used to fetch data on the server side
 * for better performance and SEO. They can be used in Server Components.
 */

import { getTursoClient } from "@/lib/turso"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import type { EventSlide } from "@/data/events"

/**
 * Fetch booking enabled status from database
 * Returns true if bookings are enabled, false otherwise
 */
export async function getBookingEnabledStatus(): Promise<boolean> {
  try {
    const db = getTursoClient()
    
    // Check if settings table exists
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length > 0) {
      // Table exists, try to get the setting
      const result = await db.execute({
        sql: `SELECT value FROM settings WHERE key = 'bookings_enabled'`,
        args: [],
      })

      if (result.rows.length > 0) {
        const setting = result.rows[0] as any
        // Explicitly check for enabled values (1, '1', true)
        // Everything else (0, '0', false, null, undefined) should be treated as disabled
        const value = setting.value
        return value === '1' || value === 1 || value === true
      }
    }
    
    // Default to disabled if table doesn't exist or setting doesn't exist (safer default)
    return false
  } catch (error) {
    // If there's any error, default to disabled (safer than showing button when it shouldn't be)
    console.error("Error fetching booking status:", error)
    return false
  }
}

/**
 * Fetch events from database and convert to EventSlide format
 * Returns both past and current events
 */
export async function getEvents(): Promise<{ pastEvents: EventSlide[]; currentEvents: EventSlide[] }> {
  try {
    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Get all events with poster image
    const eventsResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) DESC
      `,
      args: [],
    })

    const convertToEventSlide = (event: any): EventSlide => {
      // Use end_date if available, otherwise start_date or event_date
      const eventDate = event.end_date 
        ? new Date(event.end_date * 1000)
        : event.start_date
        ? new Date(event.start_date * 1000)
        : event.event_date
        ? new Date(event.event_date * 1000)
        : new Date()

      // Format date as YYYY-MM-DD in Bangkok timezone
      const dateStr = dateToBangkokDateString(eventDate)
      
      // Extract time from description or use default
      const timeMatch = event.description?.match(/(\d{1,2}\.\d{2})\s*-\s*(\d{1,2}\.\d{2})/)
      const time = timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "00.00 - 23.59"

      return {
        id: event.id,
        image: event.image_url || "",
        title: event.title,
        description: event.description || "",
        date: dateStr,
        time: time,
      }
    }

    const past: EventSlide[] = []
    const current: EventSlide[] = []

    for (const row of eventsResult.rows) {
      const event = row as any
      const endDate = event.end_date || event.event_date || event.start_date
      const startDate = event.start_date || event.event_date
      const slide = convertToEventSlide(event)
      
      if (!endDate) {
        // No date information, treat as current
        current.push(slide)
        continue
      }
      
      // If start_date and end_date are the same (or only event_date exists),
      // treat the event as ending at 23:59:59 of that day for comparison
      let comparisonTimestamp = endDate
      
      const hasEndDate = event.end_date != null
      const hasStartDate = event.start_date != null
      const hasEventDate = event.event_date != null
      
      if (startDate && endDate === startDate) {
        // Same start and end date - treat as end of day (23:59:59)
        comparisonTimestamp = endDate + 86399
      } else if (!hasEndDate && !hasStartDate && hasEventDate) {
        // Only event_date exists - treat as end of day
        comparisonTimestamp = event.event_date + 86399
      }
      
      if (comparisonTimestamp < now) {
        past.push(slide)
      } else {
        current.push(slide)
      }
    }

    // Sort past: newest first
    past.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    // Sort current: oldest first
    current.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    return { pastEvents: past, currentEvents: current }
  } catch (error) {
    console.error("Error fetching events:", error)
    // Return empty arrays on error
    return { pastEvents: [], currentEvents: [] }
  }
}

