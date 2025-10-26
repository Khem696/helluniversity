import { Facebook, Twitter, Instagram } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import PoemBook from "./PoemBook";

export function AboutPage() {
  return (
    <div className="flex flex-col md:flex-row min-h-screen overflow-hidden">
      <div className="w-full md:w-1/2 relative overflow-hidden min-h-[520px] phone:min-h-[600px] tablet-md:min-h-[720px] lg:min-h-screen">
        <div 
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage: 'url("/assets/artwork/artwork_about.jpg")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />
        <div className="absolute inset-0 bg-black/40" />

        {/* Removed colored blur overlays to preserve original artwork tones */}

        <div className="relative z-10 flex flex-col justify-between h-full box-border hero-left-padding pr-4 xxs:pr-6 phone:pr-8 tablet-md:pr-12 lg:pr-16 py-10 xxs:py-12 phone:py-16 tablet-md:py-20 lg:py-24 pt-52 md:pt-56 lg:pt-60">
          <div className="md:ml-auto md:max-w-lg">
            <h1 className="text-[#68c9e0] mb-10 phone:mb-16 font-comfortaa" style={{ fontSize: 'clamp(40px, 9vw, 64px)', fontWeight: '300', lineHeight: '1' }}>
              About
            </h1>

            <div className="bg-[#2a2520] p-5 xxs:p-6 phone:p-8 max-w-md">
              <h2 className="text-[#D4AF37] mb-4 phone:mb-6" style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: '900', letterSpacing: '0.05em' }}>
                BIOGRAPHY
              </h2>
              <p className="text-white/80 mb-1 phone:mb-6 font-comfortaa" style={{ fontSize: '14px', fontWeight: '400', lineHeight: '1.2' }}>
                Some wonders seem to have no explanation<br />
                but could only be perceived by an opening<br />
                and extension of the mind.
              </p>
              <div className="space-y-3">
                <p className="text-[#D4AF37] font-comfortaa" style={{ fontSize: '16px', fontWeight: '400'}}>
                "Hell University" เป็นชื่อชุดผลงานหนึ่งของ เกศ ซึ่งเกิดขึ้นเมื่อปี 2545 และในขณะเดียวกันนั้น เกศ ก็ได้สร้างที่พำนัก พร้อมกับพัฒนาพื้นที่ในบริเวณเดียวกันที่ อำเภอแม่แตง เพื่อสร้างสรรค์ผลงานศิลปะอย่างต่อเนื่อง 
                </p>
                <p className="text-[#D4AF37] font-comfortaa" style={{ fontSize: '16px', fontWeight: '400'}}>
                ต่อมา Hell University ได้กลายเป็นอัตลักษณ์ และแรงบันดาลใจ ของ เกศ ในการที่จะสร้างกิจกรรมทางศิลปะในพื้นที่นี้ แก่เหล่าลูกศิษย์ และผู้สนใจงานด้านศิลปะ จนดูคล้ายกับว่า สถานที่นี้ได้กลายเป็นเสมือนห้องเรียนที่ห้อมล้อมไปด้วยชีวิตและธรรมชาติที่มีความเรียบง่าย
                </p>
                <p className="text-[#D4AF37] font-comfortaa" style={{ fontSize: '16px', fontWeight: '400'}}>
                หลังจากที่ เกศ ได้จากไปเมื่อเดือน พฤศจิกายน 2567 ทางครอบครัวและผู้ที่รัก เกศ ได้เห็นคุณค่าของผลงานและสถานที่นี้  และต้องการรักษาไว้ เพื่อส่งต่อคุณค่า ความเป็นธรรมชาติของคนจากมุมมองของ เกศ ต่อไป
                </p>
                {/* <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" />
                <div className="border-b border-dotted border-white/30 py-2" /> */}
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

      <div className="w-full md:w-1/2 relative min-h-[420px] xxs:min-h-[460px] phone:min-h-[520px] tablet-md:min-h-[640px] lg:min-h-screen">
        {/* Match hero right side background tone */}
        <div 
          className="absolute inset-0 opacity-100"
          style={{ backgroundColor: '#C4A77D' }}
        />

        {/* Book positioned similar to hero portrait container */}
        <div className="absolute inset-0 flex items-start justify-start hero-left-padding pr-2 xxs:pr-3 phone:pr-6 md:pr-6 tablet-md:pr-8 lg:pl-0 lg:pr-12 pt-48 md:pt-52 lg:pt-56">
          <div className="relative w-full max-w-[720px]">
            <PoemBook />
          </div>
        </div>
      </div>
    </div>
  );
}


