"use client"
import { withBasePath } from "@/lib/utils"

import { Facebook, Twitter, Instagram } from "lucide-react"

export function Hero() {
  return (
    <section className="relative min-h-vp lg:h-[100dvh] overflow-visible no-horiz-overflow">
      <div className="flex flex-col lg:flex-row lg:items-stretch h-full">
        {/* Left Side - Blue */}
        <div className="w-full lg:w-1/2 min-w-0 bg-[#3e82bb] flex flex-col justify-start pl-6 sm:pl-6 min-[769px]:pl-8 lg:pl-10 xl:pl-32 3xl:pl-40 4xl:pl-56 5xl:pl-72 pt-[calc(var(--header-h)+2rem)] lg:pt-[calc(var(--header-h)+3rem)] pb-[clamp(2rem,8vh,5rem)] lg:pb-[clamp(3rem,10vh,6rem)]">
          <div className="pl-0 pr-3 sm:pr-4 min-[769px]:pr-6 lg:pr-8 xl:pr-0 w-full max-w-[44rem] 3xl:max-w-[50rem] 4xl:max-w-[56rem] 5xl:max-w-[62rem]">
            {/* Main Title */}
            <h1 className="mb-8 md:mb-10 lg:mb-12 font-acumin text-[clamp(48px,7.5vw,96px)] font-black leading-[0.9] text-[#42210b]">
              Hell<br />University
            </h1>

            {/* Culture House */}
            <h2 className="text-white mb-10 sm:mb-12 lg:mb-16 font-urbanist text-[clamp(30px,5.5vw,56px)] font-extrabold leading-[1.2]">
              Culture Hub
            </h2>

            {/* Studio Section */}
            <div className="mb-8 lg:mb-12">
              <h3 className="text-white mb-4 font-comfortaa text-[clamp(28px,4.5vw,40px)] font-normal">
                Studio
              </h3>
              <p className="text-white/90 font-comfortaa text-[14px] font-light leading-[1.6]">
                Hongsee Culture House is a creative hub<br />
                for cultural events and the artistic community.
              </p>
              </div>

            {/* Gallery Section */}
            <div>
              <h3 className="text-white mb-4 font-comfortaa text-[clamp(28px,4.5vw,40px)] font-normal">
                Gallery
              </h3>
              <p className="text-white/90 font-comfortaa text-[14px] font-light leading-[1.6]">
                Hell University, an archive and gallery<br />
                dedicated to research and education.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - Textured Red/Brown with Image */}
        <div className="w-full lg:w-1/2 min-w-0 relative overflow-visible lg:overflow-hidden">
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
          <div className="flex items-stretch justify-start px-4 sm:px-6 min-[769px]:px-8 lg:pl-0 lg:pr-12 3xl:pr-20 4xl:pr-28 5xl:pr-36 pt-[calc(var(--header-h)+2rem)] lg:pt-[calc(var(--header-h)+3rem)] pb-[clamp(2rem,8vh,5rem)] lg:pb-[clamp(3rem,10vh,6rem)] relative">
            <div className="relative w-full h-full max-w-[560px] min-[769px]:max-w-[620px] lg:max-w-[700px] 3xl:max-w-[780px] 4xl:max-w-[880px] 5xl:max-w-[980px]">
              <img
                src={withBasePath('/assets/portrait/portrait_kade.png')}
                alt="Kade Javanalikikorn"
                className="h-full w-auto max-w-none object-contain object-left grayscale contrast-110"
                width={1600}
                height={1800}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
              
              {/* Quote Overlay */}
              <div className="absolute bottom-3 sm:bottom-4 min-[769px]:bottom-6 lg:bottom-0 left-3 sm:left-4 min-[769px]:left-6 right-3 sm:right-4 min-[769px]:right-6 3xl:bottom-0 4xl:bottom-0 5xl:bottom-0 3xl:left-7 4xl:left-9 5xl:left-12 3xl:right-7 4xl:right-9 5xl:right-12">
                <p className="text-[#D4AF37] mb-4 min-[769px]:mb-6 font-comfortaa text-[14px] font-light leading-[1.8]">
                  Some wonders seem to have no explanation<br />
                  but could only be perceived by an opening<br />
                  and extension of the mind.
                </p>
                <p className="text-white font-urbanist text-[14px] font-extrabold">
                  Kade Javanalikikorn
                </p>
              </div>
      </div>
      </div>

          {/* Social Icons */}
          <div className="absolute bottom-3 sm:bottom-5 min-[769px]:bottom-10 right-2 sm:right-4 min-[769px]:right-6 lg:right-12 3xl:right-16 4xl:right-24 5xl:right-32 flex flex-row min-[769px]:flex-col gap-3 sm:gap-4 min-[769px]:gap-6">
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