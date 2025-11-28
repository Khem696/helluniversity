"use client"
import { useState, useEffect } from "react"
import { EventSlider } from "./EventSlider"
import type { EventSlide } from "@/data/events"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import { API_PATHS } from "@/lib/api-config"

interface EventSlidersServerProps {
  pastEvents: EventSlide[]
  currentEvents: EventSlide[]
}

/**
 * EventSliders Server Component
 * 
 * Receives pre-fetched events from server for instant display,
 * then polls for updates every 30 seconds to show new events
 */
export function EventSlidersServer({ pastEvents: initialPastEvents, currentEvents: initialCurrentEvents }: EventSlidersServerProps) {
  const [pastEvents, setPastEvents] = useState<EventSlide[]>(initialPastEvents)
  const [currentEvents, setCurrentEvents] = useState<EventSlide[]>(initialCurrentEvents)

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null

    async function fetchEvents() {
      try {
        // Add cache-busting query parameter to ensure fresh data
        const response = await fetch(`${API_PATHS.events}?t=${Date.now()}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`)
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
            const pastSlides = responseData.pastEvents.map(convertToEventSlide)
            const currentSlides = responseData.currentEvents.map(convertToEventSlide)
            
            setPastEvents(pastSlides)
            setCurrentEvents(currentSlides)
          } else if (responseData.events) {
            // If single array, split by end_date
            // CRITICAL: All date comparisons use Bangkok timezone (GMT+7)
            const { getBangkokTime } = await import("@/lib/timezone-client")
            const now = getBangkokTime()
            const past: EventSlide[] = []
            const current: EventSlide[] = []

            responseData.events.forEach((event: any): void => {
              const endDate = event.end_date || event.event_date || event.start_date
              const startDate = event.start_date || event.event_date
              const slide = convertToEventSlide(event)
              
              if (!endDate) {
                // No date information, treat as current (always show upcoming events without dates)
                current.push(slide)
                return
              }
              
              // If start_date and end_date are the same (or only event_date exists),
              // treat the event as ending at 23:59:59 of that day in Bangkok timezone for comparison
              let comparisonTimestamp = endDate
              
              const hasEndDate = event.end_date != null
              const hasStartDate = event.start_date != null
              const hasEventDate = event.event_date != null
              
              if (startDate && endDate === startDate) {
                // Same start and end date - treat as end of day (23:59:59) in Bangkok timezone
                comparisonTimestamp = endDate + 86399
              } else if (!hasEndDate && !hasStartDate && hasEventDate) {
                // Only event_date exists - treat as end of day in Bangkok timezone
                comparisonTimestamp = event.event_date + 86399
              }
              
              // Compare using Bangkok timezone (UTC timestamps representing Bangkok time)
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
        }
      } catch (error) {
        // Don't update state on error - keep showing initial server-side data
      }
    }

    // Set up polling to refetch events every 30 seconds
    // This ensures newly created events appear on the home page without manual refresh
    pollInterval = setInterval(() => {
      fetchEvents()
    }, 30000) // 30 seconds

    // Cleanup interval on unmount
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, []) // Empty deps - only run once on mount

  return (
    <>
      {/* Archive Slider - Shows past/finished events (middle) */}
      {pastEvents.length > 0 && (
        <section id="event-sliders" className="relative w-full min-h-[100vh] h-[100dvh] overflow-hidden" style={{ backgroundColor: "#3e82bb" }}>
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
        <section id={pastEvents.length === 0 ? "event-sliders" : undefined} className="relative w-full min-h-[100vh] h-[100dvh] overflow-hidden" style={{ backgroundColor: "#A8D5BA" }}>
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

