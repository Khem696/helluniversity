"use client"

import { Facebook, Twitter, Instagram } from "lucide-react"
import { ImageWithFallback } from "./figma/ImageWithFallback"

export function Hero() {
  return (
    <section className="relative min-h-screen">
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 bg-[#5B9AB8] flex flex-col justify-center hero-left-padding py-16 lg:py-24">
          <div className="max-w-xl">
            {/* Main Title */}
            <h1 className="mb-8 lg:mb-12" style={{ fontSize: 'clamp(64px, 9vw, 112px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-12 lg:mb-16" style={{ fontSize: 'clamp(40px, 6.5vw, 64px)', fontWeight: '400', lineHeight: '1.2' }}>
              Culture House
            </h2>

            {/* Studio Section */}
            <div className="mb-8 lg:mb-12">
              <h3 className="text-white mb-4" style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: '400' }}>
                Studio
              </h3>
              <p className="text-white/90" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hongsee Culture House is a creative hub<br />
                for cultural events and the artistic community.
              </p>
              </div>

            {/* Gallery Section */}
            <div>
              <h3 className="text-white mb-4" style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: '400' }}>
                Gallery
              </h3>
              <p className="text-white/90" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hell University, an archive and gallery<br />
                dedicated to research and education.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - Textured Red/Brown with Image */}
        <div className="w-full lg:w-1/2 relative bg-gradient-to-br from-[#8B4B3B] via-[#A0563F] to-[#6B3B2F] overflow-hidden min-h-[500px] lg:min-h-screen">
          {/* Texture Overlay */}
          <div 
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.3"/%3E%3C/svg%3E")',
              mixBlendMode: 'multiply'
            }}
          />

          {/* Portrait Image */}
          <div className="absolute inset-0 flex items-center justify-start pl-0 pr-6 lg:pl-0 lg:pr-12">
            <div className="relative w-full max-w-[720px] aspect-square">
              <img
                src="/assets/portrait/portrait_kade.png"
                alt="Kade Javanalikikorn"
                className="absolute inset-0 w-full h-full object-contain object-left grayscale contrast-110"
                width={1600}
                height={1800}
              />
              
              {/* Quote Overlay */}
              <div className="absolute bottom-6 left-6 right-6">
                <p className="text-[#D4AF37] mb-6" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.8', fontStyle: 'italic' }}>
                  Some wonders seem to have no explanation<br />
                  but could only be perceived by an opening<br />
                  and extension of the mind.
                </p>
                <p className="text-white" style={{ fontSize: '16px', fontWeight: '400' }}>
                  Kade Javanalikikorn
                </p>
        </div>
      </div>
      </div>

          {/* Social Icons */}
          <div className="absolute bottom-12 right-12 flex flex-col gap-6">
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Facebook size={20} />
            </button>
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Twitter size={20} />
            </button>
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Instagram size={20} />
            </button>
          </div>

          {/* Paint Drip Effects */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#D4AF37]/20 to-transparent" />
        </div>
      </div>
    </section>
  )
}