"use client"
import { useState, useEffect } from "react"
import { EventSlider } from "./EventSlider"
import { mockEvents, splitEventsByDate, type EventSlide } from "@/data/events"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import { API_PATHS } from "@/lib/api-config"

/**
 * EventSliders Component
 * 
 * This component handles the logic for splitting events into:
 * - Archive Slider (middle): Past/finished events
 * - Current Slider (bottom): Current/upcoming events
 * 
 * Fetches events from API, falls back to mock data if API fails
 */
export function EventSliders() {
  const [pastEvents, setPastEvents] = useState<EventSlide[]>([])
  const [currentEvents, setCurrentEvents] = useState<EventSlide[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchEvents() {
      try {
        const response = await fetch(API_PATHS.events)
        if (!response.ok) {
          throw new Error("Failed to fetch events")
        }

        const json = await response.json()
        if (json.success) {
          // Convert API events to EventSlide format
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
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
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

          // API returns { success: true, data: { pastEvents: [...], currentEvents: [...] } }
          // or { success: true, data: { events: [...] } }
          const responseData = json.data || json

          // Use API data if available
          if (responseData.pastEvents && responseData.currentEvents) {
            setPastEvents(responseData.pastEvents.map(convertToEventSlide))
            setCurrentEvents(responseData.currentEvents.map(convertToEventSlide))
          } else if (responseData.events) {
            // If single array, split by end_date
            // CRITICAL: Use Bangkok time for date comparisons to match business logic
            const { getBangkokTime } = await import("@/lib/timezone-client")
            const now = getBangkokTime()
            const past: EventSlide[] = []
            const current: EventSlide[] = []

            responseData.events.forEach((event: any) => {
              const endDate = event.end_date || event.event_date || event.start_date
              const startDate = event.start_date || event.event_date
              const slide = convertToEventSlide(event)
              
              if (!endDate) {
                // No date information, treat as current
                current.push(slide)
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
                past.push(slide)
              } else {
                current.push(slide)
              }
            })

            // Sort past: newest first
            past.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            // Sort current: oldest first
            current.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

            setPastEvents(past)
            setCurrentEvents(current)
          }
        } else {
          throw new Error("API returned error")
        }
      } catch (error) {
        console.error("Failed to fetch events from API, using mock data:", error)
        // Fallback to mock data
        const { pastEvents: mockPast, currentEvents: mockCurrent } = splitEventsByDate(mockEvents)
        setPastEvents(mockPast)
        setCurrentEvents(mockCurrent)
      } finally {
        setIsLoading(false)
      }
    }

    fetchEvents()
  }, [])

  // Show loading state (optional - can be removed if not needed)
  if (isLoading) {
    return null // Or return a loading spinner
  }

  return (
    <>
      {/* Archive Slider - Shows past/finished events (middle) */}
      {pastEvents.length > 0 && (
        <section id="event-sliders" className="relative w-full min-h-[100vh] h-[100vh] overflow-hidden" style={{ backgroundColor: "#3e82bb" }}>
          {/* Section Title */}
          <div className="absolute top-0 left-0 right-0 z-20 pt-[clamp(2rem,4vh,3rem)] sm:pt-[clamp(2.5rem,5vh,4rem)] lg:pt-[clamp(3rem,6vh,5rem)] px-4 sm:px-6 min-[769px]:px-8 lg:px-12 xl:px-16 3xl:px-20 4xl:px-28 5xl:px-36">
            <h2 className="text-white font-urbanist text-[clamp(24px,4vw,48px)] lg:text-[clamp(32px,5vw,56px)] font-extrabold leading-[1.2] text-center">
              Our Past Events
            </h2>
          </div>
          <EventSlider events={pastEvents} />
        </section>
      )}

      {/* Current Slider - Shows current/upcoming events (bottom) */}
      {currentEvents.length > 0 && (
        <section id={pastEvents.length === 0 ? "event-sliders" : undefined} className="relative w-full min-h-[100vh] h-[100vh] overflow-hidden" style={{ backgroundColor: "#A8D5BA" }}>
          {/* Section Title */}
          <div className="absolute top-0 left-0 right-0 z-20 pt-[clamp(2rem,4vh,3rem)] sm:pt-[clamp(2.5rem,5vh,4rem)] lg:pt-[clamp(3rem,6vh,5rem)] px-4 sm:px-6 min-[769px]:px-8 lg:px-12 xl:px-16 3xl:px-20 4xl:px-28 5xl:px-36">
            <h2 className="text-white font-urbanist text-[clamp(24px,4vw,48px)] lg:text-[clamp(32px,5vw,56px)] font-extrabold leading-[1.2] text-center">
              Upcoming Events
            </h2>
          </div>
          <EventSlider events={currentEvents} />
        </section>
      )}
    </>
  )
}

