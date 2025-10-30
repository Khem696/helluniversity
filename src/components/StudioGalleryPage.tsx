"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "./ui/carousel";

type Indices = { a: number; b: number; c: number };

export function StudioGalleryPage() {
  const artworkImages = useMemo(
    () => [
      withBasePath("/assets/artwork_studio/artwork_studio_1.jpg"),
      withBasePath("/assets/artwork_studio/artwork_studio_2.jpg"),
      withBasePath("/assets/artwork_studio/artwork_studio_3.jpg"),
      withBasePath("/assets/artwork_studio/artwork_studio_4.jpg"),
    ],
    [],
  );

  const buildingImages = useMemo(
    () => [
      withBasePath("/assets/building_studio/building_studio_1.jpg"),
      withBasePath("/assets/building_studio/building_studio_2.jpg"),
      withBasePath("/assets/building_studio/building_studio_3.jpg"),
    ],
    [],
  );

  const allImages = useMemo(
    () => [...artworkImages, ...buildingImages],
    [artworkImages, buildingImages],
  );

  const [current, setCurrent] = useState<Indices>({ a: 0, b: 1, c: 0 });
  const [nextSet, setNextSet] = useState<Indices | null>(null);
  const [showNext, setShowNext] = useState(false);
  const fadeMs = 700;
  const rotateMs = 10000;
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pickNext = (): Indices => {
      const pick = (len: number, except?: number) => {
        if (len <= 1) return 0;
        let r = Math.floor(Math.random() * len);
        if (except !== undefined && len > 1) {
          while (r === except) r = Math.floor(Math.random() * len);
        }
        return r;
      };
      const a = pick(artworkImages.length, current.a);
      let b = pick(artworkImages.length, a);
      // Ensure B is different from A and try to avoid repeating current.b
      if (artworkImages.length > 2 && b === current.b) {
        b = pick(artworkImages.length, a);
      }
      const c = pick(buildingImages.length, current.c);
      return { a, b, c };
    };

    const startRotate = () => {
      rotateTimerRef.current = setInterval(() => {
        const next = pickNext();
        setNextSet(next);
        setShowNext(true);
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          setCurrent(next);
          setShowNext(false);
          setNextSet(null);
        }, fadeMs);
      }, rotateMs);
    };

    startRotate();
    return () => {
      if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [artworkImages.length, buildingImages.length, current.a, current.b, current.c]);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);

  const openViewerForImage = (src: string) => {
    const idx = allImages.indexOf(src);
    setViewerIndex(idx >= 0 ? idx : 0);
    setViewerOpen(true);
  };

  useEffect(() => {
    if (viewerOpen && carouselApi) {
      carouselApi.scrollTo(viewerIndex, true);
    }
  }, [viewerOpen, viewerIndex, carouselApi]);

  const tileLayer = (
    key: string,
    which: "current" | "next",
    classes: string,
    style: CSSProperties,
  ) => (
    <div
      key={`${key}-${which}`}
      className={`absolute inset-0 transition-opacity ${classes}`}
      style={{ ...style, transition: `opacity ${fadeMs}ms ease` }}
    />
  );

  const makeBgStyle = (src: string, size: string, position: string) => ({
    backgroundImage: `url('${src}')`,
    backgroundSize: size,
    backgroundPosition: position,
    backgroundRepeat: "no-repeat",
  } as CSSProperties);

  const renderTile = (
    key: string,
    getSlice: (indices: Indices) => { src: string; size: string; pos: string },
    onClickSrc: (indices: Indices) => string,
  ) => {
    const cur = getSlice(current);
    const nxt = nextSet ? getSlice(nextSet) : cur;
    return (
      <button
        key={key}
        type="button"
        onClick={() => openViewerForImage(onClickSrc(current))}
        className="relative aspect-[16/9] overflow-hidden focus:outline-hidden"
        aria-label="Open image viewer"
      >
        {tileLayer(key, "current", showNext ? "opacity-0" : "opacity-100", makeBgStyle(cur.src, cur.size, cur.pos))}
        {tileLayer(key, "next", showNext ? "opacity-100" : "opacity-0", makeBgStyle(nxt.src, nxt.size, nxt.pos))}
      </button>
    );
  };

  // Shared layout constants to keep stripe, portrait, and content vertically aligned
  const headerHeightClamp = 'clamp(128px, 9vw, 168px)';
  const stripeExtraOffset = 0; // revert baseline
  const stripeBottomReveal = 0;
  const stripeTop = `calc(${headerHeightClamp} + ${stripeExtraOffset}px)`;
  const stripeHeight = `calc(100% - ${headerHeightClamp} - ${stripeExtraOffset}px - ${stripeBottomReveal}px)`;
  const sectionHeight = `calc(100dvh - ${headerHeightClamp})`;

  return (
    <div className="min-h-vp bg-[#7a2d28]">
      {/* Section wrapper: limits background layers to the Studio/Gallery area only */}
      <section className="relative overflow-hidden pb-0 md:min-h-screen" style={{ minHeight: 'calc(100dvh - clamp(128px, 9vw, 168px))' }}>
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
        {/* <div 
          className="pointer-events-none absolute left-0 right-0 opacity-25"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.4"/%3E%3C/svg%3E")',
            mixBlendMode: 'overlay',
            top: 'clamp(128px, 9vw, 168px)',
            height: 'calc(100% - clamp(128px, 9vw, 168px))',
          }}
        /> */}

        {/* Content row */}
        <div className="relative z-10 flex flex-col md:flex-row mt-[clamp(128px,9vw,168px)] lg:mt-0">
      {/* Left Side - Studio */}
      <div className="@container/studio-left w-full md:w-1/2 relative overflow-hidden">

        <div className="relative z-10 flex flex-col h-full px-4 sm:px-6 md:px-8 lg:px-12 pt-10 sm:pt-12 md:pt-16 lg:pt-52 pb-12 md:pb-16">
          <div className="flex flex-col items-center mb-4 sm:mb-4 md:mb-5 mt-4 sm:mt-4 md:mt-5">
            <div className="bg-[#5B9AB8]/80 px-5 sm:px-6 md:px-8 py-2 md:py-3 rounded-full mb-3 sm:mb-4 md:mb-6">
              <h2 className="text-white font-comfortaa text-2xl font-normal">
                Studio
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-1 font-comfortaa text-sm font-light leading-relaxed">
              Hongsee Culture House is a creative hub
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa text-sm font-light leading-relaxed">
              for cultural events and the artistic community.
            </p>

            <div className="mt-4">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4 lg:gap-5 mt-4 sm:mt-5 w-full">
            {/** Row 1: [1]=artwork A top, [2-3]=building top row */}
            {renderTile(
              "studio-1",
              (idx) => ({
                src: artworkImages[idx.a],
                size: "100% 250%",
                pos: "50% 0%",
              }),
              (idx) => artworkImages[idx.a],
            )}
            {renderTile(
              "studio-2",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "0% 0%",
              }),
              (idx) => buildingImages[idx.c],
            )}
            {renderTile(
              "studio-3",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "100% 0%",
              }),
              (idx) => buildingImages[idx.c],
            )}

            {/** Row 2: [4]=artwork B top, [5-6]=building middle row */}
            {renderTile(
              "studio-4",
              (idx) => ({
                src: artworkImages[idx.b],
                size: "100% 250%",
                pos: "50% 0%",
              }),
              (idx) => artworkImages[idx.b],
            )}
            {renderTile(
              "studio-5",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "0% 50%",
              }),
              (idx) => buildingImages[idx.c],
            )}
            {renderTile(
              "studio-6",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "100% 50%",
              }),
              (idx) => buildingImages[idx.c],
            )}

            {/** Row 3: [7]=artwork B bottom, [8-9]=building bottom row */}
            {renderTile(
              "studio-7",
              (idx) => ({
                src: artworkImages[idx.b],
                size: "100% 166.6667%",
                pos: "50% 100%",
              }),
              (idx) => artworkImages[idx.b],
            )}
            {renderTile(
              "studio-8",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "0% 100%",
              }),
              (idx) => buildingImages[idx.c],
            )}
            {renderTile(
              "studio-9",
              (idx) => ({
                src: buildingImages[idx.c],
                size: "200% 300%",
                pos: "100% 100%",
              }),
              (idx) => buildingImages[idx.c],
            )}
          </div>
        </div>
      </div>

      {/* Right Side - Gallery */}
      <div className="@container/studio-right w-full md:w-1/2 relative overflow-hidden">

        <div className="relative z-10 flex flex-col h-full px-4 sm:px-6 md:px-8 lg:px-12 pt-10 sm:pt-12 md:pt-16 lg:pt-52 pb-12 md:pb-16">
          <div className="flex flex-col items-center mb-4 sm:mb-4 md:mb-5 mt-4 sm:mt-4 md:mt-5">
            <div className="bg-[#5B9AB8]/80 px-5 sm:px-6 md:px-8 py-2 md:py-3 rounded-full mb-3 sm:mb-4 md:mb-6">
              <h2 className="text-white font-comfortaa text-2xl font-normal">
                Gallery
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-1 font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              Hell University, an archive and gallery
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa" style={{ fontSize: '14px', fontWeight: '300', lineHeight: '1.6' }}>
              dedicated to research and education.
            </p>

            <div className="mt-4">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4 lg:gap-5 mt-4 sm:mt-5 w-full">
            <div className="aspect-[16/9] bg-[#2C5F6F]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 1</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-white/90 overflow-hidden">
              <ImageWithFallback
                src={"https://images.unsplash.com/photo-1574367157590-3454fe866961?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhcnQlMjBnYWxsZXJ5JTIwaW50ZXJpb3J8ZW58MXx8fHwxNzYxMjIxMDE4fDA&ixlib=rb-4.1.0&q=80&w=1080"}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-[#8B4B3B]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 2</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#7BC74D]/90 overflow-hidden">
              <ImageWithFallback
                src={"https://images.unsplash.com/photo-1713779490284-a81ff6a8ffae?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxnYWxsZXJ5JTIwZXhoaWJpdGlvbnxlbnwxfHx8fDE3NjEzMDI1NjV8MA&ixlib=rb-4.1.0&q=80&w=1080"}
                alt="Gallery space"
                className="w-full h-full object-cover"
                width={800}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
            <div className="aspect-[16/9] bg-white/80 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium" style={{ color: '#5a3a2a' }}>Archive 3</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#D4AF37]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 4</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#355C7D]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 5</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#6C5B7B]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 6</span>
              </div>
            </div>
            <div className="aspect-[16/9] bg-[#C06C84]/90 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">Archive 7</span>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </section>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="p-0 border-0 max-w-none sm:max-w-none md:max-w-none lg:max-w-none w-screen h-screen top-0 left-0 translate-x-0 translate-y-0 rounded-none bg-black overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Image viewer</DialogTitle>
            <DialogDescription>Full-screen carousel to browse studio and building images.</DialogDescription>
          </DialogHeader>
          <div className="relative w-screen h-screen">
            <Carousel className="w-full h-full" setApi={setCarouselApi} opts={{ startIndex: viewerIndex }}>
              <CarouselContent className="h-full ml-0">
                {allImages.map((src, i) => (
                  <CarouselItem key={src} className="h-full pl-0">
                    <div className="flex items-center justify-center w-full h-full bg-black">
                      <img
                        src={src}
                        alt="Studio image"
                        className="object-contain w-auto h-auto"
                        style={{ maxWidth: 'calc(100vw - 6rem)', maxHeight: 'calc(100vh - 6rem)' }}
                        loading={i === viewerIndex ? "eager" : "lazy"}
                      />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-4 z-50 size-12 rounded-full bg-white/95 text-black border border-black/20 shadow-lg hover:bg-white focus:ring-4 focus:ring-white/50 backdrop-blur-sm disabled:bg-gray-400 disabled:text-white disabled:opacity-100" />
              <CarouselNext className="right-4 z-50 size-12 rounded-full bg-white/95 text-black border border-black/20 shadow-lg hover:bg-white focus:ring-4 focus:ring-white/50 backdrop-blur-sm disabled:bg-gray-400 disabled:text-white disabled:opacity-100" />
            </Carousel>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


