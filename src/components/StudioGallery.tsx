'use client'

import { ImageWithFallback } from "./figma/ImageWithFallback"

export function StudioGallery() {
  return (
    <section id="spaces" className="relative min-h-screen w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Side - Studio */}
        <div className="w-full lg:w-1/2 relative bg-gradient-to-br from-[#6B5B4A] via-[#7A6854] to-[#5A4B3A] overflow-hidden">
          <div 
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.4"/%3E%3C/svg%3E")',
              mixBlendMode: 'multiply'
            }}
          />
          <div className="relative z-10 flex flex-col h-full px-8 lg:px-12 py-32 lg:py-24">
            <div className="flex flex-col items-center mb-12">
              <div className="bg-[#5B9AB8]/80 px-8 py-3 rounded-full mb-6">
                <h2 className="text-white" style={{ fontSize: '24px', fontWeight: '400' }}>
                  Studio
                </h2>
              </div>
              <p className="text-[#87CEEB] text-center max-w-md mb-2" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hongsee Culture House is a creative hub
              </p>
              <p className="text-[#87CEEB] text-center max-w-md" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                for cultural events and the artistic community.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - Gallery */}
        <div className="w-full lg:w-1/2 relative bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#0a0a0a] overflow-hidden">
          <div 
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.5"/%3E%3C/svg%3E")',
              mixBlendMode: 'overlay'
            }}
          />
          <div className="relative z-10 flex flex-col h-full px-8 lg:px-12 py-32 lg:py-24">
            <div className="flex flex-col items-center mb-12">
              <div className="bg-[#5B9AB8]/80 px-8 py-3 rounded-full mb-6">
                <h2 className="text-white" style={{ fontSize: '24px', fontWeight: '400' }}>
                  Gallery
                </h2>
              </div>
              <p className="text-[#87CEEB] text-center max-w-md mb-2" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                Hell University, an archive and gallery
              </p>
              <p className="text-[#87CEEB] text-center max-w-md" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
                dedicated to research and education.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}