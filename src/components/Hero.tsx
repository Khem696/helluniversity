'use client'

import { Button } from "./ui/button"
import { ImageWithFallback } from "./figma/ImageWithFallback"

function SealIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle cx="100" cy="100" r="92" fill="none" stroke="#7a5050" strokeWidth="8" />
      <circle cx="100" cy="100" r="76" fill="none" stroke="#7a5050" strokeWidth="4" />
      {/* Inner badge */}
      <circle cx="100" cy="100" r="58" fill="#7a5050" />
      {/* Simple leaf-like mark */}
      <g fill="#fff">
        <ellipse cx="100" cy="92" rx="10" ry="18" />
        <ellipse cx="80" cy="112" rx="10" ry="18" transform="rotate(-35 80 112)" />
        <ellipse cx="120" cy="112" rx="10" ry="18" transform="rotate(35 120 112)" />
      </g>
    </svg>
  );
}

export function Hero() {
  const scrollToReservation = () => {
    const element = document.getElementById('spaces');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#0f8ed3] via-[#19a0de] to-[#20aeea]">
      {/* Organic background elements inspired by Kade's artwork */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0" style={{ backgroundColor: "rgba(0, 120, 200, 0.25)", pointerEvents: "none" }}></div>
        {/* <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-[#7ba3a3]/40 blur-sm"></div>
        <div className="absolute top-40 right-20 w-24 h-24 rounded-full bg-[#8b4b6b]/35 blur-sm"></div>
        <div className="absolute bottom-40 left-1/4 w-40 h-40 rounded-full bg-[#b8d4d1]/45 blur-md"></div>
        <div className="absolute bottom-20 right-1/3 w-28 h-28 rounded-full bg-[#c4704a]/40 blur-sm"></div>
        <div className="absolute top-1/3 left-1/2 w-36 h-36 rounded-full bg-[#a8b5a5]/35 blur-md"></div> */}
        
        {/* Additional smaller color spots for painterly effect */}
        {/* <div className="absolute top-60 left-1/3 w-20 h-20 rounded-full bg-[#7ba3a3]/30 blur-sm"></div>
        <div className="absolute bottom-60 right-1/4 w-16 h-16 rounded-full bg-[#8b4b6b]/25 blur-sm"></div>
        <div className="absolute top-1/4 right-10 w-18 h-18 rounded-full bg-[#c4704a]/30 blur-sm"></div> */}
        
        {/* Subtle texture overlay */}
        {/* <div className="absolute inset-0 bg-gradient-to-br from-transparent via-[#f4f1ed]/30 to-transparent opacity-40"></div> */}
      </div>

      {/* Content */}
      <div className="container relative z-10 text-[#3a3530] px-6 lg:px-8 mx-auto pb-24">
        <div className="space-y-12">
          <div className="space-y-6">
            <div className="mx-auto w-fit flex flex-col items-start max-w-full">
              <p className="hell-hero-topline text-left">
                faculty of alcohol, drugs and firearms
              </p>
              <div className="mt-2 relative inline-block">
                <h1 className="hell-hero-title whitespace-normal block ml-0 sm:-ml-1 md:-ml-2">
                  Hell University
                </h1>
                {/* <SealIcon className="hidden sm:block absolute left-full ml-2 sm:ml-3 top-1/2 -translate-y-1/2 h-16 w-16 md:h-24 md:w-24 lg:h-28 lg:w-28" /> */}
              </div>
              <p className="hell-hero-caption mt-4 text-left">
                some knowledge seem to have no explanation but could only be percieved by an opening and extension of the mind.
              </p>
            <div className="pt-8 pb-8 self-start">
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
      </div>
      </div>

    </section>
  );
}