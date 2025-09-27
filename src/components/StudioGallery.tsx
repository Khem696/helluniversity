'use client'

import { ImageWithFallback } from "./figma/ImageWithFallback"

export function StudioGallery() {
  return (
    <section id="spaces" className="relative min-h-screen w-full overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1733471073010-231da8a85e99?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBjcmVhdGl2ZSUyMHN0dWRpbyUyMGdhbGxlcnklMjBzcGFjZXxlbnwxfHx8fDE3NTg3Nzc4ODh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Hell University Studio and Gallery Space"
          className="w-full h-full object-cover"
          width={1920}
          height={1080}
          priority={true}
        />
        {/* Overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#3a3530]/70 via-[#3a3530]/40 to-[#3a3530]/70"></div>
      </div>

      {/* Content Split */}
      <div className="relative z-10 h-screen flex">
        {/* Left Half - Studio */}
        <div className="w-1/2 flex items-center justify-center p-8 lg:p-16">
          <div className="text-center space-y-8">
            <div className="space-y-4">
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-light tracking-wide text-[#faf8f5] font-helvetica">
                STUDIO
              </h2>
              <div className="w-16 h-px bg-[#7ba3a3] mx-auto"></div>
            </div>
            
            <div className="space-y-6">
              <h3 className="text-xl sm:text-2xl md:text-3xl font-light text-[#b8d4d1] tracking-wide font-helvetica">
                Hongsee Creative Space
              </h3>
              <p className="text-base sm:text-lg text-[#faf8f5]/90 font-light leading-relaxed max-w-md mx-auto font-helvetica">
                A dynamic hub dedicated to promoting cultural events and fostering connections within the artistic community
              </p>
            </div>
          </div>
        </div>

        {/* Right Half - Gallery */}
        <div className="w-1/2 flex items-center justify-center p-8 lg:p-16">
          <div className="text-center space-y-8">
            <div className="space-y-4">
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-light tracking-wide text-[#faf8f5] font-helvetica">
                GALLERY
              </h2>
              <div className="w-16 h-px bg-[#8b4b6b] mx-auto"></div>
            </div>
            
            <div className="space-y-6">
              <h3 className="text-xl sm:text-2xl md:text-3xl font-light text-[#b8d4d1] tracking-wide font-helvetica">
                Archive and Gallery
              </h3>
              <p className="text-base sm:text-lg text-[#faf8f5]/90 font-light leading-relaxed max-w-md mx-auto font-helvetica">
                A thoughtful archive and gallery space designed for research, education, and cultural preservation
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle dividing line */}
      <div className="absolute top-1/4 bottom-1/4 left-1/2 w-px bg-gradient-to-b from-transparent via-[#faf8f5]/30 to-transparent transform -translate-x-1/2 z-20"></div>
    </section>
  );
}