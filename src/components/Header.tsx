"use client"

import Link from "next/link"
import { useState } from "react"
import { Wand2, Menu, X } from "lucide-react"
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog"
import { AISpaceGenerator } from "@/components/AISpaceGenerator"

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="absolute top-0 left-0 right-0 z-50 px-2 xxs:px-3 phone:px-4 lg:px-8 py-2 xxs:py-3 phone:py-4 lg:py-6">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-[1920px] mx-auto mb-3">
        {/* Logo */}
        <Link href="/" aria-label="Hell University Home" className="flex items-center justify-center">
          <div className="flex items-center justify-center w-[48px] h-[48px] xxs:w-[52px] xxs:h-[52px] xs:w-[56px] xs:h-[56px] phone:w-[64px] phone:h-[64px] lg:w-[83px] lg:h-[83px] rounded-full bg-white border-2 lg:border-4 border-[var(--hell-dusty-blue)]">
            <img src="/assets/icons/icon_helluniversity.svg" alt="Hell University" width={62} height={62} className="w-[40px] h-[40px] xxs:w-[44px] xxs:h-[44px] xs:w-[46px] xs:h-[46px] phone:w-[56px] phone:h-[56px] lg:w-[73px] lg:h-[73px]" />
          </div>
        </Link>

        {/* Title */}
        <h1 className="text-center hidden xxs:block font-heading" style={{ fontSize: 'clamp(26px, 6vw, 60px)', fontWeight: '900', letterSpacing: '0.05em' }}>
          <span className="text-[var(--hell-dusty-blue)]">Hell</span>{' '}
          <span className="text-[#2a1f1a]">University</span>
        </h1>

        {/* Global Modal Trigger (replacing Log In) */}
        <Dialog>
          <DialogTrigger className="hidden md:flex flex-col items-center gap-1 text-white/80 hover:text-white transition-colors" aria-label="Open AI GenSpace">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Wand2 size={16} className="text-white" />
            </div>
            <span className="hidden lg:inline font-ui" style={{ fontSize: '14px', fontWeight: '400' }}>AI GenSpace</span>
          </DialogTrigger>

          <DialogContent className="top-0 left-0 translate-x-0 translate-y-0 w-screen h-screen max-w-none sm:max-w-none rounded-none border-0 p-0 bg-transparent">
            <div className="relative min-h-screen">
              <div className="flex flex-col lg:flex-row min-h-screen">
                {/* Left Side - Hero-like panel */}
                <div className="w-full lg:w-1/2 bg-[#5B9AB8] flex flex-col justify-center hero-left-padding py-12 phone:py-16 lg:py-24">
                  <div className="max-w-xl px-6 phone:px-8 lg:px-12">
                    <h1 className="mb-8 lg:mb-12 font-heading" style={{ fontSize: 'clamp(48px, 8vw, 96px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
                      Hell<br />University
                    </h1>
                    <h2 className="text-white mb-10 font-ui" style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: '400' }}>
                      Menu
                    </h2>
                    <nav className="grid grid-cols-2 gap-3 text-white/95">
                      <Link href="/" className="hover:text-white/80 transition-colors font-ui" aria-label="Home">Home</Link>
                      <Link href="/about" className="hover:text-white/80 transition-colors font-ui" aria-label="About">About</Link>
                      <Link href="/studio-gallery" className="hover:text-white/80 transition-colors font-ui" aria-label="Studio & Gallery">Studio/Gallery</Link>
                      <Link href="/contact" className="hover:text-white/80 transition-colors font-ui" aria-label="Contact">Contact</Link>
                    </nav>
                  </div>
                </div>

                {/* Right Side - Generator panel */}
                <div className="w-full lg:w-1/2 bg-[#f4f1ed] flex items-center justify-center px-4 phone:px-6 lg:px-12 py-8 phone:py-10 lg:py-16 overflow-y-auto">
                  <div className="w-full max-w-2xl bg-white/90 border rounded-lg p-6 shadow-lg">
                    <div className="mb-4">
                      <h3 className="text-[#5a3a2a] font-heading" style={{ fontSize: '24px', fontWeight: '700' }}>
                        AI Space Generator
                      </h3>
                      <p className="text-[#5a3a2a]/70 font-ui" style={{ fontSize: '13px', fontWeight: '300' }}>
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
          className="md:hidden text-white p-2 xxs:p-3"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Bottom Row: Desktop Nav */}
      <nav className="hidden md:flex items-center justify-center gap-8 lg:gap-14 xl:gap-16 max-w-[1920px] mx-auto">
        <Link href="/" className="transition-colors text-white hover:text-white font-ui" style={{ fontSize: '16px', fontWeight: '400' }}>Home</Link>
        <Link href="/about" className="transition-colors text-white hover:text-white font-ui" style={{ fontSize: '16px', fontWeight: '400' }}>About</Link>
        <Link href="/studio-gallery" className="transition-colors text-white hover:text-white font-ui" style={{ fontSize: '16px', fontWeight: '400' }}>Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white hover:text-white font-ui" style={{ fontSize: '16px', fontWeight: '400' }}>Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-center justify-center h-full gap-8">
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-ui" style={{ fontSize: '24px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-ui" style={{ fontSize: '24px', fontWeight: '400' }}>About</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-ui" style={{ fontSize: '24px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-ui" style={{ fontSize: '24px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}