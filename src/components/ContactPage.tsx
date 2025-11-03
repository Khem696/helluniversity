import { Facebook, Twitter, Instagram, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";

export function ContactPage() {
  return (
    <div className="@container/contact flex flex-col md:flex-row min-h-vp overflow-hidden bg-[#3a3a3e] no-horiz-overflow pt-[clamp(5rem,8vw,7rem)] md:pt-0">
      {/* Left: artwork as full background (half width) */}
      <div className="w-full md:w-1/2 relative overflow-hidden flex items-center justify-center md:min-h-screen">
        <div className="w-11/12 max-w-3xl xl:max-w-none aspect-[16/9]">
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
        <div className="hidden md:block md:absolute md:inset-x-0 md:bottom-0 md:top-28 lg:top-36 xl:top-40 3xl:top-44 4xl:top-48 5xl:top-52" style={{ backgroundColor: '#3a3a3e' }} />

          <div className="relative md:absolute md:inset-x-0 md:bottom-0 md:top-28 lg:top-36 xl:top-40 3xl:top-44 4xl:top-48 5xl:top-52 flex flex-col justify-center px-[clamp(1rem,3vw,4rem)] py-[clamp(2.5rem,6vw,6rem)]">
            <div className="max-w-md">
              <h1 className="text-[#87CEEB] mb-[clamp(2rem,5vw,3rem)] font-comfortaa weight-700 tracking-wider text-[clamp(2.25rem,6vw,5rem)] @min-[80rem]/contact:text-[clamp(4rem,7vw,7rem)] 3xl:tracking-[0.2em] 4xl:tracking-[0.25em] 5xl:tracking-[0.3em]">
              CONTACT
            </h1>

              <div className="space-y-4 mb-[clamp(2.5rem,5vw,4rem)]">
                {/* <p className="text-white/80 font-light text-[clamp(1rem,1.1vw,1.125rem)]">
                Text.
              </p>
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="border-b border-dotted border-white/30 py-2" />
              <div className="flex items-center border-b border-dotted border-white/30 py-2">
                <Search size={16} className="text-white/30" />
              </div> */}
            </div>

            <div className="flex gap-[clamp(1rem,2vw,2rem)] mb-[clamp(2rem,4vw,3rem)]">
              <button className="text-white hover:text-[#87CEEB] transition-colors">
                <Facebook size={20} />
              </button>
            </div>

              <div className="space-y-3">
                <p className="text-white/70 font-light text-[clamp(0.95rem,1vw,1.125rem)]">
                info@mysite.com
              </p>
                <p className="text-white/70 font-light text-[clamp(0.95rem,1vw,1.125rem)]">
                123-456-7890
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


