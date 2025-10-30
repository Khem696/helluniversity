import { Facebook, Twitter, Instagram, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";

export function ContactPage() {
  return (
    <div className="flex flex-col md:flex-row min-h-vp overflow-hidden bg-[#3a3a3e] no-horiz-overflow pt-24 sm:pt-28 md:pt-0 lg:pt-0">
      {/* Left: artwork as full background (half width) */}
      <div className="w-full md:w-1/2 relative overflow-hidden flex items-center justify-center md:min-h-screen">
        <div className="w-11/12 max-w-3xl aspect-[16/9]">
          <ImageWithFallback
            src={withBasePath('/assets/artwork/artwork_contact.png')}
            alt="Contact artwork"
            className="w-full h-full object-cover"
            width={1600}
            height={900}
            priority
            sizes="(max-width: 768px) 90vw, 50vw"
          />
        </div>
      </div>

      {/* Right: contact content segment (half width) */}
      <div className="w-full md:w-1/2 relative md:min-h-screen">
        {/* On mobile, let content flow normally to avoid overlap; use absolute overlay only on md+ */}
        <div className="hidden md:block md:absolute md:inset-x-0 md:bottom-0 md:top-28 lg:top-36 xl:top-40" style={{ backgroundColor: '#3a3a3e' }} />

        <div className="relative md:absolute md:inset-x-0 md:bottom-0 md:top-28 lg:top-36 xl:top-40 flex flex-col justify-center px-4 sm:px-6 md:px-8 lg:px-16 py-10 md:py-16 lg:py-24">
          <div className="max-w-md">
            <h1 className="text-[#87CEEB] mb-8 sm:mb-12" style={{ fontSize: 'clamp(42px, 9vw, 72px)', fontWeight: '700', letterSpacing: '0.05em' }}>
              CONTACT
            </h1>

            <div className="space-y-4 mb-12 sm:mb-16">
              <p className="text-white/80 text-base font-light">
                Text.
              </p>
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="flex items-center border-b border-dotted border-white/30 py-2">
                <Search size={16} className="text-white/30" />
              </div>
            </div>

            <div className="flex gap-5 sm:gap-6 md:gap-8 mb-8 sm:mb-12">
              <button className="text-white hover:text-[#87CEEB] transition-colors">
                <Facebook size={20} />
              </button>
              <button className="text-white hover:text-[#87CEEB] transition-colors">
                <Twitter size={20} />
              </button>
              <button className="text-white hover:text-[#87CEEB] transition-colors">
                <Instagram size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-white/70 text-sm font-light">
                info@mysite.com
              </p>
              <p className="text-white/70 text-sm font-light">
                123-456-7890
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


