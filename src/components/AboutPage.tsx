import { Facebook, Twitter, Instagram } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";
import PoemBook from "./PoemBook";

export function AboutPage() {
  return (
    <div className="flex flex-col lg:flex-row min-h-vp lg:h-full overflow-visible no-horiz-overflow">
      <div className="@container/about-left w-full lg:w-1/2 relative overflow-hidden min-h-[520px] sm:min-h-[600px] min-[769px]:min-h-[720px] lg:min-h-[100dvh] lg:h-full lg:overflow-hidden">
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

        <div className="cq cq-about relative z-10 flex flex-col justify-between 4xl:justify-center h-full box-border pl-6 sm:pl-6 min-[769px]:pl-8 lg:pl-10 xl:pl-32 3xl:pl-40 4xl:pl-56 5xl:pl-72 pr-4 sm:pr-6 min-[769px]:pr-8 lg:pr-16 3xl:pr-20 4xl:pr-28 5xl:pr-36 py-10 sm:py-12 min-[769px]:py-16 lg:py-0 pt-12 sm:pt-16 min-[769px]:pt-52 lg:pt-52 lg:pb-8 2xl:pt-56 3xl:pt-52 4xl:pt-0 5xl:pt-0 4xl:pb-0 5xl:pb-0 overflow-hidden">
          <div className="w-11/12 sm:w-5/6 min-[769px]:w-4/5 lg:w-3/4 xl:w-2/3 min-[769px]:mx-auto lg:mx-0 lg:ml-auto min-[769px]:max-w-lg 3xl:max-w-[50rem] 4xl:max-w-[56rem] 5xl:max-w-[62rem]">
            <h1 className="text-[#68c9e0] mt-4 min-[769px]:mt-6 lg:mt-0 mb-8 sm:mb-10 lg:mb-8 font-comfortaa leading-tight break-words max-w-[24ch] text-[clamp(22px,5.5vw,40px)]">
              Why Hell University?
            </h1>

            <div className="px-5 pt-0 pb-5 sm:px-6 sm:pt-0 sm:pb-6 max-w-prose">
              {/* <h2 className="text-[#D4AF37] mb-4 phone:mb-6" style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: '900', letterSpacing: '0.05em' }}>
                BIOGRAPHY
              </h2> */}
              {/* <p className="text-white/80 mb-1 phone:mb-6 font-comfortaa" style={{ fontSize: '14px', fontWeight: '400', lineHeight: '1.2' }}>
                Some wonders seem to have no explanation<br />
                but could only be perceived by an opening<br />
                and extension of the mind.
              </p> */}
              <div className="about-body space-y-3">
                <p className="text-white font-comfortaa text-[14px] leading-relaxed">
                "Hell University" is the name of one of Kade's collections of work, which originated in 2002. At the same time, Kade also built a residence, along with developing the area in the same vicinity in Mae Taeng District, to continuously create artworks.
                </p>
                <p className="text-white font-comfortaa text-[14px] leading-relaxed">
                Later, Hell University became the identity and inspiration for Kade to create art activities in this area for students and those interested in art, until it seemed as if this place had become a classroom surrounded by simple life and nature.
                </p>
                <p className="text-white font-comfortaa text-[14px] leading-relaxed">
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

      <div className="@container/about-right w-full lg:w-1/2 relative overflow-visible lg:overflow-visible min-h-[420px] sm:min-h-[460px] min-[769px]:min-h-[520px] lg:min-h-[100dvh] lg:h-full">
        {/* Match hero right side background tone */}
        <div 
          className="absolute inset-0 opacity-100 bg-[#C4A77D]"
        />

        {/* Book positioned similar to hero portrait container */}
        <div className="flex items-start 4xl:items-center justify-center min-[769px]:justify-center lg:justify-start px-4 sm:px-6 min-[769px]:px-8 lg:pl-0 lg:pr-12 3xl:pr-20 4xl:pr-28 5xl:pr-36 pt-10 min-[769px]:pt-12 lg:pt-52 3xl:pt-52 4xl:pt-0 5xl:pt-0 lg:pb-24 4xl:pb-0 5xl:pb-0 lg:h-full">
          <div className="relative w-full max-w-[720px] max-[768px]:flex max-[768px]:justify-center max-[768px]:mx-auto min-[769px]:mx-auto min-[769px]:flex min-[769px]:justify-center lg:block lg:mx-0 4xl:pl-0 5xl:pl-1">
            <PoemBook />
          </div>
        </div>
      </div>
    </div>
  );
}


