import { Facebook, Twitter, Instagram } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function AboutPage() {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      <div className="w-full lg:w-1/2 relative bg-gradient-to-br from-[#2C5F6F] via-[#3A7484] to-[#1E4A57] overflow-hidden min-h-screen">
        <div 
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.4"/%3E%3C/svg%3E")',
            mixBlendMode: 'overlay'
          }}
        />

        <div className="absolute top-1/4 right-12 w-32 h-48 bg-[#6B8E23]/30 blur-3xl rounded-full" />
        <div className="absolute bottom-1/3 left-12 w-48 h-32 bg-[#8FBC8F]/20 blur-3xl rounded-full" />

        <div className="relative z-10 flex flex-col justify-between h-full px-8 lg:px-16 py-16 lg:py-24">
          <div>
            <h1 className="text-[#87CEEB] mb-16" style={{ fontSize: '64px', fontWeight: '300', lineHeight: '1' }}>
              About
            </h1>

            <div className="bg-[#2a2520] p-8 max-w-md">
              <h2 className="text-[#D4AF37] mb-6" style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '0.05em' }}>
                BIOGRAPHY
              </h2>
              <p className="text-white/80 mb-6" style={{ fontSize: '13px', fontWeight: '300', lineHeight: '1.7' }}>
                Some wonders seem to have no explanation<br />
                but could only be perceived by an opening<br />
                and extension of the mind.
              </p>
              <div className="space-y-3">
                <p className="text-[#D4AF37]" style={{ fontSize: '14px', fontWeight: '400' }}>
                  Text.
                </p>
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
              </div>
            </div>
          </div>

          <div className="flex gap-8">
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
        </div>
      </div>

      <div className="w-full lg:w-1/2 bg-[#C4A77D] flex items-center justify-center p-8 lg:p-16 min-h-[500px]">
        <div className="w-full max-w-xl bg-[#E8DCC4] p-12 shadow-2xl">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1634562876572-5abe57afcceb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxoYW5kd3JpdHRlbiUyMGxldHRlciUyMHZpbnRhZ2V8ZW58MXx8fHwxNzYxMzAxOTEwfDA&ixlib=rb-4.1.0&q=80&w=1080"
            alt="Handwritten letter"
            className="w-full h-auto opacity-80"
            width={1080}
            height={720}
          />
          <div className="mt-8 space-y-4">
            <p className="text-[#5a3a2a]" style={{ fontSize: '16px', fontWeight: '300', lineHeight: '2', fontStyle: 'italic' }}>
              ประวัติ Hell University
            </p>
            <p className="text-[#5a3a2a]/70" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '2', fontStyle: 'italic' }}>
              มูลนิธิเครือข่ายศิลปะและวัฒนธรรมเพื่อการศึกษา
            </p>
            <div className="space-y-2 mt-6">
              <p className="text-[#5a3a2a]/60" style={{ fontSize: '13px', fontWeight: '300', lineHeight: '2', fontStyle: 'italic' }}>
                ศิลปิน นักสร้างสรรค์ และชุมชน...
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


