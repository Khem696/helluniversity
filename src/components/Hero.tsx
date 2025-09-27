'use client'

import { Button } from "./ui/button"
import { ImageWithFallback } from "./figma/ImageWithFallback"

export function Hero() {
  const scrollToReservation = () => {
    const element = document.getElementById('reservation');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#f4f1ed] via-[#ede8e0] to-[#e8e3db]">
      {/* Organic background elements inspired by Kade's artwork */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-[#7ba3a3]/40 blur-sm"></div>
        <div className="absolute top-40 right-20 w-24 h-24 rounded-full bg-[#8b4b6b]/35 blur-sm"></div>
        <div className="absolute bottom-40 left-1/4 w-40 h-40 rounded-full bg-[#b8d4d1]/45 blur-md"></div>
        <div className="absolute bottom-20 right-1/3 w-28 h-28 rounded-full bg-[#c4704a]/40 blur-sm"></div>
        <div className="absolute top-1/3 left-1/2 w-36 h-36 rounded-full bg-[#a8b5a5]/35 blur-md"></div>
        
        {/* Additional smaller color spots for painterly effect */}
        <div className="absolute top-60 left-1/3 w-20 h-20 rounded-full bg-[#7ba3a3]/30 blur-sm"></div>
        <div className="absolute bottom-60 right-1/4 w-16 h-16 rounded-full bg-[#8b4b6b]/25 blur-sm"></div>
        <div className="absolute top-1/4 right-10 w-18 h-18 rounded-full bg-[#c4704a]/30 blur-sm"></div>
        
        {/* Subtle texture overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-[#f4f1ed]/30 to-transparent opacity-40"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 text-center text-[#3a3530] px-6 lg:px-8 max-w-5xl mx-auto pb-32">
        <div className="space-y-12">
          <div className="space-y-8">
            <h1 className="hell-university-hero text-5xl sm:text-6xl md:text-7xl lg:text-8xl">
              HELL UNIVERSITY
            </h1>
            
            <div className="space-y-6">
              <p className="text-xl sm:text-2xl md:text-3xl text-[#6b655c] tracking-wide font-light">
                A Cultural House for Creative Expression
              </p>
              <div className="w-24 h-px bg-[#7ba3a3] mx-auto"></div>
              <p className="text-base sm:text-lg text-[#6b655c] tracking-wide font-light">
                Promoting cultural activities and community engagement through art, music, and creativity
              </p>
            </div>
          </div>

          <div className="pt-8 pb-8">
            <Button
              onClick={scrollToReservation}
              size="lg"
              className="bg-[#7ba3a3] hover:bg-[#6b8b8b] text-[#faf8f5] px-12 py-4 text-base tracking-wide rounded-full shadow-lg hover:shadow-xl transition-all duration-300 font-medium"
            >
              Explore Our Spaces
            </Button>
          </div>
        </div>
      </div>

    </section>
  );
}