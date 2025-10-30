"use client"
import { withBasePath } from "@/lib/utils"

import { Facebook, Twitter, Instagram } from "lucide-react"
import { ImageWithFallback } from "./figma/ImageWithFallback"

export function Hero() {
  return (
    <section className="relative min-h-vp overflow-visible no-horiz-overflow">
      <div className="flex flex-col lg:flex-row h-full">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 min-w-0 bg-[#3e82bb] flex flex-col justify-center lg:justify-start xl:pl-32 py-10 sm:py-12 md:py-16 lg:py-20 lg:pt-4 lg:pb-16 mobile-center">
          <div className="max-w-xl pl-6 sm:pl-0 pr-3 sm:pr-4 md:pr-6 lg:pr-8 xl:pr-0 mt-16 md:mt-32 lg:mt-48 xl:mt-48 2xl:mt-52 w-full">
            {/* Main Title */}
            <h1 className="mb-8 md:mb-10 lg:mb-12 font-acumin" style={{ fontSize: 'clamp(48px, 7.5vw, 96px)', fontWeight: '900', lineHeight: '0.9', color: '#42210b' }}>
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-10 sm:mb-12 lg:mb-16 font-urbanist" style={{ fontSize: 'clamp(30px, 5.5vw, 56px)', fontWeight: '800', lineHeight: '1.2' }}>
              Culture Hub
            </h2>

            {/* Studio Section */}
            <div className="mb-8 lg:mb-12">
              <h3 className="text-white mb-4 font-comfortaa" style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: '400' }}>
                Studio
              </h3>
              <p className="text-white/90 font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hongsee Culture House is a creative hub<br />
                for cultural events and the artistic community.
              </p>
              </div>

            {/* Gallery Section */}
            <div>
              <h3 className="text-white mb-4 font-comfortaa" style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: '400' }}>
                Gallery
              </h3>
              <p className="text-white/90 font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hell University, an archive and gallery<br />
                dedicated to research and education.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - Textured Red/Brown with Image */}
        <div className="w-full lg:w-1/2 min-w-0 relative overflow-visible lg:overflow-hidden min-h-[420px] sm:min-h-[460px] md:min-h-[520px] lg:min-h-[100dvh]">
          {/* Texture Overlay */}
          <div 
            className="absolute inset-0 opacity-100"
            // style={{
            //   backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.3"/%3E%3C/svg%3E")',
            //   mixBlendMode: 'multiply'
            // }}
            style={{
              backgroundImage: `url('${withBasePath('/assets/artwork/artwork_home.jpg')}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              mixBlendMode: 'multiply'
            }}
          />

          {/* Portrait Image */}
          <div className="flex items-center lg:items-start justify-start px-4 sm:px-6 md:px-8 lg:absolute lg:inset-0 lg:pl-0 lg:pr-12 pt-8 md:pt-10 lg:pt-52 2xl:pt-56">
            <div className="relative w-full max-w-[560px] md:max-w-[620px] lg:max-w-[660px] aspect-square">
              <img
                src={withBasePath('/assets/portrait/portrait_kade.png')}
                alt="Kade Javanalikikorn"
                className="absolute inset-0 w-full h-full object-contain object-left grayscale contrast-110"
                width={1600}
                height={1800}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
              
              {/* Quote Overlay */}
              <div className="absolute bottom-3 sm:bottom-4 md:bottom-6 left-3 sm:left-4 md:left-6 right-3 sm:right-4 md:right-6">
                <p className="text-[#D4AF37] mb-4 md:mb-6 hidden sm:block font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.8', fontStyle: 'regular' }}>
                  Some wonders seem to have no explanation<br />
                  but could only be perceived by an opening<br />
                  and extension of the mind.
                </p>
                <p className="text-white font-urbanist" style={{ fontSize: '14px', fontWeight: '800' ,fontStyle: 'ExtraBold'}}>
                  Kade Javanalikikorn
                </p>
              </div>
      </div>
      </div>

          {/* Social Icons */}
          <div className="absolute bottom-3 sm:bottom-5 md:bottom-10 right-2 sm:right-4 md:right-6 lg:right-12 flex flex-row md:flex-col gap-3 sm:gap-4 md:gap-6">
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Facebook size={18} />
            </button>
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Twitter size={18} />
            </button>
            <button className="text-white hover:text-[#D4AF37] transition-colors">
              <Instagram size={18} />
            </button>
          </div>

          {/* Paint Drip Effects */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#D4AF37]/20 to-transparent" />
        </div>
      </div>
    </section>
  )
}