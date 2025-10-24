import { Facebook, Twitter, Instagram, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function ContactPage() {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-[#3a3a3e]">
      <div className="w-full lg:w-1/2 p-8 lg:p-12 flex items-center justify-center min-h-[400px]">
        <div className="grid grid-cols-3 gap-0 w-full max-w-xl aspect-square">
          <div className="bg-[#4a4a4a] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#5a5a5a] to-[#3a3a3a]" />
          </div>
          <div className="bg-[#E8E8E8] relative overflow-hidden">
            <div className="absolute inset-0 opacity-80">
              <div className="absolute top-1/4 left-1/4 w-16 h-32 bg-[#3B3B8C] rounded-full transform -rotate-45" />
            </div>
          </div>
          <div className="bg-[#D63447] relative overflow-hidden">
            <div className="absolute inset-0 opacity-60"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.9" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)"/%3E%3C/svg%3E")',
              }}
            />
          </div>
          
          <div className="bg-[#00CED1] relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 w-24 h-24 border-8 border-[#3B3B8C] rounded-full transform -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="bg-[#2C2C3E] relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-32 h-1 bg-[#3B3B8C] transform rotate-45" />
              <div className="w-32 h-1 bg-[#3B3B8C] transform -rotate-45 absolute" />
            </div>
          </div>
          <div className="bg-[#8FBC8F] relative overflow-hidden">
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-[#6B8E23] to-transparent" />
          </div>
          
          <div className="col-span-3 relative overflow-hidden">
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1717758220144-aae8c59dbd7d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMHBhaW50aW5nJTIwY29sb3JmdWx8ZW58MXx8fHwxNzYxMTk5ODkwfDA&ixlib=rb-4.1.0&q=80&w=1080"
              alt="Abstract artwork"
              className="w-full h-full object-cover opacity-70"
              width={1080}
              height={1080}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#00CED1] via-[#2C2C3E] to-[#8FBC8F] mix-blend-multiply opacity-60" />
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
              <path
                d="M 20,50 Q 40,20 60,50 T 100,50 Q 120,80 140,50 T 180,50 Q 200,20 220,50 T 260,50"
                fill="none"
                stroke="#3B3B8C"
                strokeWidth="4"
                strokeLinecap="round"
                opacity="0.8"
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 lg:px-16 py-16 lg:py-24">
        <div className="max-w-md">
          <h1 className="text-[#87CEEB] mb-12" style={{ fontSize: '72px', fontWeight: '700', letterSpacing: '0.05em' }}>
            CONTACT
          </h1>

          <div className="space-y-4 mb-16">
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

          <div className="flex gap-8 mb-12">
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Facebook size={24} />
            </button>
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Twitter size={24} />
            </button>
            <button className="text-white hover:text-[#87CEEB] transition-colors">
              <Instagram size={24} />
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
  );
}


