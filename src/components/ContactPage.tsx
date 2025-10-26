import { Facebook, Twitter, Instagram, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";

export function ContactPage() {
  return (
    <div className="flex flex-col md:flex-row min-h-screen overflow-hidden bg-[#3a3a3e]">
      {/* Left: artwork as full background (half width) */}
      <div className="w-full md:w-1/2 relative overflow-hidden flex items-center justify-center min-h-[520px] phone:min-h-[600px] tablet-md:min-h-[720px] lg:min-h-screen">
        <div className="w-11/12 max-w-3xl aspect-[16/9]">
          <ImageWithFallback
            src={withBasePath('/assets/artwork/artwork_contact.png')}
            alt="Contact artwork"
            className="w-full h-full object-cover"
            width={1600}
            height={900}
            priority
          />
        </div>
      </div>

      {/* Right: contact content segment (half width) */}
      <div className="w-full md:w-1/2 relative min-h-[520px] xxs:min-h-[600px] phone:min-h-[600px] tablet-md:min-h-[720px] lg:min-h-screen">
        <div className="absolute inset-0" style={{ backgroundColor: '#3a3a3e' }} />

        <div className="absolute inset-0 flex flex-col justify-center px-4 xxs:px-6 phone:px-8 tablet-md:px-12 lg:px-16 py-10 xxs:py-12 phone:py-16 tablet-md:py-20 lg:py-24">
          <div className="max-w-md">
            <h1 className="text-[#87CEEB] mb-8 phone:mb-12" style={{ fontSize: 'clamp(42px, 9vw, 72px)', fontWeight: '700', letterSpacing: '0.05em' }}>
              CONTACT
            </h1>

            <div className="space-y-4 mb-12 phone:mb-16">
              <p className="text-white/80" style={{ fontSize: '16px', fontWeight: '300' }}>
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

            <div className="flex gap-5 xxs:gap-6 phone:gap-8 mb-8 phone:mb-12">
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
              <p className="text-white/70" style={{ fontSize: '14px', fontWeight: '300' }}>
                info@mysite.com
              </p>
              <p className="text-white/70" style={{ fontSize: '14px', fontWeight: '300' }}>
                123-456-7890
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


