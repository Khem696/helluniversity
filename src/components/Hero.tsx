"use client"
import { withBasePath } from "@/lib/utils"
import { useState, useEffect } from "react"
import { Facebook, Twitter, Instagram, ChevronDown } from "lucide-react"
import { API_PATHS } from "@/lib/api-config"

export function Hero() {
  const [hasEvents, setHasEvents] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  // Check if events exist to show the scroll indicator
  useEffect(() => {
    async function checkEvents() {
      try {
        const response = await fetch(API_PATHS.events)
        if (!response.ok) {
          setHasEvents(false)
          return
        }
        const json = await response.json()
        if (json.success) {
          const responseData = json.data || json
          const events = responseData.events || responseData.pastEvents || responseData.currentEvents || []
          setHasEvents(Array.isArray(events) && events.length > 0)
        } else {
          setHasEvents(false)
        }
      } catch (error) {
        console.error("Failed to check events:", error)
        setHasEvents(false)
      }
    }

    checkEvents()

    // Hide arrow when user scrolls down
    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset
      const heroHeight = window.innerHeight
      setIsVisible(scrollY < heroHeight * 0.5) // Hide when scrolled past half of hero
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToEvents = () => {
    // Find the event sliders section by ID
    const eventSliders = document.getElementById('event-sliders')
    if (eventSliders) {
      eventSliders.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // Fallback: find first event slider section
      const eventSections = document.querySelectorAll('section[style*="background-color"]')
      if (eventSections.length > 0) {
        eventSections[0].scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        // Final fallback: scroll to main content or next section
        const mainContent = document.getElementById('main-content')
        if (mainContent) {
          const hero = mainContent.querySelector('section')
          if (hero) {
            const heroHeight = hero.offsetHeight
            window.scrollTo({ top: heroHeight, behavior: 'smooth' })
          }
        }
      }
    }
  }

  return (
    <section className="relative min-h-vp lg:h-[100dvh] overflow-visible no-horiz-overflow">
      <div className="flex flex-col lg:flex-row lg:items-stretch h-full">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 min-w-0 bg-[#3e82bb] flex flex-col justify-start 4xl:justify-center 5xl:justify-center pl-6 sm:pl-6 min-[769px]:pl-8 lg:pl-10 xl:pl-16 2xl:pl-24 3xl:pl-32 4xl:pl-48 5xl:pl-64 pt-[calc(var(--header-h)+1rem)] lg:pt-[calc(var(--header-h)+3rem)] 4xl:pt-0 pb-[clamp(2rem,8vh,5rem)] lg:pb-[clamp(3rem,10vh,6rem)] 4xl:pb-0 relative lg:h-full overflow-x-hidden">
          <div className="pl-0 pr-3 sm:pr-4 min-[769px]:pr-6 lg:pr-8 xl:pr-4 2xl:pr-8 3xl:pr-0 w-full max-w-[44rem] 2xl:max-w-[48rem] 3xl:max-w-[52rem] 4xl:max-w-[56rem] 5xl:max-w-[62rem] lg:max-h-[min(65vh,85%)]">
            {/* Main Title */}
            <h1 className="mb-8 md:mb-10 lg:mb-12 font-acumin text-[clamp(48px,7.5vw,132px)] lg:text-[clamp(44px,5vw,96px)] font-black leading-[0.9] text-[#42210b] break-words">
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-10 sm:mb-12 lg:mb-16 font-urbanist text-[clamp(30px,5.5vw,72px)] lg:text-[clamp(28px,4vw,56px)] font-extrabold leading-[1.2] break-words">
              Culture Hub
            </h2>

            {/* Studio Section */}
            <div className="mb-8 lg:mb-12">
              <h3 className="text-white mb-4 font-comfortaa text-[clamp(28px,4.5vw,48px)] lg:text-[clamp(24px,3vw,36px)] font-normal break-words">
                Studio
              </h3>
              <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] font-light leading-[1.6] break-words">
                Hongsee Culture House is a creative hub<br />
                for cultural events and the artistic community.
              </p>
              </div>

            {/* Gallery Section */}
            <div>
              <h3 className="text-white mb-4 font-comfortaa text-[clamp(28px,4.5vw,48px)] lg:text-[clamp(24px,3vw,36px)] font-normal break-words">
                Gallery
              </h3>
              <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] font-light leading-[1.6] break-words">
                An archive and gallery<br />
                dedicated to research and education.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - Textured Red/Brown with Image */}
        <div className="w-full lg:w-1/2 min-w-0 relative overflow-visible lg:overflow-hidden lg:h-full">
          {/* Texture Overlay */}
          <div 
            className="absolute inset-0 opacity-100"
            style={{
              backgroundImage: `url('${withBasePath('/assets/artwork/artwork_home.jpg')}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              mixBlendMode: 'multiply'
            }}
          />

          {/* Portrait Image */}
          <div className="flex items-stretch 4xl:items-center 5xl:items-center justify-start px-4 sm:px-6 min-[769px]:px-8 lg:pl-0 lg:pr-12 3xl:pr-20 4xl:pr-28 5xl:pr-36 pt-[calc(var(--header-h)+1rem)] lg:pt-[calc(var(--header-h)+3rem)] 4xl:pt-0 pb-[clamp(2rem,8vh,5rem)] lg:pb-[clamp(3rem,10vh,6rem)] 4xl:pb-0 relative lg:h-full">
            <div className="relative self-start 4xl:self-center 5xl:self-center w-full lg:w-fit overflow-hidden h-auto max-w-[560px] min-[769px]:max-w-[620px] lg:max-w-[700px] 3xl:max-w-[780px] 4xl:max-w-[880px] 5xl:max-w-[980px]">
              <img
                src={withBasePath('/assets/portrait/portrait_kade.png')}
                alt="Kade Javanalikikorn"
                className="w-full h-auto lg:max-h-[65vh] object-contain object-left grayscale contrast-110"
                width={1600}
                height={1800}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
              
              {/* Quote Overlay */}
              <div className="absolute left-[clamp(0.75rem,3%,3rem)] bottom-[clamp(0.75rem,3%,2rem)] lg:bottom-6 max-w-[min(90%,48ch)]">
                <p className="text-[#D4AF37] font-comfortaa text-[clamp(12px,1.2vw,16px)] font-light leading-[1.8] mb-[clamp(0.75rem,2vw,1.5rem)]">
                  Some wonders seem to have no explanation<br />
                  but could only be perceived by an opening<br />
                  and extension of the mind.
                </p>
                <p className="text-white font-urbanist text-[clamp(12px,1vw,18px)] font-extrabold">
                  Kade Javanalikhikara
                </p>
              </div>
            </div>
          </div>

          {/* Social Icons */}
          <div className="absolute bottom-3 sm:bottom-5 min-[769px]:bottom-10 right-2 sm:right-4 min-[769px]:right-6 lg:right-12 3xl:right-16 4xl:right-24 5xl:right-32 flex flex-row min-[769px]:flex-col gap-3 sm:gap-4 min-[769px]:gap-6 z-30">
            <a 
              href="https://www.facebook.com/kadejavanalikhikara" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-white hover:text-[#D4AF37] transition-colors cursor-pointer"
            >
              <Facebook size={18} className="flex-shrink-0" />
              <span className="text-[clamp(12px,1vw,16px)]">Kade Javanalikhikara</span>
            </a>
          </div>

          {/* Paint Drip Effects */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#D4AF37]/20 to-transparent" />
        </div>
      </div>

      {/* Scroll Down Arrow Indicator - Only show if events exist */}
      {hasEvents && isVisible && (
        <button
          onClick={scrollToEvents}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 group cursor-pointer transition-opacity duration-300 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded-full"
          aria-label="Scroll to events"
        >
          <span className="text-white/80 font-comfortaa text-xs sm:text-sm font-light tracking-wider uppercase">
            Events
          </span>
          <div 
            className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full transition-all duration-300 group-hover:scale-110 group-hover:bg-white/10"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
            }}
          >
            <ChevronDown 
              className="w-6 h-6 sm:w-7 sm:h-7 text-white animate-bounce" 
              style={{
                animation: 'bounce 2s infinite',
              }}
            />
          </div>
        </button>
      )}
    </section>
  )
}