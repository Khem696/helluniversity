import { Facebook, Twitter, Instagram, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";

export function ContactPage() {
  return (
    <div className="@container/contact flex flex-col lg:flex-row justify-center items-center lg:justify-center min-h-screen lg:min-h-screen lg:items-center overflow-hidden bg-[#3a3a3e] no-horiz-overflow pt-[calc(var(--header-h)+1rem)] pb-[clamp(3rem,6vw,5rem)] lg:py-0">
      {/* Left: artwork as full background (half width) */}
      <div className="w-full lg:w-1/2 relative overflow-hidden lg:flex lg:items-start lg:justify-center">
          <div className="w-[clamp(18rem,90vw,44rem)] lg:w-[clamp(18rem,46vw,48rem)] mx-auto -translate-y-[clamp(0rem,2vw,1rem)] lg:translate-y-0">
            <ImageWithFallback
              src={withBasePath('/assets/artwork/artwork_contact.png')}
              alt="Contact artwork"
              className="w-full h-auto object-cover"
              width={1600}
              height={900}
              priority
              sizes="(max-width: 768px) 90vw, (max-width: 1280px) 42vw, 640px"
            />
          </div>
      </div>

      {/* Right: contact content segment (half width) */}
      <div className="w-full lg:w-1/2 relative">
          <div className="w-11/12 max-w-3xl xl:max-w-none px-[clamp(1rem,3vw,4rem)] py-[clamp(2.5rem,6vw,6rem)] mx-auto -translate-y-[clamp(0rem,2vw,1rem)] lg:translate-y-0">
            <div className="max-w-md">
              <h1 className="text-[#87CEEB] mb-[clamp(2rem,5vw,3rem)] font-comfortaa font-bold tracking-wider text-[clamp(2.25rem,6vw,5rem)] @min-[80rem]/contact:text-[clamp(4rem,7vw,7rem)] 3xl:tracking-[0.2em] 4xl:tracking-[0.25em] 5xl:tracking-[0.3em]">
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


