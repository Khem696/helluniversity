"use client"
import { withBasePath } from "@/lib/utils"
import { useState, useEffect } from "react"
import Image from "next/image"
import { Facebook, Twitter, Instagram, ChevronDown } from "lucide-react"
import { API_PATHS } from "@/lib/api-config"
import Link from "next/link"
import { trackInternalLinkClick } from "@/lib/analytics"

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
    <section className="relative min-h-vp lg:h-screen lg:max-h-screen lg:overflow-hidden no-horiz-overflow">
      <div className="flex flex-col lg:flex-row lg:items-stretch h-full lg:max-h-screen">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 min-w-0 bg-[#3e82bb] flex flex-col justify-start lg:justify-center pl-4 sm:pl-5 min-[769px]:pl-6 lg:pl-8 xl:pl-12 2xl:pl-16 3xl:pl-20 4xl:pl-32 5xl:pl-40 pt-[calc(var(--header-h)+0.5rem)] lg:pt-0 pb-[clamp(1.5rem,6vh,4rem)] lg:pb-0 relative lg:h-full lg:max-h-full lg:overflow-hidden overflow-x-hidden">
          <div className="pl-0 pr-2 sm:pr-3 min-[769px]:pr-4 lg:pr-6 xl:pr-4 2xl:pr-6 3xl:pr-0 w-full max-w-[44rem] 2xl:max-w-[48rem] 3xl:max-w-[52rem] 4xl:max-w-[56rem] 5xl:max-w-[62rem] lg:max-h-[min(65vh,85%)] mx-auto">
            {/* Main Title */}
            <h1 className="mb-4 md:mb-5 lg:mb-6 font-acumin text-[clamp(43px,6.7vw,119px)] lg:text-[clamp(40px,4.5vw,86px)] 2xl:text-[clamp(45px,5vw,100px)] 3xl:text-[clamp(50px,5.5vw,110px)] 4xl:text-[clamp(55px,6vw,120px)] 5xl:text-[clamp(60px,6.5vw,130px)] font-black leading-[0.9] text-[#42210b] break-words">
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-6 sm:mb-7 lg:mb-8 font-urbanist text-[clamp(27px,4.9vw,65px)] lg:text-[clamp(25px,3.6vw,50px)] 2xl:text-[clamp(28px,4vw,58px)] 3xl:text-[clamp(32px,4.5vw,65px)] 4xl:text-[clamp(36px,5vw,72px)] 5xl:text-[clamp(40px,5.5vw,80px)] font-extrabold leading-[1.2] break-words">
              Culture Hub
            </h2>

            {/* Studio Section */}
            <div className="mb-5 lg:mb-6">
              <h3 className="text-white mb-2 font-comfortaa text-[clamp(25px,4vw,43px)] lg:text-[clamp(22px,2.7vw,32px)] 2xl:text-[clamp(24px,3vw,36px)] 3xl:text-[clamp(26px,3.3vw,40px)] 4xl:text-[clamp(28px,3.6vw,44px)] 5xl:text-[clamp(30px,4vw,48px)] font-normal break-words">
                Studio
              </h3>
              <p className="text-white/90 font-comfortaa text-[clamp(13px,1.3vw,16px)] 2xl:text-[clamp(14px,1.4vw,18px)] 3xl:text-[clamp(15px,1.5vw,20px)] 4xl:text-[clamp(16px,1.6vw,22px)] 5xl:text-[clamp(17px,1.7vw,24px)] font-light leading-[1.6] break-words">
                Hongsee Culture House is a creative hub<br />
                for cultural events and the artistic community.
              </p>
              <Link 
                href="/studio-gallery" 
                className="inline-block mt-2 text-[#D4AF37] hover:text-[#F5D76E] font-comfortaa text-[clamp(12px,1.1vw,14px)] 2xl:text-[clamp(13px,1.2vw,16px)] 3xl:text-[clamp(14px,1.3vw,18px)] 4xl:text-[clamp(15px,1.4vw,20px)] 5xl:text-[clamp(16px,1.5vw,22px)] font-light underline transition-colors"
                onClick={() => trackInternalLinkClick('Explore Studio & Gallery', '/studio-gallery', 'hero')}
              >
                Explore Studio & Gallery →
              </Link>
              </div>

            {/* Gallery Section */}
            <div>
              <h3 className="text-white mb-2 font-comfortaa text-[clamp(25px,4vw,43px)] lg:text-[clamp(22px,2.7vw,32px)] 2xl:text-[clamp(24px,3vw,36px)] 3xl:text-[clamp(26px,3.3vw,40px)] 4xl:text-[clamp(28px,3.6vw,44px)] 5xl:text-[clamp(30px,4vw,48px)] font-normal break-words">
                Gallery
              </h3>
              <p className="text-white/90 font-comfortaa text-[clamp(13px,1.3vw,16px)] 2xl:text-[clamp(14px,1.4vw,18px)] 3xl:text-[clamp(15px,1.5vw,20px)] 4xl:text-[clamp(16px,1.6vw,22px)] 5xl:text-[clamp(17px,1.7vw,24px)] font-light leading-[1.6] break-words">
                An archive and gallery<br />
                dedicated to research and education.
              </p>
              <Link 
                href="/about" 
                className="inline-block mt-2 text-[#D4AF37] hover:text-[#F5D76E] font-comfortaa text-[clamp(12px,1.1vw,14px)] 2xl:text-[clamp(13px,1.2vw,16px)] 3xl:text-[clamp(14px,1.3vw,18px)] 4xl:text-[clamp(15px,1.4vw,20px)] 5xl:text-[clamp(16px,1.5vw,22px)] font-light underline transition-colors"
                onClick={() => trackInternalLinkClick('Learn Our Story', '/about', 'hero')}
              >
                Learn Our Story →
              </Link>
            </div>
          </div>
        </div>

        {/* Right Side - Textured Red/Brown with Image */}
        <div className="w-full lg:w-1/2 min-w-0 relative overflow-visible lg:overflow-hidden lg:h-full lg:max-h-full flex lg:items-center lg:justify-start">
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
          <div className="flex items-center justify-center px-4 sm:px-6 min-[769px]:px-8 lg:pl-0 lg:pr-12 3xl:pr-20 4xl:pr-28 5xl:pr-36 pt-[calc(var(--header-h)+1rem)] lg:pt-0 pb-[clamp(2rem,8vh,5rem)] lg:pb-0 relative z-10 w-full lg:w-auto">
            <div className="relative w-full lg:w-fit overflow-hidden h-auto max-w-[560px] min-[769px]:max-w-[620px] lg:max-w-[700px] 3xl:max-w-[780px] 4xl:max-w-[880px] 5xl:max-w-[980px]">
              <Image
                src={withBasePath('/assets/portrait/portrait_kade.png')}
                alt="Kade Javanalikikorn - Founder of Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand"
                width={1600}
                height={1800}
                className="w-full h-auto lg:max-h-[65vh] object-contain object-left grayscale contrast-110"
                priority
                quality={75}
                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 45vw, 40vw"
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
              href="https://www.facebook.com/profile.php?id=61584042783910" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-white hover:text-[#D4AF37] transition-colors cursor-pointer"
            >
              <Facebook size={18} className="flex-shrink-0" />
              <span className="text-[clamp(12px,1vw,16px)]">HU Culture Hub</span>
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