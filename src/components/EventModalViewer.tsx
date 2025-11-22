"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { API_PATHS } from "@/lib/api-config"
import { X, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import { trackEventModalOpen, trackViewAllEventPhotos } from "@/lib/analytics"
import { Dialog, DialogContent, DialogTitle, DialogHeader } from "./ui/dialog"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./ui/carousel"

interface EventModalViewerProps {
  eventId: string | null
  isOpen: boolean
  onClose: () => void
}

interface EventData {
  id: string
  title: string
  description: string
  image_url: string | null
  start_date: number | null
  end_date: number | null
  in_event_photos: Array<{
    id: string
    blob_url: string
    title: string | null
    width: number
    height: number
  }>
}

export function EventModalViewer({ eventId, isOpen, onClose }: EventModalViewerProps) {
  const [eventData, setEventData] = useState<EventData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !eventId) {
      setEventData(null)
      setError(null)
      return
    }

    async function fetchEventDetails() {
      setIsLoading(true)
      setError(null)

      try {
        if (!eventId) return
        const response = await fetch(API_PATHS.event(eventId))
        if (!response.ok) {
          throw new Error("Failed to fetch event details")
        }

        const json = await response.json()
        if (json.success) {
          // API returns { success: true, data: { event: {...} } }
          const event = json.data?.event || json.event
          if (event) {
            setEventData(event)
            // Track modal open
            trackEventModalOpen(event.id, event.title)
          } else {
            throw new Error("Event not found")
          }
        } else {
          throw new Error("Event not found")
        }
      } catch (err) {
        console.error("Error fetching event details:", err)
        setError(err instanceof Error ? err.message : "Failed to load event")
      } finally {
        setIsLoading(false)
      }
    }

    fetchEventDetails()
  }, [eventId, isOpen])

  // Format date for display
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return ""
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  // Combine all images: poster first, then in-event photos
  const allImages = eventData
    ? [
        ...(eventData.image_url ? [{ url: eventData.image_url, title: "Event Poster" }] : []),
        ...eventData.in_event_photos.map((photo) => ({
          url: photo.blob_url,
          title: photo.title || "Event Photo",
        })),
      ]
    : []

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[95vh] p-0 gap-0 overflow-hidden bg-[#1a1a1a] border-0">
        {/* DialogTitle for accessibility (visually hidden since we have custom header) */}
        <DialogHeader className="sr-only">
          <DialogTitle>
            {eventData ? `${eventData.title} - Event Details` : "Event Details"}
          </DialogTitle>
        </DialogHeader>
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 sm:top-4 right-2 sm:right-4 z-50 p-2 sm:p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          aria-label="Close modal"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {isLoading && (
          <div className="flex items-center justify-center min-h-[50vh] p-8">
            <p className="text-white font-comfortaa text-[clamp(14px,1.5vw,18px)]">
              Loading event details...
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center min-h-[50vh] p-8">
            <p className="text-white font-comfortaa text-[clamp(14px,1.5vw,18px)] text-red-400">
              {error}
            </p>
          </div>
        )}

        {eventData && !isLoading && !error && (
          <div className="flex flex-col h-full max-h-[95vh] overflow-hidden">
            {/* Event Header */}
            <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-4 sm:pb-6 flex-shrink-0">
              <div className="flex items-start justify-between gap-4 mb-2 sm:mb-3">
                <h2 className="text-white font-urbanist text-[clamp(20px,3vw,32px)] lg:text-[clamp(24px,3.5vw,36px)] font-extrabold leading-[1.2] flex-1">
                  {eventData.title}
                </h2>
                {/* View All Event Photos Button */}
                <Link
                  href={`/events/${eventData.id}`}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors font-comfortaa text-[clamp(11px,1vw,13px)] sm:text-sm whitespace-nowrap"
                  onClick={(e) => {
                    // Track click
                    trackViewAllEventPhotos(eventData.id, eventData.title)
                    // Close modal when navigating
                    onClose()
                  }}
                >
                  <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">View All Event Photos</span>
                  <span className="sm:hidden">All Photos</span>
                </Link>
              </div>
              {eventData.description && (
                <p className="text-white/90 font-comfortaa text-[clamp(12px,1.2vw,16px)] leading-[1.6] mb-2">
                  {eventData.description}
                </p>
              )}
              <div className="flex flex-wrap gap-3 sm:gap-4 text-white/80 font-comfortaa text-[clamp(11px,1vw,14px)]">
                {eventData.start_date && (
                  <span>📅 {formatDate(eventData.start_date)}</span>
                )}
              </div>
            </div>

            {/* Image Carousel */}
            {allImages.length > 0 ? (
              <div className="flex-1 overflow-hidden px-2 sm:px-4 lg:px-6 pb-4 sm:pb-6">
                <Carousel
                  opts={{
                    align: "start",
                    loop: allImages.length > 1,
                  }}
                  className="w-full h-full"
                >
                  <CarouselContent className="h-full">
                    {allImages.map((image, index) => (
                      <CarouselItem key={index} className="h-full">
                        <div className="relative w-full h-full flex items-center justify-center bg-black/20 rounded-lg overflow-hidden">
                          <Image
                            src={image.url}
                            alt={image.title ? `${image.title} - Event photo from ${eventData.title} at Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand` : `${eventData.title} event photo at Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand`}
                            width={1920}
                            height={1080}
                            className="max-w-full max-h-full w-auto h-auto object-contain"
                            priority={index === 0}
                            loading={index === 0 ? "eager" : "lazy"}
                            quality={75}
                            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 90vw, 80vw"
                          />
                          {image.title && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 sm:p-4">
                              <p className="text-white font-comfortaa text-[clamp(12px,1.2vw,16px)] text-center">
                                {image.title}
                              </p>
                            </div>
                          )}
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  {allImages.length > 1 && (
                    <>
                      <CarouselPrevious className="left-2 sm:left-4 bg-black/50 hover:bg-black/70 border-0 text-white" />
                      <CarouselNext className="right-2 sm:right-4 bg-black/50 hover:bg-black/70 border-0 text-white" />
                    </>
                  )}
                </Carousel>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-white/60 font-comfortaa text-[clamp(14px,1.5vw,18px)]">
                  No images available for this event
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

