import { ChevronDown } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";

export function StudioGalleryPage() {
  const studioImages = [
    "https://images.unsplash.com/photo-1759333213207-daabf2584348?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhcnQlMjBzdHVkaW8lMjB3b3Jrc3BhY2V8ZW58MXx8fHwxNzYxMzAyNTY0fDA&ixlib=rb-4.1.0&q=80&w=1080",
    "https://images.unsplash.com/photo-1669490893500-97456444f578?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHNwYWNlJTIwcGhvdG9zfGVufDF8fHx8MTc2MTMwMjU2NXww&ixlib=rb-4.1.0&q=80&w=1080",
  ];

  const galleryImages = [
    "https://images.unsplash.com/photo-1574367157590-3454fe866961?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhcnQlMjBnYWxsZXJ5JTIwaW50ZXJpb3J8ZW58MXx8fHwxNzYxMjIxMDE4fDA&ixlib=rb-4.1.0&q=80&w=1080",
    "https://images.unsplash.com/photo-1713779490284-a81ff6a8ffae?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxnYWxsZXJ5JTIwZXhoaWJpdGlvbnxlbnwxfHx8fDE3NjEzMDI1NjV8MA&ixlib=rb-4.1.0&q=80&w=1080",
  ];

  return (
    <div className="min-h-vp bg-[#7a2d28]">
      {/* Section wrapper: limits background layers to the Studio/Gallery area only */}
      <section className="relative overflow-hidden pb-0">
        {/* Darker red stripe across this section only (start below header) */}
        <div
          className="pointer-events-none absolute left-0 right-0 bg-[#42210b]"
          style={{ top: 'clamp(128px, 9vw, 168px)', height: 'calc(100% - clamp(128px, 9vw, 168px))' }}
        />

        {/* Portrait layer (right-center), blended over darker red */}
        <div
          className="pointer-events-none absolute left-0 right-0"
          style={{
            backgroundImage: `url('${withBasePath('/assets/portrait/portrait_kade_nobg.png')}')`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right center',
            backgroundSize: 'contain',
            mixBlendMode: 'multiply',
            opacity: 0.3,
            top: 'clamp(128px, 9vw, 168px)',
            height: 'calc(100% - clamp(128px, 9vw, 168px))',
          }}
        />

        {/* Keep subtle noise texture on top */}
        <div 
          className="pointer-events-none absolute left-0 right-0 opacity-25"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.4"/%3E%3C/svg%3E")',
            mixBlendMode: 'overlay',
            top: 'clamp(128px, 9vw, 168px)',
            height: 'calc(100% - clamp(128px, 9vw, 168px))',
          }}
        />

        {/* Content row */}
        <div className="relative z-10 flex flex-col md:flex-row mt-12 xxs:mt-16 phone:mt-20 tablet-md:mt-24 lg:mt-28">
      {/* Left Side - Studio */}
      <div className="w-full md:w-1/2 relative overflow-hidden">

        <div className="relative z-10 flex flex-col h-full px-4 xxs:px-6 phone:px-8 tablet-md:px-10 lg:px-12 pt-16 xxs:pt-20 phone:pt-24 tablet-md:pt-28 lg:pt-24 pb-0">
          <div className="flex flex-col items-center mb-4 xxs:mb-5 phone:mb-6 mt-6 xxs:mt-8 phone:mt-10">
            <div className="bg-[#5B9AB8]/80 px-5 xxs:px-6 phone:px-8 py-2 phone:py-3 rounded-full mb-3 xxs:mb-4 phone:mb-6">
              <h2 className="text-white font-comfortaa" style={{ fontSize: '24px', fontWeight: '400' }}>
                Studio
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-2 font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              Hongsee Culture House is a creative hub
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              for cultural events and the artistic community.
            </p>

            <div className="mt-6">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 xxs:gap-3 phone:gap-4 tablet-md:gap-5 mt-4 phone:mt-6 tablet-md:mt-6 w-11/12 mx-auto">
            <div className="aspect-[16/9] bg-[#E85D9C]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 1</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-white/90 overflow-hidden">
              <ImageWithFallback
                src={studioImages[0]}
                alt="Studio space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-[#87CEEB]/90 overflow-hidden">
              <ImageWithFallback
                src={studioImages[1]}
                alt="Studio space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-[#7BC74D]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 2</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-white/80 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#5a3a2a' }}>Gallery 3</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#D4AF37]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 4</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#8EC1A8]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 5</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#B87EBB]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 6</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#FFA07A]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 7</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Gallery */}
      <div className="w-full md:w-1/2 relative overflow-hidden">

        <div className="relative z-10 flex flex-col h-full px-4 xxs:px-6 phone:px-8 tablet-md:px-10 lg:px-12 pt-16 xxs:pt-20 phone:pt-24 tablet-md:pt-28 lg:pt-24 pb-0">
          <div className="flex flex-col items-center mb-4 xxs:mb-5 phone:mb-6 mt-6 xxs:mt-8 phone:mt-10">
            <div className="bg-[#5B9AB8]/80 px-5 xxs:px-6 phone:px-8 py-2 phone:py-3 rounded-full mb-3 xxs:mb-4 phone:mb-6">
              <h2 className="text-white font-comfortaa" style={{ fontSize: '24px', fontWeight: '400' }}>
                Gallery
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-2 font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              Hell University, an archive and gallery
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              dedicated to research and education.
            </p>

            <div className="mt-6">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 xxs:gap-3 phone:gap-4 tablet-md:gap-5 mt-4 phone:mt-6 tablet-md:mt-6 w-11/12 mx-auto">
            <div className="aspect-[16/9] bg-[#2C5F6F]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 1</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-white/90 overflow-hidden">
              <ImageWithFallback
                src={galleryImages[0]}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-[#8B4B3B]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 2</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#7BC74D]/90 overflow-hidden">
              <ImageWithFallback
                src={galleryImages[1]}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-white/80 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#5a3a2a' }}>Archive 3</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#D4AF37]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 4</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#355C7D]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 5</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#6C5B7B]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 6</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#C06C84]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 7</span>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </section>
    </div>
  );
}


