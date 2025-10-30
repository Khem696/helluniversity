import { Facebook, Twitter, Instagram } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";
import PoemBook from "./PoemBook";

export function AboutPage() {
  return (
    <div className="flex flex-col lg:flex-row min-h-vp lg:h-[100dvh] overflow-visible no-horiz-overflow">
      <div className="@container/about-left w-full lg:w-1/2 relative overflow-hidden min-h-[520px] sm:min-h-[600px] md:min-h-[720px] lg:h-[100dvh] lg:overflow-hidden">
        <div 
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage: `url('${withBasePath('/assets/artwork/artwork_about.jpg')}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />
        <div className="absolute inset-0 bg-black/40" />

        {/* Removed colored blur overlays to preserve original artwork tones */}

        <div className="cq cq-about relative z-10 flex flex-col justify-between h-full box-border pl-6 sm:pl-6 md:pl-8 lg:pl-10 xl:pl-32 pr-4 sm:pr-6 md:pr-8 lg:pr-16 py-10 sm:py-12 md:py-16 lg:py-0 pt-24 md:pt-48 lg:pt-56 overflow-hidden">
          <div className="w-11/12 sm:w-5/6 md:w-4/5 lg:w-3/4 xl:w-2/3 md:mx-auto lg:mx-0 lg:ml-auto md:max-w-lg">
            <h1 className="text-[#68c9e0] mt-[24px] min-[415px]:mt-0 min-[769px]:max-lg:mt-[72px] lg:mt-0 mb-8 sm:mb-12 lg:mb-6 font-comfortaa leading-[1] whitespace-normal break-words max-w-[16ch] min-[427px]:max-w-[18ch] md:max-w-none text-3xl sm:text-4xl md:text-6xl">
              Why Hell University?
            </h1>

            <div className="p-5 sm:p-6 md:p-6 lg:p-5 max-w-[22rem] min-[427px]:max-w-md">
              {/* <h2 className="text-[#D4AF37] mb-4 phone:mb-6" style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: '900', letterSpacing: '0.05em' }}>
                BIOGRAPHY
              </h2> */}
              {/* <p className="text-white/80 mb-1 phone:mb-6 font-comfortaa" style={{ fontSize: '14px', fontWeight: '400', lineHeight: '1.2' }}>
                Some wonders seem to have no explanation<br />
                but could only be perceived by an opening<br />
                and extension of the mind.
              </p> */}
              <div className="about-body space-y-3 lg:space-y-2">
                <p className="text-white font-comfortaa text-sm md:text-base xl:text-lg font-normal leading-relaxed">
                "Hell University" is the name of one of Kade's collections of work, which originated in 2002. At the same time, Kade also built a residence, along with developing the area in the same vicinity in Mae Taeng District, to continuously create artworks.
                </p>
                <p className="text-white font-comfortaa text-sm md:text-base xl:text-lg font-normal leading-relaxed">
                Later, Hell University became the identity and inspiration for Kade to create art activities in this area for students and those interested in art, until it seemed as if this place had become a classroom surrounded by simple life and nature.
                </p>
                <p className="text-white font-comfortaa text-sm md:text-base xl:text-lg font-normal leading-relaxed">
                After Kade passed away in November 2024, the family and loved ones saw the value of the works and this place and wish to preserve it, to pass on its value and the naturalness of people and surroundings from Kade's perspective.
                </p>
                {/* <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" /> */}
              </div>
            </div>
          </div>

          <div className="flex gap-5 sm:gap-6 md:gap-8 mt-8 md:mt-0">
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Facebook size={18} />
            </button>
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Twitter size={18} />
            </button>
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Instagram size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="@container/about-right w-full lg:w-1/2 relative overflow-visible lg:overflow-hidden min-h-[420px] sm:min-h-[460px] md:min-h-[520px] lg:min-h-[640px] lg:h-[100dvh]">
        {/* Match hero right side background tone */}
        <div 
          className="absolute inset-0 opacity-100"
          style={{ backgroundColor: '#C4A77D' }}
        />

        {/* Book positioned similar to hero portrait container */}
        <div className="flex items-start justify-center md:justify-center lg:justify-start px-4 sm:px-6 md:px-8 lg:absolute lg:inset-0 lg:pl-0 lg:pr-12 pt-10 md:pt-12 lg:pt-52">
          <div className="relative w-full max-w-[720px] md:mx-auto md:flex md:justify-center lg:block lg:mx-0">
            <PoemBook />
          </div>
        </div>
      </div>
    </div>
  );
}


