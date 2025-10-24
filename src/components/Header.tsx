"use client"

import Link from "next/link"
import { useState } from "react"
import { User, Menu, X } from "lucide-react"

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="absolute top-0 left-0 right-0 z-50 px-4 lg:px-8 py-4 lg:py-6">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-[1920px] mx-auto mb-3">
        {/* Logo */}
        <Link 
          href="/"
          className="flex items-center justify-center w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-white border-2 lg:border-4 border-[var(--hell-dusty-blue)]"
          aria-label="Hell University Home"
        >
          <span className="text-[var(--hell-dusty-blue)] font-black text-lg lg:text-xl">H</span>
        </Link>

        {/* Title */}
        <h1 className="text-center" style={{ fontSize: 'clamp(18px, 4vw, 28px)', fontWeight: '900', letterSpacing: '0.05em' }}>
          <span className="text-[var(--hell-dusty-blue)]">Hell</span>{' '}
          <span className="text-[#2a1f1a]">University</span>
        </h1>

        {/* Log In placeholder */}
        <button className="hidden md:flex items-center gap-2 text-white/80 hover:text-white transition-colors">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <User size={16} className="text-white" />
          </div>
          <span className="hidden lg:inline" style={{ fontSize: '14px', fontWeight: '400' }}>Log In</span>
        </button>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden text-white p-2"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Bottom Row: Desktop Nav */}
      <nav className="hidden md:flex items-center justify-center gap-6 lg:gap-12 max-w-[1920px] mx-auto">
        <Link href="/" className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '14px', fontWeight: '400' }}>Home</Link>
        <Link href="/about" className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '14px', fontWeight: '400' }}>About</Link>
        <Link href="/studio-gallery" className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '14px', fontWeight: '400' }}>Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '14px', fontWeight: '400' }}>Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-center justify-center h-full gap-8">
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '24px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '24px', fontWeight: '400' }}>About</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '24px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white" style={{ fontSize: '24px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}