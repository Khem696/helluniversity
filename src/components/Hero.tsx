"use client"
import { withBasePath } from "@/lib/utils"

import { Facebook, Twitter, Instagram } from "lucide-react"
import { ImageWithFallback } from "./figma/ImageWithFallback"

export function Hero() {
  return (
    <section className="relative min-h-vp overflow-hidden no-horiz-overflow">
      <div className="flex flex-col lg:flex-row h-full">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 min-w-0 bg-[#3e82bb] flex flex-col justify-center hero-left-padding py-10 xxs:py-12 phone:py-16 tablet-md:py-20 lg:py-24 mobile-center">
          <div className="max-w-xl pr-3 xxs:pr-4 phone:pr-6 md:pr-6 tablet-md:pr-8 lg:pr-0 mt-16 md:mt-20 lg:mt-24 w-full">
            {/* Main Title */}
            <h1 className="mb-8 tablet-md:mb-10 lg:mb-12 font-acumin" style={{ fontSize: 'clamp(48px, 7.5vw, 96px)', fontWeight: '900', lineHeight: '0.9', color: '#42210b' }}>
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-10 phone:mb-12 lg:mb-16 font-urbanist" style={{ fontSize: 'clamp(30px, 5.5vw, 56px)', fontWeight: '800', lineHeight: '1.2' }}>
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
        <div className="w-full lg:w-1/2 min-w-0 relative overflow-hidden min-h-[420px] xxs:min-h-[460px] phone:min-h-[520px] tablet-md:min-h-[640px] lg:min-h-[100dvh]">
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
          <div className="absolute inset-0 flex items-center justify-start pl-0 pr-2 xxs:pr-3 phone:pr-6 md:pr-6 tablet-md:pr-8 lg:pl-0 lg:pr-12 pt-8 md:pt-10 lg:pt-12">
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
              <div className="absolute bottom-3 xxs:bottom-4 phone:bottom-6 left-3 xxs:left-4 phone:left-6 right-3 xxs:right-4 phone:right-6">
                <p className="text-[#D4AF37] mb-4 phone:mb-6 xxs:block hidden font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.8', fontStyle: 'regular' }}>
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
          <div className="absolute bottom-3 xxs:bottom-5 phone:bottom-10 right-2 xxs:right-4 phone:right-6 lg:right-12 flex flex-row phone:flex-col gap-3 xxs:gap-4 phone:gap-6">
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