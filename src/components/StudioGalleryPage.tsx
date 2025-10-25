import { ChevronDown } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

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
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Left Side - Studio */}
      <div className="w-full md:w-1/2 relative bg-gradient-to-br from-[#6B5B4A] via-[#7A6854] to-[#5A4B3A] overflow-hidden">
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.4"/%3E%3C/svg%3E")',
            mixBlendMode: 'multiply'
          }}
        />

        <div className="relative z-10 flex flex-col h-full px-4 xxs:px-6 phone:px-8 tablet-md:px-10 lg:px-12 py-16 xxs:py-20 phone:py-24 tablet-md:py-28 lg:py-24">
          <div className="flex flex-col items-center mb-8 xxs:mb-10 phone:mb-12">
            <div className="bg-[#5B9AB8]/80 px-5 xxs:px-6 phone:px-8 py-2 phone:py-3 rounded-full mb-3 xxs:mb-4 phone:mb-6">
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

            <div className="mt-6">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-2 phone-lg:grid-cols-3 gap-2 xxs:gap-3 phone:gap-4 tablet-md:gap-5 mt-auto">
            <div className="aspect-square bg-[#E85D9C]/90 overflow-hidden border-4 border-white/20">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 1</span>
              </div>
            </div>
            <div className="aspect-square bg-white/90 overflow-hidden border-4 border-white/20">
              <ImageWithFallback
                src={studioImages[0]}
                alt="Studio space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
              />
            </div>
            <div className="aspect-square bg-[#87CEEB]/90 overflow-hidden border-4 border-white/20">
              <ImageWithFallback
                src={studioImages[1]}
                alt="Studio space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
              />
            </div>
            <div className="aspect-square bg-[#7BC74D]/90 overflow-hidden border-4 border-white/20">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 2</span>
              </div>
            </div>
            <div className="aspect-square bg-white/80 overflow-hidden border-4 border-white/20">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#5a3a2a' }}>Gallery 3</span>
              </div>
            </div>
            <div className="aspect-square bg-[#D4AF37]/90 overflow-hidden border-4 border-white/20">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Gallery 4</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Gallery */}
      <div className="w-full md:w-1/2 relative bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#0a0a0a] overflow-hidden">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\"100\" height=\"100\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cfilter id=\"noise\"%3E%3CfeTurbulence type=\"fractalNoise\" baseFrequency=\"0.8\" numOctaves=\"4\" /%3E%3C/filter%3E%3Crect width=\"100\" height=\"100\" filter=\"url(%23noise)\" opacity=\"0.5\"/%3E%3C/svg%3E")',
            mixBlendMode: 'overlay'
          }}
        />

        <div className="relative z-10 flex flex-col h-full px-4 xxs:px-6 phone:px-8 tablet-md:px-10 lg:px-12 py-16 xxs:py-20 phone:py-24 tablet-md:py-28 lg:py-24">
          <div className="flex flex-col items-center mb-8 xxs:mb-10 phone:mb-12">
            <div className="bg-[#5B9AB8]/80 px-5 xxs:px-6 phone:px-8 py-2 phone:py-3 rounded-full mb-3 xxs:mb-4 phone:mb-6">
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

            <div className="mt-6">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-2 phone-lg:grid-cols-3 gap-2 xxs:gap-3 phone:gap-4 tablet-md:gap-5 mt-auto">
            <div className="aspect-square bg-[#2C5F6F]/90 overflow-hidden border-4 border-white/10">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 1</span>
              </div>
            </div>
            <div className="aspect-square bg:white/90 overflow-hidden border-4 border-white/10">
              <ImageWithFallback
                src={galleryImages[0]}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
              />
            </div>
            <div className="aspect-square bg-[#8B4B3B]/90 overflow-hidden border-4 border-white/10">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 2</span>
              </div>
            </div>
            <div className="aspect-square bg-[#7BC74D]/90 overflow-hidden border-4 border-white/10">
              <ImageWithFallback
                src={galleryImages[1]}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
              />
            </div>
            <div className="aspect-square bg-white/80 overflow-hidden border-4 border-white/10">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#5a3a2a' }}>Archive 3</span>
              </div>
            </div>
            <div className="aspect-square bg-[#D4AF37]/90 overflow-hidden border-4 border-white/10">
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: '12px', fontWeight: '500', color: 'white' }}>Archive 4</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


