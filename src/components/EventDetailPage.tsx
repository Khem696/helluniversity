"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, Calendar } from "lucide-react"
import Image from "next/image"
import { trackEventPageView, trackRelatedEventClick, trackInternalLinkClick, trackUserJourneyStep } from "@/lib/analytics"
import { SocialShareButtons } from "./SocialShareButtons"

interface RelatedEvent {
  id: string
  title: string
  description: string | null
  image_url: string | null
  start_date: number | null
  end_date: number | null
  event_date: number | null
}

interface EventDetailPageProps {
  event: {
    id: string
    title: string
    description: string
    image_url: string | null
    start_date: number | null
    end_date: number | null
    event_date: number | null
    in_event_photos: Array<{
      blob_url: string
      title: string | null
      width: number
      height: number
    }>
  }
  relatedEvents?: RelatedEvent[]
}

export function EventDetailPage({ event, relatedEvents = [] }: EventDetailPageProps) {
  // Track page view on mount with engagement tracking
  useEffect(() => {
    // Extract event type from title or description if possible
    const eventType = event.description?.toLowerCase().includes('workshop') ? 'workshop' :
                     event.description?.toLowerCase().includes('exhibition') ? 'exhibition' :
                     event.description?.toLowerCase().includes('concert') ? 'concert' :
                     'cultural_event'
    
    trackEventPageView(event.id, event.title, eventType)
    
    // Track initial engagement
    trackUserJourneyStep('event_page_viewed', 'event_discovery', {
      event_id: event.id,
      event_title: event.title,
    })
  }, [event.id, event.title, event.description])

  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return ""
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  const allImages = [
    ...(event.image_url ? [{ url: event.image_url, title: "Event Poster" }] : []),
    ...event.in_event_photos.map((photo) => ({
      url: photo.blob_url,
      title: photo.title || "Event Photo",
    })),
  ]

  return (
    <div className="min-h-screen bg-[#f4f1ed]">
      {/* Back Button - No header on event pages, so normal top padding */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors font-comfortaa text-sm sm:text-base"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>

      {/* Event Content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
        {/* Event Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-urbanist font-extrabold text-gray-900 mb-4">
            {event.title}
          </h1>
          {event.description && (
            <p className="text-lg sm:text-xl text-gray-700 font-comfortaa leading-relaxed mb-4">
              {event.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4 text-gray-600 font-comfortaa text-sm sm:text-base">
            {event.start_date && (
              <span>📅 {formatDate(event.start_date)}</span>
            )}
            {event.end_date && event.end_date !== event.start_date && (
              <span>→ {formatDate(event.end_date)}</span>
            )}
            {!event.start_date && !event.end_date && event.event_date && (
              <span>📅 {formatDate(event.event_date)}</span>
            )}
          </div>
          
          {/* Social Share Buttons */}
          <div className="mt-4">
            <SocialShareButtons
              url={`/events/${event.id}`}
              title={event.title}
              description={event.description || `Join us at Hell University for ${event.title}`}
              variant="compact"
            />
          </div>
        </div>

        {/* Event Images */}
        {allImages.length > 0 && (
          <section aria-label="Event photos">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {allImages.map((image, index) => (
                <article key={index} className="relative aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden">
                  <Image
                    src={image.url}
                    alt={image.title ? `${image.title} - ${event.title} event photo at Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand` : `${event.title} - Cultural event photo at Hell University in Mae Taeng, Chiang Mai, Thailand. Book event space and arrange activities.`}
                    fill
                    className="object-cover"
                    loading={index < 3 ? "eager" : "lazy"}
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    fetchPriority={index < 3 ? "high" : "auto"}
                  />
                  {image.title && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                      <p className="text-white font-comfortaa text-sm text-center">
                        {image.title}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Related Events Section */}
        {relatedEvents.length > 0 && (
          <section className="mt-12 sm:mt-16 lg:mt-20" aria-label="Related events">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-urbanist font-extrabold text-gray-900 mb-6 sm:mb-8">
              Related Events
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {relatedEvents.map((relatedEvent) => {
                const eventDate = relatedEvent.start_date || relatedEvent.event_date || relatedEvent.end_date
                const formattedDate = eventDate
                  ? new Date((eventDate as number) * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""

                return (
                  <article key={relatedEvent.id} className="bg-white rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                    <Link 
                      href={`/events/${relatedEvent.id}`} 
                      className="block"
                      onClick={() => trackRelatedEventClick(relatedEvent.id, relatedEvent.title)}
                    >
                      {relatedEvent.image_url ? (
                        <div className="relative aspect-[4/3] bg-gray-200">
                          <Image
                            src={relatedEvent.image_url}
                            alt={`${relatedEvent.title} - Cultural event at Hell University in Mae Taeng, Chiang Mai, Thailand`}
                            fill
                            className="object-cover"
                            loading="lazy"
                            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          />
                        </div>
                      ) : (
                        <div className="aspect-[4/3] bg-gray-200 flex items-center justify-center">
                          <Calendar className="w-12 h-12 text-gray-400" />
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="text-lg font-urbanist font-bold text-gray-900 mb-2 line-clamp-2">
                          {relatedEvent.title}
                        </h3>
                        {formattedDate && (
                          <p className="text-sm text-gray-600 font-comfortaa mb-2">
                            📅 {formattedDate}
                          </p>
                        )}
                        {relatedEvent.description && (
                          <p className="text-sm text-gray-700 font-comfortaa line-clamp-2">
                            {relatedEvent.description}
                          </p>
                        )}
                        <p className="text-sm text-[#5B9AB8] font-comfortaa font-medium mt-3">
                          View Event →
                        </p>
                      </div>
                    </Link>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {/* Internal Links Section */}
        <nav className="mt-12 sm:mt-16 lg:mt-20 pt-8 border-t border-gray-300" aria-label="Related pages">
          <h2 className="text-xl sm:text-2xl font-urbanist font-bold text-gray-900 mb-4">
            Explore More
          </h2>
          <ul className="flex flex-wrap gap-4 sm:gap-6">
            <li>
              <Link 
                href="/" 
                className="text-gray-700 hover:text-[#5B9AB8] font-comfortaa text-sm sm:text-base underline transition-colors"
                onClick={() => trackInternalLinkClick('View All Events', '/', 'event_detail')}
              >
                View All Events
              </Link>
            </li>
            <li>
              <Link 
                href="/studio-gallery" 
                className="text-gray-700 hover:text-[#5B9AB8] font-comfortaa text-sm sm:text-base underline transition-colors"
                onClick={() => trackInternalLinkClick('Studio & Gallery', '/studio-gallery', 'event_detail')}
              >
                Studio & Gallery
              </Link>
            </li>
            <li>
              <Link 
                href="/about" 
                className="text-gray-700 hover:text-[#5B9AB8] font-comfortaa text-sm sm:text-base underline transition-colors"
                onClick={() => trackInternalLinkClick('About Us', '/about', 'event_detail')}
              >
                About Us
              </Link>
            </li>
            <li>
              <Link 
                href="/contact" 
                className="text-gray-700 hover:text-[#5B9AB8] font-comfortaa text-sm sm:text-base underline transition-colors"
                onClick={() => trackInternalLinkClick('Contact', '/contact', 'event_detail')}
              >
                Contact
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  )
}

