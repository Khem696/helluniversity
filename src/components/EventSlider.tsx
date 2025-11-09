"use client"
import { useState, useEffect } from "react"
import { EventSlide } from "@/data/events"
import { EventModalViewer } from "./EventModalViewer"

interface EventSliderProps {
  events: EventSlide[]
}

export function EventSlider({ events }: EventSliderProps) {
  // Use provided events
  const slides = events
  const [currentSlide, setCurrentSlide] = useState(0)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Auto-rotate only when there are 2+ slides
  useEffect(() => {
    if (slides.length <= 1) {
      return // Disable auto-rotate when only 1 slide
    }

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length)
    }, 7000)

    return () => clearInterval(interval)
  }, [slides.length])

  if (slides.length === 0) {
    return null
  }

  const handleEventClick = (eventId: string) => {
    setSelectedEventId(eventId)
    setIsModalOpen(true)
  }

  return (
    <>
      <div className="w-full overflow-hidden min-h-[100vh] h-[100vh]">
        <div className="relative w-full h-full">
          {/* Slider Container */}
          <div className="grid grid-cols-1 w-full h-full">
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                className={`col-start-1 row-start-1 transition-opacity duration-1000 ease-in-out ${
                  currentSlide === index
                    ? 'opacity-100 z-10 relative'
                    : 'opacity-0 z-0 pointer-events-none absolute inset-0'
                }`}
              >
                <div className="flex flex-col justify-start 4xl:justify-center 5xl:justify-center items-center px-4 sm:px-6 min-[769px]:px-8 lg:px-12 xl:px-16 3xl:px-20 4xl:px-28 5xl:px-36 h-full pt-[clamp(6rem,12vh,8rem)] sm:pt-[clamp(7rem,14vh,9rem)] lg:pt-[clamp(8rem,16vh,10rem)] 4xl:pt-0 pb-[clamp(3rem,6vh,5rem)] sm:pb-[clamp(4rem,8vh,6rem)] lg:pb-[clamp(5rem,10vh,8rem)] 4xl:pb-0">
                  <div className="flex flex-col items-center justify-center w-full max-w-[480px] min-[769px]:max-w-[540px] lg:max-w-[600px] 3xl:max-w-[680px] 4xl:max-w-[760px] 5xl:max-w-[840px]">
                    {/* Event Poster Image - Clickable */}
                    <button
                      onClick={() => handleEventClick(slide.id)}
                      className="relative w-full mb-6 sm:mb-8 lg:mb-10 cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/50 rounded-lg overflow-hidden"
                      aria-label={`View details for ${slide.title}`}
                    >
                      <img
                        src={slide.image}
                        alt={slide.title}
                        className="w-full h-auto max-h-[45vh] sm:max-h-[48vh] lg:max-h-[50vh] object-contain object-center"
                        width={1600}
                        height={1800}
                        loading={index === 0 ? "eager" : "lazy"}
                        decoding="async"
                      />
                      {/* Hover overlay hint */}
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                        <span className="opacity-0 hover:opacity-100 text-white font-comfortaa text-[clamp(12px,1.2vw,16px)] transition-opacity">
                          Click to view event photos
                        </span>
                      </div>
                    </button>

                    {/* Title */}
                    <h2 className="text-white mb-3 sm:mb-4 lg:mb-5 font-urbanist text-[clamp(20px,3vw,36px)] lg:text-[clamp(24px,3.5vw,40px)] font-extrabold leading-[1.2] text-center">
                      {slide.title}
                    </h2>

                    {/* Text Description */}
                    <p className="text-white/90 font-comfortaa text-[clamp(14px,1vw,18px)] font-light leading-[1.6] text-center">
                      {slide.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Event Modal Viewer */}
      <EventModalViewer
        eventId={selectedEventId}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedEventId(null)
        }}
      />
    </>
  )
}

