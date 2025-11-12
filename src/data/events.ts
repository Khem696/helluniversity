/**
 * Events Data Structure
 * 
 * This file contains the events data structure and mock data.
 * In the future, this will be replaced with API calls or database queries
 * for admin management system integration.
 */

import { withBasePath } from "@/lib/utils"

export interface EventSlide {
  id: string
  image: string
  title: string
  description: string
  date: string // ISO 8601 date format: "YYYY-MM-DD"
  time: string // Time range format: "HH.MM - HH.MM" (24-hour format)
}

/**
 * Parse time string to extract end time
 * @param timeString - Format: "13.00 - 20.00"
 * @returns End time as string: "20.00"
 */
export function parseEndTime(timeString: string): string {
  const parts = timeString.split(" - ")
  return parts.length > 1 ? parts[1].trim() : parts[0].trim()
}

/**
 * Convert date and time to ISO datetime string
 * @param date - ISO date string: "2025-11-15"
 * @param time - Time string: "20.00"
 * @returns ISO datetime string: "2025-11-15T20:00:00"
 */
export function combineDateTime(date: string, time: string): string {
  // Replace dots with colons for ISO format: "20.00" -> "20:00"
  const formattedTime = time.replace(/\./g, ":")
  return `${date}T${formattedTime}:00`
}

/**
 * Get event end datetime
 * @param event - EventSlide object
 * @returns ISO datetime string of event end time
 */
export function getEventEndDateTime(event: EventSlide): string {
  const endTime = parseEndTime(event.time)
  return combineDateTime(event.date, endTime)
}

/**
 * Check if event is past/finished
 * @param event - EventSlide object
 * @returns true if event end time is before current time (in Bangkok timezone)
 */
export function isPastEvent(event: EventSlide): boolean {
  // CRITICAL: Compare dates in Bangkok timezone to avoid timezone conversion issues
  // event.date is already in YYYY-MM-DD format (Bangkok timezone)
  // event.time is in HH.MM - HH.MM format (Bangkok timezone)
  const eventEndDateTime = getEventEndDateTime(event)
  
  // Parse event end datetime (format: "YYYY-MM-DDTHH:MM:00")
  const [eventDate, eventTime] = eventEndDateTime.split('T')
  const [eventHour, eventMinute] = eventTime.split(':').map(Number)
  
  // Get current date/time in Bangkok timezone
  // Use Intl.DateTimeFormat to get Bangkok timezone components without toISOString()
  const now = new Date()
  const bangkokFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  const parts = bangkokFormatter.formatToParts(now)
  const currentDateStr = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`
  const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  
  // Compare dates first, then times
  if (eventDate < currentDateStr) return true
  if (eventDate > currentDateStr) return false
  
  // Same date, compare times
  const eventTimeMinutes = eventHour * 60 + eventMinute
  const currentTimeMinutes = currentHour * 60 + currentMinute
  return eventTimeMinutes < currentTimeMinutes
}

/**
 * Split events into past and current/upcoming
 * @param events - Array of EventSlide objects
 * @returns Object with pastEvents and currentEvents arrays, both sorted
 */
export function splitEventsByDate(events: EventSlide[]): {
  pastEvents: EventSlide[]
  currentEvents: EventSlide[]
} {
  const pastEvents: EventSlide[] = []
  const currentEvents: EventSlide[] = []

  events.forEach((event) => {
    if (isPastEvent(event)) {
      pastEvents.push(event)
    } else {
      currentEvents.push(event)
    }
  })

  // Sort past events: newest first (descending by date)
  pastEvents.sort((a, b) => {
    const dateA = new Date(a.date).getTime()
    const dateB = new Date(b.date).getTime()
    return dateB - dateA
  })

  // Sort current events: oldest first (ascending by date)
  currentEvents.sort((a, b) => {
    const dateA = new Date(a.date).getTime()
    const dateB = new Date(b.date).getTime()
    return dateA - dateB
  })

  return { pastEvents, currentEvents }
}

/**
 * Mock Events Data
 * 
 * TODO: Replace with API call or database query in future admin system
 * Example API structure:
 * - GET /api/events - Fetch all events
 * - POST /api/events - Create new event (admin)
 * - PUT /api/events/:id - Update event (admin)
 * - DELETE /api/events/:id - Delete event (admin)
 */
export const mockEvents: EventSlide[] = [
  {
    id: "event-001",
    image: withBasePath('/assets/event/IMG_1430.JPG'),
    title: "WELCOME BACK TO HELL UNIVERSITY",
    description: "SATURDAY 15TH NOVEMBER 2025 13.00 - 20.00",
    date: "2025-11-15",
    time: "13.00 - 20.00"
  },
  // Mock past event with gray placeholder
  {
    id: "event-002",
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1200'%3E%3Crect width='800' height='1200' fill='%23999'/%3E%3Ctext x='50%25' y='50%25' font-family='Arial' font-size='24' fill='white' text-anchor='middle' dominant-baseline='middle'%3EPast Event%3C/text%3E%3C/svg%3E",
    title: "PAST EVENT EXAMPLE",
    description: "FRIDAY 1ST OCTOBER 2024 10.00 - 18.00",
    date: "2024-10-01",
    time: "10.00 - 18.00"
  }
]

