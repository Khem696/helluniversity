import { Facebook, Twitter, Instagram, Search, MapPin, Mail } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";
import Link from "next/link";
import { trackInternalLinkClick } from "@/lib/analytics";

export function ContactPage() {
  return (
    <div className="@container/contact flex flex-col lg:flex-row justify-center items-center lg:justify-center min-h-screen lg:h-screen lg:items-center overflow-y-auto overflow-x-hidden bg-[#3a3a3e] no-horiz-overflow pt-[calc(var(--header-h)+1rem)] pb-[clamp(3rem,6vw,5rem)] lg:py-0">
      {/* Left: artwork as full background (half width) */}
      <div className="w-full lg:w-1/2 relative overflow-hidden lg:flex lg:items-start lg:justify-center">
          <div className="w-[clamp(18rem,90vw,44rem)] lg:w-[clamp(18rem,46vw,48rem)] mx-auto -translate-y-[clamp(0rem,2vw,1rem)] lg:translate-y-0">
            <ImageWithFallback
              src={withBasePath('/assets/artwork/artwork_contact.png')}
              alt="Contact Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand - Book event spaces and arrange cultural activities"
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
          <div className="w-11/12 max-w-3xl xl:max-w-none px-[clamp(1rem,3vw,4rem)] py-[clamp(1.5rem,4vw,3rem)] mx-auto -translate-y-[clamp(0rem,2vw,1rem)] lg:translate-y-0">
            <div className="max-w-md">
              <h1 className="text-[#87CEEB] mb-[clamp(0.5rem,1.5vw,1rem)] font-comfortaa font-bold tracking-wider text-[clamp(1.5rem,4vw,3rem)] @min-[80rem]/contact:text-[clamp(2.5rem,5vw,4rem)] 3xl:tracking-[0.2em] 4xl:tracking-[0.25em] 5xl:tracking-[0.3em]">
              CONTACT
            </h1>

              {/* Location Link */}
              <div className="mb-4">
                <a 
                  href="https://maps.app.goo.gl/gnW3rP7SsAdhd2ft9?g_st=ipc" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-white/70 hover:text-[#87CEEB] transition-colors text-[clamp(0.95rem,1vw,1.125rem)]"
                >
                  <MapPin size={20} className="flex-shrink-0" />
                  <span>Location</span>
                </a>
              </div>

              {/* QR Code */}
              <div className="mb-[clamp(1.5rem,3vw,2.5rem)]">
                <ImageWithFallback
                  src={withBasePath('/assets/qrcode/location.jpg')}
                  alt="Location QR Code for Hell University cultural hub in Mae Taeng, Chiang Mai, Thailand - Scan to get directions"
                  className="w-full max-w-[150px] md:max-w-[180px] lg:max-w-[200px] h-auto object-cover rounded"
                  width={200}
                  height={200}
                  sizes="(max-width: 768px) 150px, (max-width: 1024px) 180px, 200px"
                />
              </div>

              <div className="space-y-4 mb-[clamp(1.5rem,3vw,2.5rem)]">
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

            <div className="flex gap-[clamp(1rem,2vw,2rem)] mb-[clamp(1.5rem,3vw,2.5rem)]">
              <a 
                href="https://www.facebook.com/kadejavanalikhikara" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-white hover:text-[#87CEEB] transition-colors"
              >
                <Facebook size={20} className="flex-shrink-0" />
                <span className="text-[clamp(0.95rem,1vw,1.125rem)]">Kade Javanalikhikara</span>
              </a>
            </div>

              <div className="space-y-3">
                <a 
                  href="mailto:hucultureinfo@huculturehub.com" 
                  className="inline-flex items-center gap-2 text-white/70 hover:text-[#87CEEB] transition-colors text-[clamp(0.95rem,1vw,1.125rem)] font-light"
                >
                  <Mail size={20} className="flex-shrink-0" />
                  <span>hucultureinfo@huculturehub.com</span>
                </a>
                {/* <p className="text-white/70 font-light text-[clamp(0.95rem,1vw,1.125rem)]">
                123-456-7890
              </p> */}
            </div>
            
            {/* Internal Links Section */}
            <div className="mt-8 pt-6 border-t border-white/20">
              <p className="text-white/70 font-comfortaa text-[clamp(0.875rem,0.9vw,1rem)] mb-3">
                Learn more about Hell University:
              </p>
              <nav className="flex flex-col gap-2" aria-label="Related pages">
                <Link 
                  href="/about" 
                  className="text-white/70 hover:text-[#87CEEB] transition-colors text-[clamp(0.875rem,0.9vw,1rem)] font-light underline"
                  onClick={() => trackInternalLinkClick('About Hell University', '/about', 'contact')}
                >
                  About Hell University
                </Link>
                <Link 
                  href="/studio-gallery" 
                  className="text-white/70 hover:text-[#87CEEB] transition-colors text-[clamp(0.875rem,0.9vw,1rem)] font-light underline"
                  onClick={() => trackInternalLinkClick('Studio & Gallery', '/studio-gallery', 'contact')}
                >
                  Studio & Gallery
                </Link>
                <Link 
                  href="/" 
                  className="text-white/70 hover:text-[#87CEEB] transition-colors text-[clamp(0.875rem,0.9vw,1rem)] font-light underline"
                  onClick={() => trackInternalLinkClick('View Events', '/', 'contact')}
                >
                  View Events
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


