import { Facebook, Twitter, Instagram } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function AboutPage() {
  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="w-full md:w-1/2 relative min-h-[520px] phone:min-h-[600px] tablet-md:min-h-[720px] lg:min-h-screen">
        <div 
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage: 'url("/assets/artwork/artwork_about.jpg")',
            mixBlendMode: 'multiply'
          }}
        />

        <div className="absolute top-1/4 right-6 phone:right-12 w-24 phone:w-32 h-40 phone:h-48 bg-[#6B8E23]/30 blur-3xl rounded-full" />
        <div className="absolute bottom-1/3 left-6 phone:left-12 w-40 phone:w-48 h-28 phone:h-32 bg-[#8FBC8F]/20 blur-3xl rounded-full" />

        <div className="relative z-10 flex flex-col justify-between h-full px-4 xxs:px-6 phone:px-8 tablet-md:px-12 lg:px-16 py-10 xxs:py-12 phone:py-16 tablet-md:py-20 lg:py-24">
          <div>
            <h1 className="text-[#87CEEB] mb-10 phone:mb-16" style={{ fontSize: 'clamp(40px, 9vw, 64px)', fontWeight: '300', lineHeight: '1' }}>
              About
            </h1>

            <div className="bg-[#2a2520] p-5 xxs:p-6 phone:p-8 max-w-md">
              <h2 className="text-[#D4AF37] mb-4 phone:mb-6" style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: '900', letterSpacing: '0.05em' }}>
                BIOGRAPHY
              </h2>
              <p className="text-white/80 mb-4 phone:mb-6" style={{ fontSize: '13px', fontWeight: '300', lineHeight: '1.7' }}>
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

          <div className="flex gap-5 xxs:gap-6 phone:gap-8 mt-8 phone:mt-0">
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

      <div className="w-full md:w-1/2 bg-[#C4A77D] flex items-center justify-center p-5 xxs:p-6 phone:p-8 tablet-md:p-12 lg:p-16 min-h-[380px] xxs:min-h-[420px] phone:min-h-[500px] tablet-md:min-h-[640px]">
        <div className="w-full max-w-xl bg-[#E8DCC4] p-6 xxs:p-8 phone:p-10 tablet-md:p-12 shadow-2xl">
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


