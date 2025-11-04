"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Calendar, Menu, X } from "lucide-react"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { AISpaceGenerator } from "@/components/AISpaceGenerator"
import { withBasePath } from "@/lib/utils"

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)

  // Header height is provided via CSS defaults in globals to avoid first-paint jumps.

  return (
    <header ref={headerRef} className="absolute top-0 left-0 right-0 z-50 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2 sm:py-3 md:py-4 lg:py-6 no-horiz-overflow">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-none mx-auto mb-0 lg:mb-0 min-w-0 relative">
        {/* Logo (hidden ≤425px) */}
        <Link href="/" aria-label="Hell University Home" className="hidden lg:flex items-center justify-center ml-1 md:ml-0">
          <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 3xl:w-24 3xl:h-24 4xl:w-28 4xl:h-28 5xl:w-32 5xl:h-32 rounded-full bg-white border-2 lg:border-4 3xl:border-[6px] 4xl:border-8 border-[var(--hell-dusty-blue)]">
            <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={62} height={62} className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-16 lg:h-16 3xl:w-[4.5rem] 3xl:h-[4.5rem] 4xl:w-[5rem] 4xl:h-[5rem] 5xl:w-[6rem] 5xl:h-[6rem]" />
          </div>
        </Link>

        {/* Title - wraps on very small screens to avoid overlap; single line from phone and up */}
                <h1 className="flex-1 text-left font-heading font-black tracking-wide whitespace-normal lg:whitespace-nowrap lg:absolute lg:left-1/2 lg:-translate-x-1/2 lg:text-center max-w-[80vw] lg:max-w-none text-xl sm:text-2xl md:text-3xl lg:text-5xl 3xl:text-6xl 4xl:text-7xl 5xl:text-8xl">
          <span className="text-[var(--hell-dusty-blue)] font-urbanist font-extrabold leading-[1.2]">Hell</span>{' '}
          <span className="text-[#2a1f1a] font-urbanist font-extrabold leading-[1.2]">University</span>
        </h1>

        {/* Global Modal Trigger (replacing Log In) */}
        <Dialog>
          <DialogTrigger className="hidden lg:flex items-center gap-3 text-white/80 hover:text-white transition-colors mr-1 sm:mr-2 md:mr-3 lg:mr-0" aria-label="Open Booking">
            <div className="flex items-center justify-center w-10 h-10 lg:w-12 lg:h-12 3xl:w-14 3xl:h-14 4xl:w-16 4xl:h-16 5xl:w-20 5xl:h-20 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <Calendar className="w-5 h-5 lg:w-6 lg:h-6 3xl:w-7 3xl:h-7 4xl:w-8 4xl:h-8 5xl:w-10 5xl:h-10 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden lg:inline font-comfortaa font-normal text-sm lg:text-base 3xl:text-lg">Booking</span>
          </DialogTrigger>

          {/* Mobile/Tablet trigger placed next to burger (≤1023px) */}
          <DialogTrigger className="lg:hidden flex items-center gap-2 text-white/80 hover:text-white transition-colors absolute right-16 sm:right-20 md:right-24 top-1/2 -translate-y-1/2" aria-label="Open Booking">
            <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <Calendar className="w-5 h-5 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden sm:inline font-comfortaa font-normal text-sm md:text-base">Booking</span>
          </DialogTrigger>

          <DialogContent className="top-0 left-0 translate-x-0 translate-y-0 w-full h-vp max-w-none sm:max-w-none rounded-none border-0 p-0 bg-transparent">
            <DialogHeader className="sr-only">
              <DialogTitle>Booking</DialogTitle>
              <DialogDescription>Menu and Booking modal</DialogDescription>
            </DialogHeader>
            <div className="relative min-h-vp">
              <div className="flex flex-col lg:flex-row min-h-vp">
                {/* Left Side - Hero-like panel */}
                <div className="w-full lg:w-1/2 bg-[#5B9AB8] flex flex-col justify-center xl:pl-32 py-12 md:py-16 lg:py-24">
                  <div className="max-w-xl px-6 md:px-8 lg:px-12">
                    <h1 className="mb-8 lg:mb-12 font-heading" style={{ fontSize: 'clamp(48px, 8vw, 96px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
                      Hell<br />University
                    </h1>
                    <h2 className="text-white mb-10 font-comfortaa" style={{ fontSize: 'clamp(28px, 4.5vw, 32px)', fontWeight: '400' }}>
                      Menu
                    </h2>
                    <nav className="grid grid-cols-2 gap-3 text-white/95">
                      <Link href="/" className="hover:text-white/80 transition-colors font-comfortaa" aria-label="Home">Home</Link>
                      <Link href="/about" className="hover:text-white/80 transition-colors font-comfortaa" aria-label="About">About</Link>
                      <Link href="/studio-gallery" className="hover:text-white/80 transition-colors font-comfortaa" aria-label="Studio & Gallery">Studio/Gallery</Link>
                      <Link href="/contact" className="hover:text-white/80 transition-colors font-comfortaa" aria-label="Contact">Contact</Link>
                    </nav>
                  </div>
                </div>

                {/* Right Side - Generator panel */}
                <div className="w-full lg:w-1/2 bg-[#f4f1ed] flex items-center justify-center px-4 sm:px-6 lg:px-12 py-8 sm:py-10 lg:py-16 overflow-y-auto no-horiz-overflow">
                  <div className="w-full max-w-2xl bg-white/90 border rounded-lg p-6 shadow-lg">
                    <div className="mb-4">
                      <h3 className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: '24px', fontWeight: '700' }}>
                        AI Space Generator
                      </h3>
                      <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: '13px', fontWeight: '300' }}>
                        Select images and describe your decoration style.
                      </p>
                    </div>
                    <AISpaceGenerator />
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden text-white p-2 sm:p-3 sm:absolute sm:right-4 sm:top-1/2 sm:-translate-y-1/2"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>


      {/* Bottom Row: Desktop Nav */}
      <nav className="hidden lg:flex items-center justify-center gap-8 lg:gap-14 xl:gap-16 max-w-none mx-auto mb-0 lg:mb-0">
        <Link href="/" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Home</Link>
        <Link href="/about" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">About</Link>
        <Link href="/studio-gallery" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-center justify-center h-full gap-8 mb-0 lg:mb-0">
            {/* Logo shown at top of menu on small screens */}
            <div className="mb-4">
              <div className="flex items-center justify-center w-[64px] h-[64px] rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
                <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={56} height={56} className="w-[56px] h-[56px]" />
              </div>
            </div>
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>About</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}