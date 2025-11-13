"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, lazy, Suspense, useCallback } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { withBasePath } from "@/lib/utils";
import { ARTWORK_STUDIO_IMAGES, BUILDING_STUDIO_IMAGES, GALLERY_IMAGES_PUBLIC } from "@/lib/imageManifests";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "./ui/carousel";

// Lazy load AISpaceGenerator component for better performance
const AISpaceGenerator = lazy(() => import("./AISpaceGenerator").then(module => ({ default: module.AISpaceGenerator })));

// Skeleton loader component for progressive loading
function AISpaceGeneratorSkeleton() {
  return (
    <div className="flex flex-col animate-pulse" style={{ gap: 'clamp(0.75rem, 0.9vw, 1rem)' }}>
      {/* reCAPTCHA skeleton */}
      <div className="flex flex-col" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
      {/* Event type selector skeleton */}
      <div className="flex flex-col" style={{ gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
        <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        <div className="h-12 bg-gray-200 rounded"></div>
      </div>
      {/* Generate button skeleton */}
      <div className="h-10 bg-gray-200 rounded w-24"></div>
    </div>
  )
}

type Indices = { a: number; b: number; c: number };

export function StudioGalleryPage() {
  const [artworkImages, setArtworkImages] = useState<string[]>([]);
  const [buildingImages, setBuildingImages] = useState<string[]>([]);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [aiSpaceGenOpen, setAiSpaceGenOpen] = useState(false);
  const [isPreloadingAI, setIsPreloadingAI] = useState(false);
  const preloadTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup preload timer on unmount
  useEffect(() => {
    return () => {
      if (preloadTimerRef.current) {
        clearTimeout(preloadTimerRef.current);
      }
    };
  }, []);

  // Fetch images from API, fallback to static arrays
  useEffect(() => {
    async function fetchImages() {
      try {
        // Fetch all three categories in parallel
        const [artworkRes, buildingRes, galleryRes] = await Promise.all([
          fetch("/api/images?category=artwork_studio&limit=100"),
          fetch("/api/images?category=building_studio&limit=100"),
          fetch("/api/images?category=gallery&limit=100"),
        ]);

        // Process artwork images
        if (artworkRes.ok) {
          const artworkJson = await artworkRes.json();
          if (artworkJson.success) {
            // API returns { success: true, data: { images: [...] } }
            const responseData = artworkJson.data || artworkJson
            const images = responseData.images || []
            if (images.length > 0) {
              setArtworkImages(images.map((img: any) => img.blob_url));
            } else {
              setArtworkImages(ARTWORK_STUDIO_IMAGES);
            }
          } else {
            setArtworkImages(ARTWORK_STUDIO_IMAGES);
          }
        } else {
          setArtworkImages(ARTWORK_STUDIO_IMAGES);
        }

        // Process building images
        if (buildingRes.ok) {
          const buildingJson = await buildingRes.json();
          if (buildingJson.success) {
            // API returns { success: true, data: { images: [...] } }
            const responseData = buildingJson.data || buildingJson
            const images = responseData.images || []
            if (images.length > 0) {
              setBuildingImages(images.map((img: any) => img.blob_url));
            } else {
              setBuildingImages(BUILDING_STUDIO_IMAGES);
            }
          } else {
            setBuildingImages(BUILDING_STUDIO_IMAGES);
          }
        } else {
          setBuildingImages(BUILDING_STUDIO_IMAGES);
        }

        // Process gallery images
        if (galleryRes.ok) {
          const galleryJson = await galleryRes.json();
          if (galleryJson.success) {
            // API returns { success: true, data: { images: [...] } }
            const responseData = galleryJson.data || galleryJson
            const images = responseData.images || []
            if (images.length > 0) {
              setGalleryImages(images.map((img: any) => img.blob_url));
            } else {
              setGalleryImages(GALLERY_IMAGES_PUBLIC);
            }
          } else {
            setGalleryImages(GALLERY_IMAGES_PUBLIC);
          }
        } else {
          setGalleryImages(GALLERY_IMAGES_PUBLIC);
        }
      } catch (error) {
        console.error("Failed to fetch images from API, using static images:", error);
        // Fallback to static images
        setArtworkImages(ARTWORK_STUDIO_IMAGES);
        setBuildingImages(BUILDING_STUDIO_IMAGES);
        setGalleryImages(GALLERY_IMAGES_PUBLIC);
      } finally {
        setIsLoadingImages(false);
      }
    }

    fetchImages();
  }, []);

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
    if (artworkImages.length === 0 || buildingImages.length === 0) return;
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

  const [galleryCurrent, setGalleryCurrent] = useState(0);
  const [galleryNextIndex, setGalleryNextIndex] = useState<number | null>(null);
  const [galleryShowNext, setGalleryShowNext] = useState(false);
  const gRotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (galleryImages.length <= 1) return;
    const pickNext = () => {
      let r = Math.floor(Math.random() * galleryImages.length);
      if (galleryImages.length > 1) {
        while (r === galleryCurrent) r = Math.floor(Math.random() * galleryImages.length);
      }
      return r;
    };
    const startRotate = () => {
      gRotateTimerRef.current = setInterval(() => {
        const next = pickNext();
        setGalleryNextIndex(next);
        setGalleryShowNext(true);
        if (gFadeTimerRef.current) clearTimeout(gFadeTimerRef.current);
        gFadeTimerRef.current = setTimeout(() => {
          setGalleryCurrent(next);
          setGalleryShowNext(false);
          setGalleryNextIndex(null);
        }, fadeMs);
      }, rotateMs);
    };
    startRotate();
    return () => {
      if (gRotateTimerRef.current) clearInterval(gRotateTimerRef.current);
      if (gFadeTimerRef.current) clearTimeout(gFadeTimerRef.current);
    };
  }, [galleryImages.length, galleryCurrent]);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerMode, setViewerMode] = useState<"studio" | "gallery">("studio");
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);

  // Measure header blocks above each grid so tiles can grow to the largest
  // 16:9 size that still fits inside the stripe height.
  const leftHeaderRef = useRef<HTMLDivElement | null>(null);
  const rightHeaderRef = useRef<HTMLDivElement | null>(null);
  const [leftBlockH, setLeftBlockH] = useState(0);
  const [rightBlockH, setRightBlockH] = useState(0);

  useEffect(() => {
    const measureWithMargins = (el: HTMLElement | null): number => {
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      const mt = parseFloat(styles.marginTop || "0");
      const mb = parseFloat(styles.marginBottom || "0");
      return rect.height + mt + mb;
    };
    const update = () => {
      setLeftBlockH(measureWithMargins(leftHeaderRef.current));
      setRightBlockH(measureWithMargins(rightHeaderRef.current));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const openViewerForStudioImage = (src: string) => {
    setViewerMode("studio");
    const idx = allImages.indexOf(src);
    setViewerIndex(idx >= 0 ? idx : 0);
    setViewerOpen(true);
  };

  const openViewerForGalleryImage = (idx?: number) => {
    if (galleryImages.length === 0) return;
    setViewerMode("gallery");
    setViewerIndex(typeof idx === "number" ? idx : galleryCurrent);
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
        onClick={() => openViewerForStudioImage(onClickSrc(current))}
        className="relative aspect-[16/9] overflow-hidden focus:outline-hidden"
        aria-label="Open image viewer"
      >
        {tileLayer(key, "current", showNext ? "opacity-0" : "opacity-100", makeBgStyle(cur.src, cur.size, cur.pos))}
        {tileLayer(key, "next", showNext ? "opacity-100" : "opacity-0", makeBgStyle(nxt.src, nxt.size, nxt.pos))}
      </button>
    );
  };

  const renderGallerySlice = (key: string, colPct: number, rowPct: number) => {
    const curSrc = galleryImages[galleryCurrent] || "";
    const nextSrc = galleryNextIndex !== null ? galleryImages[galleryNextIndex] : curSrc;
    
    // Use fixed scale that works well for jigsaw effect
    return (
      <button
        key={key}
        type="button"
        onClick={() => openViewerForGalleryImage()}
        className="relative aspect-[16/9] overflow-hidden focus:outline-hidden"
        aria-label="Open gallery image viewer"
      >
        {tileLayer(key, "current", galleryShowNext ? "opacity-0" : "opacity-100", makeBgStyle(curSrc, "300% 300%", `${colPct}% ${rowPct}%`))}
        {tileLayer(key, "next", galleryShowNext ? "opacity-100" : "opacity-0", makeBgStyle(nextSrc, "300% 300%", `${colPct}% ${rowPct}%`))}
      </button>
    );
  };

  // Using Tailwind responsive spacing utilities for vertical rhythm

  return (
    <div className="min-h-vp lg:h-screen lg:overflow-y-auto lg:overflow-x-hidden bg-[#7a2d28]">
      {/* Section wrapper: limits background layers to the Studio/Gallery area only */}
      <section className="relative overflow-hidden pb-0">
        {/* Equal top spacer matching header height (Tailwind scale) */}
        {/* <div aria-hidden className="shrink-0 h-24 sm:h-28 md:h-32 lg:h-36" /> */}

        {/* Content block with backgrounds scoped to its height */}
        <div className="lg:h-screen lg:grid lg:place-items-center py-[max(var(--header-h,0px),clamp(24px,6vh,96px))] lg:pt-[calc(var(--header-h,0px)+3rem)] lg:pb-[var(--header-h,0px)] lg:overflow-y-auto lg:overflow-x-hidden">
          <div className="relative isolate bg-[#42210b] overflow-hidden h-auto lg:min-h-[var(--stripe-h)] w-full lg:grid lg:place-items-center" style={{ ['--stripe-h' as any]: 'calc(100svh - (var(--header-h, 0px) + var(--header-h, 0px) + 3rem))', ['--cta-h' as any]: 'clamp(3rem,5vh,6rem)' }}>

          {/* Portrait layer (right-center), blended over darker red */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url('${withBasePath('/assets/portrait/portrait_kade_nobg.png')}')`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right center',
              backgroundSize: 'contain',
              mixBlendMode: 'multiply',
              opacity: 0.3,
            }}
          />

          {/* Content row */}
          <div className="relative z-10 mx-auto w-full max-w-[92vw] px-[clamp(16px,3vw,40px)] flex flex-col lg:flex-row lg:items-stretch gap-y-[clamp(16px,4vw,40px)] lg:gap-x-[clamp(42px,10.4vw,208px)]">
      {/* Left Side - Studio */}
      <div className="@container/studio-left w-full lg:w-1/2 min-w-0 relative overflow-hidden" style={{ ['--block-h' as any]: `${leftBlockH}px` }}>

        <div className="relative z-10 flex flex-col min-h-full px-4 sm:px-6 md:px-8 lg:px-10 pt-4 md:pt-6 lg:pt-8 pb-4 md:pb-6 lg:pb-8">
          <div ref={leftHeaderRef} className="flex flex-col items-center shrink-0 mb-3 md:mb-4 mt-3 md:mt-4 min-h-20 md:min-h-24 lg:min-h-28">
            <div className="bg-[#5B9AB8]/80 px-5 sm:px-6 md:px-8 py-2 md:py-3 rounded-full mb-3 sm:mb-4 md:mb-6">
              <h2 className="text-white font-comfortaa font-normal text-[clamp(1.25rem,2.2vw,1.75rem)]">
                Studio
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-1 font-comfortaa font-light leading-relaxed text-[clamp(0.875rem,1.2vw,1rem)]">
              Hongsee Culture House is a creative hub
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa font-light leading-relaxed text-[clamp(0.875rem,1.2vw,1rem)]">
              for cultural events and the artistic community.
            </p>

            <div className="mt-4">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 sm:gap-2 md:gap-3 lg:gap-4 mt-3 sm:mt-4 md:mt-4 w-full mx-auto lg:max-w-[min(100%,calc((var(--stripe-h)-var(--block-h)-var(--cta-h,56px)-32px)*1.7778))]">
            {artworkImages.length > 0 && buildingImages.length > 0 ? (
              <>
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
              </>
            ) : (
              <>
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
                <div className="aspect-[16/9] bg-black/10 overflow-hidden" />
              </>
            )}
          </div>
          {/* Action button under Studio grid */}
          <div className="mt-4 sm:mt-5 md:mt-6 flex justify-center">
            <Dialog open={aiSpaceGenOpen} onOpenChange={setAiSpaceGenOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  aria-label="Tailor Your Reservation"
                  className="font-comfortaa inline-flex items-center justify-center w-auto whitespace-nowrap rounded-full bg-[#5B9AB8] text-white px-5 sm:px-6 md:px-8 py-2 md:py-3 text-[clamp(1.00rem,3.2vw,1.25rem)] shadow-sm hover:bg-[#4d8ea7] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/70 transition-colors"
                  onMouseEnter={() => {
                    // Preload component on hover (after 100ms delay to avoid unnecessary loads)
                    if (!isPreloadingAI && !aiSpaceGenOpen) {
                      preloadTimerRef.current = setTimeout(() => {
                        setIsPreloadingAI(true);
                        // Preload the component module
                        import("./AISpaceGenerator").catch(() => {
                          // Silently handle preload errors
                        });
                      }, 100);
                    }
                  }}
                  onMouseLeave={() => {
                    // Clear preload timer if user moves away quickly
                    if (preloadTimerRef.current) {
                      clearTimeout(preloadTimerRef.current);
                      preloadTimerRef.current = null;
                    }
                  }}
                >
                  Tailor Your Reservation
                </button>
              </DialogTrigger>
              <DialogContent className="top-0 left-0 translate-x-0 translate-y-0 w-full h-screen max-w-none sm:max-w-none rounded-none border-0 p-0 bg-transparent overflow-hidden">
                <DialogHeader className="sr-only">
                  <DialogTitle>AI Space Generator</DialogTitle>
                  <DialogDescription>Generate AI spaces by selecting images and describing your decoration style</DialogDescription>
                </DialogHeader>
                <div className="relative h-full flex flex-col overflow-hidden">
                  <div className="flex flex-col lg:flex-row h-full min-h-0">
                    {/* Left Side - Hero-like panel */}
                    <div className="w-full lg:w-[25%] bg-[#5B9AB8] flex flex-col justify-center py-6 sm:py-8 md:py-10 lg:py-6 xl:py-8 shrink-0 overflow-y-auto">
                      <div className="px-6 sm:px-8 md:px-10 lg:px-5 xl:px-6">
                        <div className="mb-4 sm:mb-6 lg:mb-4 xl:mb-6">
                          <div className="mb-3 sm:mb-4">
                            <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={96} height={96} className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-16 lg:h-16 3xl:w-[4.5rem] 3xl:h-[4.5rem] 4xl:w-[5rem] 4xl:h-[5rem] 5xl:w-[6rem] 5xl:h-[6rem]" />
                          </div>
                          <h1 className="font-heading" style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
                            Hell<br />University
                          </h1>
                        </div>
                        <h2 className="text-white mb-4 sm:mb-6 lg:mb-4 xl:mb-6 font-comfortaa" style={{ fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: '400' }}>
                          Tailor Your Reservation
                        </h2>
                        <p className="text-white/90 font-comfortaa text-sm sm:text-base lg:text-sm xl:text-base leading-relaxed">
                          Select images and describe your decoration style to generate AI-powered space designs.
                        </p>
                      </div>
                    </div>

                    {/* Right Side - Generator panel */}
                    <div className="w-full lg:w-[75%] bg-[#f4f1ed] flex items-center justify-center min-h-0 overflow-y-auto" style={{ padding: 'clamp(0.5rem, 0.8vw, 1rem) clamp(0.5rem, 0.8vw, 1rem)' }}>
                      <div className="w-full max-w-xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white/90 border rounded-lg shadow-lg h-full lg:h-auto lg:max-h-[95vh] flex flex-col" style={{ padding: 'clamp(0.75rem, 1vw, 1.5rem)' }}>
                        <div style={{ marginBottom: 'clamp(0.375rem, 0.6vw, 0.75rem)', flexShrink: 0 }}>
                          <h3 className="text-[#5a3a2a] font-comfortaa mb-1" style={{ fontSize: 'clamp(1.125rem, 1.4vw, 1.25rem)', fontWeight: '700' }}>
                            AI Space Generator
                          </h3>
                          <p className="text-[#5a3a2a]/70 font-comfortaa leading-tight" style={{ fontSize: 'clamp(0.6875rem, 0.75vw, 0.8125rem)', fontWeight: '300' }}>
                            Select images and describe your decoration style.
                          </p>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          <Suspense fallback={<AISpaceGeneratorSkeleton />}>
                            <AISpaceGenerator />
                          </Suspense>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          </div>
        </div>

      {/* Right Side - Gallery */}
      <div className="@container/studio-right w-full lg:w-1/2 min-w-0 relative overflow-hidden" style={{ ['--block-h' as any]: `${rightBlockH}px` }}>

        <div className="relative z-10 flex flex-col min-h-full px-4 sm:px-6 md:px-8 lg:px-10 pt-4 md:pt-6 lg:pt-8 pb-4 md:pb-6 lg:pb-8">
          <div ref={rightHeaderRef} className="flex flex-col items-center shrink-0 mb-3 md:mb-4 mt-3 md:mt-4 min-h-20 md:min-h-24 lg:min-h-28">
            <div className="bg-[#5B9AB8]/80 px-5 sm:px-6 md:px-8 py-2 md:py-3 rounded-full mb-3 sm:mb-4 md:mb-6">
              <h2 className="text-white font-comfortaa font-normal text-[clamp(1.25rem,2.2vw,1.75rem)]">
                Gallery
              </h2>
            </div>
            
            <p className="text-[#87CEEB] text-center max-w-md mb-1 font-comfortaa font-light leading-relaxed text-[clamp(0.875rem,1.2vw,1rem)]">
              Hell University, an archive and gallery
            </p>
            <p className="text-[#87CEEB] text-center max-w-md font-comfortaa font-light leading-relaxed text-[clamp(0.875rem,1.2vw,1rem)]">
              dedicated to research and education.
            </p>

            <div className="mt-4">
              <ChevronDown size={32} className="text-white/60" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 sm:gap-2 md:gap-3 lg:gap-4 mt-3 sm:mt-4 md:mt-4 w-full mx-auto lg:max-w-[min(100%,calc((var(--stripe-h)-var(--block-h)-var(--cta-h,56px)-32px)*1.7778))]">
            {galleryImages.length > 0 ? (
              <>
                {renderGallerySlice("gallery-1", 0, 0)}
                {renderGallerySlice("gallery-2", 50, 0)}
                {renderGallerySlice("gallery-3", 100, 0)}
                {renderGallerySlice("gallery-4", 0, 50)}
                {renderGallerySlice("gallery-5", 50, 50)}
                {renderGallerySlice("gallery-6", 100, 50)}
                {renderGallerySlice("gallery-7", 0, 100)}
                {renderGallerySlice("gallery-8", 50, 100)}
                {renderGallerySlice("gallery-9", 100, 100)}
              </>
            ) : (
              <>
                <div className="aspect-[16/9] bg-[#2C5F6F]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-white/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#8B4B3B]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#7BC74D]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-white/80 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#D4AF37]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#355C7D]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#6C5B7B]/90 overflow-hidden" />
                <div className="aspect-[16/9] bg-[#C06C84]/90 overflow-hidden" />
              </>
            )}
          </div>
          {/* Action button under Gallery grid */}
          <div className="mt-4 sm:mt-5 md:mt-6 flex justify-center">
            <a
              href="https://www.facebook.com/kadejavanalikhikara"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Visit Our Gallery"
              className="font-comfortaa inline-flex items-center justify-center w-auto whitespace-nowrap rounded-full bg-[#5B9AB8] text-white px-5 sm:px-6 md:px-8 py-2 md:py-3 text-[clamp(1.00rem,3.2vw,1.25rem)] shadow-sm hover:bg-[#4d8ea7] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/70 transition-colors"
            >
              Visit Our Gallery
            </a>
          </div>
        </div>
      </div>
        </div>
        {/* Equal bottom spacer matching header height (Tailwind scale) */}
        {/* <div aria-hidden className="shrink-0 h-24 sm:h-28 md:h-32 lg:h-36" /> */}
        </div>
        </div>
      </section>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="p-0 border-0 max-w-none sm:max-w-none md:max-w-none lg:max-w-none w-screen h-screen top-0 left-0 translate-x-0 translate-y-0 rounded-none bg-black overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Image viewer</DialogTitle>
            <DialogDescription>Full-screen carousel to browse images.</DialogDescription>
          </DialogHeader>
          <div className="relative w-screen h-screen">
            <Carousel className="w-full h-full" setApi={setCarouselApi} opts={{ startIndex: viewerIndex }}>
              <CarouselContent className="h-full ml-0">
                {(viewerMode === "studio" ? allImages : galleryImages).map((src, i) => (
                  <CarouselItem key={src} className="h-full pl-0">
                    <div className="flex items-center justify-center w-full h-full bg-black">
                      <img
                        src={src}
                        alt={viewerMode === "studio" ? "Studio image" : "Gallery image"}
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


