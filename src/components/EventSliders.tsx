"use client"
import { EventSlider } from "./EventSlider"
import { mockEvents, splitEventsByDate } from "@/data/events"

/**
 * EventSliders Component
 * 
 * This component handles the logic for splitting events into:
 * - Archive Slider (middle): Past/finished events
 * - Current Slider (bottom): Current/upcoming events
 * 
 * Future: Replace mockEvents with API call or database query
 * Example:
 *   const events = await fetch('/api/events').then(res => res.json())
 */
export function EventSliders() {
  // Split events into past and current/upcoming
  const { pastEvents, currentEvents } = splitEventsByDate(mockEvents)

  return (
    <>
      {/* Archive Slider - Shows past/finished events (middle) */}
      {pastEvents.length > 0 && (
        <section className="relative w-full min-h-[100vh] h-[100vh] overflow-hidden" style={{ backgroundColor: "#3e82bb" }}>
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
        <section className="relative w-full min-h-[100vh] h-[100vh] overflow-hidden" style={{ backgroundColor: "#A8D5BA" }}>
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

