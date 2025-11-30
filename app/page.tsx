import { Hero } from "@/components/Hero"
import { EventSlidersServer } from "@/components/EventSlidersServer"
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { getEvents } from "@/lib/server-data"
import { mockEvents, splitEventsByDate } from "@/data/events"

export const metadata = generateSEOMetadata({
  title: 'Home',
  description: 'Hell University - A Cultural Hub in Mae Taeng, Chiang Mai, Thailand. Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings in Northern Thailand.',
  keywords: [
    'cultural hub',
    'event booking',
    'book event space',
    'arrange activities',
    'event venue booking',
    'cultural activities booking',
    'Mae Taeng',
    'Chiang Mai',
    'Thailand',
    'event space rental',
    'book cultural events',
    'activity arrangement',
    'creative space booking',
    'studio gallery',
    'art community',
    'cultural engagement',
    'art workshops',
    'creative events',
    'art exhibitions',
    'community events',
    'venue booking',
    'event arrangement',
  ],
  url: getBaseUrl(),
  type: 'website',
})

// Force dynamic rendering to prevent caching of events
// This ensures deleted events are immediately removed from the page
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Home() {
  // Fetch events server-side for instant display
  let pastEvents, currentEvents
  try {
    const events = await getEvents()
    pastEvents = events.pastEvents
    currentEvents = events.currentEvents
  } catch (error) {
    console.error("Failed to fetch events server-side, using mock data:", error)
    // Fallback to mock data if server fetch fails
    const { pastEvents: mockPast, currentEvents: mockCurrent } = splitEventsByDate(mockEvents)
    pastEvents = mockPast
    currentEvents = mockCurrent
  }

  return (
    <div className="min-h-vp bg-[#f4f1ed] no-horiz-overflow">
      <main id="main-content">
        <Hero />
        <EventSlidersServer pastEvents={pastEvents} currentEvents={currentEvents} />
      </main>
    </div>
  )
}