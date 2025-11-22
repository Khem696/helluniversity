"use client"
import { useState, useEffect, useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Image from "next/image"
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
  const autoRotateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-rotate only when there are 2+ slides AND modal is NOT open
  useEffect(() => {
    // Clear any existing interval
    if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current)
      autoRotateIntervalRef.current = null
    }

    // Don't auto-rotate if:
    // - Only 1 slide
    // - Modal is open
    if (slides.length <= 1 || isModalOpen) {
      return
    }

    // Start auto-rotation
    autoRotateIntervalRef.current = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length)
    }, 7000)

    return () => {
      if (autoRotateIntervalRef.current) {
        clearInterval(autoRotateIntervalRef.current)
        autoRotateIntervalRef.current = null
      }
    }
  }, [slides.length, isModalOpen])

  if (slides.length === 0) {
    return null
  }

  const handleEventClick = (eventId: string) => {
    setSelectedEventId(eventId)
    setIsModalOpen(true)
  }

  // Manual navigation functions
  const goToPrevious = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length)
    // Reset auto-rotation timer
    if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current)
    }
    if (!isModalOpen && slides.length > 1) {
      autoRotateIntervalRef.current = setInterval(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length)
      }, 7000)
    }
  }

  const goToNext = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length)
    // Reset auto-rotation timer
    if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current)
    }
    if (!isModalOpen && slides.length > 1) {
      autoRotateIntervalRef.current = setInterval(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length)
      }, 7000)
    }
  }

  return (
    <>
      <div className="w-full overflow-hidden min-h-[100vh] h-[100dvh]">
        <div className="relative w-full h-full">
          {/* Navigation Arrows - Only show when there are 2+ slides */}
          {slides.length > 1 && (
            <>
              {/* Left Arrow */}
              <button
                onClick={goToPrevious}
                className="absolute left-2 sm:left-4 md:left-6 lg:left-8 xl:left-12 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 touch-manipulation"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
                }}
                aria-label="Previous event"
              >
                <ChevronLeft 
                  className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-white" 
                  strokeWidth={2.5}
                />
              </button>

              {/* Right Arrow */}
              <button
                onClick={goToNext}
                className="absolute right-2 sm:right-4 md:right-6 lg:right-8 xl:right-12 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 touch-manipulation"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
                }}
                aria-label="Next event"
              >
                <ChevronRight 
                  className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-white" 
                  strokeWidth={2.5}
                />
              </button>
            </>
          )}

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
                <div className="flex flex-col justify-start 4xl:justify-center 5xl:justify-center items-center px-3 sm:px-4 min-[769px]:px-6 lg:px-8 xl:px-12 3xl:px-16 4xl:px-20 5xl:px-28 h-full pt-[clamp(5rem,10vh,7rem)] sm:pt-[clamp(6rem,12vh,8rem)] lg:pt-[clamp(7rem,14vh,9rem)] 4xl:pt-0 pb-[clamp(2rem,4vh,3rem)] sm:pb-[clamp(3rem,6vh,4rem)] lg:pb-[clamp(4rem,8vh,6rem)] 4xl:pb-0 overflow-y-auto">
                  <div className="flex flex-col items-center justify-center w-full max-w-[90vw] sm:max-w-[480px] min-[769px]:max-w-[540px] lg:max-w-[600px] 3xl:max-w-[680px] 4xl:max-w-[760px] 5xl:max-w-[840px]">
                    {/* Event Poster Image - Clickable */}
                    <button
                      onClick={() => handleEventClick(slide.id)}
                      className="relative w-full mb-6 sm:mb-8 lg:mb-10 cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/50 rounded-lg overflow-hidden"
                      aria-label={`View details for ${slide.title}`}
                    >
                      <div className="relative w-full h-auto max-h-[35vh] sm:max-h-[40vh] md:max-h-[45vh] lg:max-h-[48vh] xl:max-h-[50vh] flex items-center justify-center">
                        <Image
                          src={slide.image}
                          alt={`${slide.title} - Cultural event at Hell University in Mae Taeng, Chiang Mai, Thailand. Book event space and arrange activities.`}
                          width={1600}
                          height={1800}
                          className="w-full h-auto max-h-[35vh] sm:max-h-[40vh] md:max-h-[45vh] lg:max-h-[48vh] xl:max-h-[50vh] object-contain object-center"
                          style={{ maxHeight: 'inherit' }}
                          priority={index === 0}
                          loading={index === 0 ? "eager" : "lazy"}
                          quality={75}
                          sizes="(max-width: 640px) 90vw, (max-width: 768px) 85vw, (max-width: 1024px) 80vw, 70vw"
                        />
                      </div>
                      {/* Hover overlay hint */}
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                        <span className="opacity-0 hover:opacity-100 text-white font-comfortaa text-[clamp(12px,1.2vw,16px)] transition-opacity">
                          Click to view event photos
                        </span>
                      </div>
                    </button>

                    {/* Title */}
                    <h2 className="text-white mb-2 sm:mb-3 lg:mb-4 font-urbanist text-[clamp(18px,2.5vw,32px)] sm:text-[clamp(20px,3vw,36px)] lg:text-[clamp(24px,3.5vw,40px)] font-extrabold leading-[1.2] text-center px-2">
                      {slide.title}
                    </h2>

                    {/* Text Description */}
                    {slide.description && (
                      <p className="text-white/90 font-comfortaa text-[clamp(13px,1.5vw,16px)] sm:text-[clamp(14px,1.8vw,18px)] font-light leading-[1.5] sm:leading-[1.6] text-center max-w-full break-words px-2">
                        {slide.description}
                      </p>
                    )}
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

