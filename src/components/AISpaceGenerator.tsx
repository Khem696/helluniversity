"use client"

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react"
import { withBasePath } from "@/lib/utils"
import { Turnstile } from "./Turnstile"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "./ui/dialog"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "./ui/carousel"
import { Progress } from "./ui/progress"
import { Checkbox } from "./ui/checkbox"

const STORAGE_KEY = "helluniversity_ai_generated_images"

interface StoredGeneratedImages {
  images: string[]
  timestamp: number
  prompt: string
  selectedImages: string[]
}

// Static style object - created once
const IMAGE_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  display: 'block',
  margin: 0,
  padding: 0,
  imageRendering: 'auto',
  contentVisibility: 'auto',
  backfaceVisibility: 'hidden',
  transform: 'translateZ(0)',
  contain: 'layout style paint'
}

// Simplified image slide item component
const ImageSlideItem = memo(function ImageSlideItem({
  url,
  isSelected,
  isTurnstileVerified,
  onToggle,
  index
}: {
  url: string
  isSelected: boolean
  isTurnstileVerified: boolean
  onToggle: (url: string) => void
  index: number
}) {
  const fileName = url.split("/").pop() || url
  
  // Use smaller dimensions for carousel thumbnails (max 280px)
  const displayWidth = 280
  const displayHeight = 280
  
  return (
    <CarouselItem className="pl-2 md:pl-4 basis-auto">
      <div
        onClick={() => isTurnstileVerified && onToggle(url)}
        className={`relative group cursor-pointer rounded-lg border-2 overflow-hidden bg-gray-100 w-[200px] h-[200px] sm:w-[240px] sm:h-[240px] md:w-[280px] md:h-[280px] ${
          isSelected ? 'border-[#5B9AB8] ring-2 ring-[#5B9AB8]/20' : 'border-gray-200 hover:border-gray-300'
        } ${!isTurnstileVerified ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        role="button"
        tabIndex={isTurnstileVerified ? 0 : -1}
        aria-label={`Select image ${fileName}`}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && isTurnstileVerified) {
            e.preventDefault()
            onToggle(url)
          }
        }}
      >
        <img
          src={url}
          alt={fileName}
          className="absolute inset-0"
          style={{
            ...IMAGE_STYLE,
            maxWidth: '280px',
            maxHeight: '280px'
          }}
          width={displayWidth}
          height={displayHeight}
          loading={index < 3 ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={index < 3 ? "high" : "low"}
          sizes="(max-width: 640px) 200px, (max-width: 768px) 240px, 280px"
        />
        <div className={`absolute inset-0 z-[1] transition-opacity duration-150 ${
          isSelected ? 'bg-[#5B9AB8]/20 opacity-100' : 'bg-black/0 group-hover:bg-black/10 opacity-0 group-hover:opacity-100'
        }`} />
        <div className="absolute top-2 right-2 z-[2] pointer-events-none">
          <div className={`flex items-center justify-center rounded-full transition-colors duration-150 ${
            isSelected 
              ? 'bg-[#5B9AB8] text-white shadow-lg' 
              : 'bg-white/90 group-hover:bg-white text-gray-600 shadow-md'
          }`}>
            <Checkbox
              checked={isSelected}
              disabled={!isTurnstileVerified}
              className="size-5 sm:size-6 pointer-events-none"
              aria-label={`Select ${fileName}`}
            />
          </div>
        </div>
      </div>
    </CarouselItem>
  )
})

// Helper function to check if URL is from BFL delivery domain
function isBFLDeliveryUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const bflDeliveryDomains = [
      'delivery-eu1.bfl.ai',
      'delivery-us1.bfl.ai',
      'delivery-eu.bfl.ai',
      'delivery-us.bfl.ai',
    ]
    return bflDeliveryDomains.includes(urlObj.hostname)
  } catch {
    return false
  }
}

export function AISpaceGenerator() {
  const [prompt, setPrompt] = useState("")
  const [studioImages, setStudioImages] = useState<string[]>([])
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState<string>("")
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [isTurnstileVerified, setIsTurnstileVerified] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [isLoadingImages, setIsLoadingImages] = useState(true)
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<number>>(new Set())
  const turnstileKeyRef = useRef(0) // Force Turnstile re-render

  // Load generated images from localStorage on component mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        try {
          const parsed: StoredGeneratedImages = JSON.parse(stored)
          // Only restore if data is less than 24 hours old
          const hoursSinceSave = (Date.now() - parsed.timestamp) / (1000 * 60 * 60)
          if (hoursSinceSave < 24 && parsed.images && parsed.images.length > 0) {
            setResults(parsed.images)
            // Optionally restore prompt and selected images for reference
            // setPrompt(parsed.prompt || "")
            // setSelectedImages(parsed.selectedImages || [])
          } else {
            // Clear old data
            localStorage.removeItem(STORAGE_KEY)
          }
        } catch (e) {
          console.error("Failed to parse stored generated images:", e)
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }, [])

  function handleTurnstileVerify(token: string) {
    setTurnstileToken(token)
    setIsTurnstileVerified(true)
  }

  function handleTurnstileError() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
    setError("CAPTCHA verification failed. Please try again.")
  }

  function handleTurnstileExpire() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
  }

  // Handle modal open/close - prevent closing while loading
  function handleResultsModalOpenChange(open: boolean) {
    // Prevent closing the modal when loading
    if (!open && isLoading) {
      return
    }
    setResultsModalOpen(open)
    // Reset image load errors when modal closes
    if (!open) {
      setImageLoadErrors(new Set())
    }
  }

  // Reset CAPTCHA when user wants to generate again
  function handleGenerateAgain() {
    // Reset CAPTCHA verification
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
    setError("")
    // Force Turnstile to re-render by incrementing key
    turnstileKeyRef.current += 1
    // Clear previous results
    setResults([])
    setPrompt("")
    setSelectedImages([])
    setImageLoadErrors(new Set())
    setCurrentImageIndex(0)
    // Clear localStorage
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  async function onGenerate() {
    if (!isTurnstileVerified || !turnstileToken) {
      setError("Please complete the CAPTCHA verification first.")
      return
    }

    if (selectedImages.length === 0) {
      setError("Please select at least one image.")
      return
    }

    if (prompt.trim().length === 0) {
      setError("Please provide a prompt.")
      return
    }

    setError("")
    setIsLoading(true)
    setLoadingProgress(0)
    setResults([])
    
    // Create AbortController to handle request cancellation
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, 300000) // 5 minutes timeout (generation can take a while)
    
    try {
      const response = await fetch("/api/ai-space", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: turnstileToken,
          selectedImages,
          prompt,
        }),
        signal: abortController.signal,
        // Prevent browser extensions from interfering
        cache: 'no-store',
        credentials: 'same-origin',
      })

      // Check if response is ok before parsing
      if (!response.ok) {
        const errorText = await response.text()
        let errorData: any = {}
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || response.statusText }
        }
        throw new Error(errorData.error || `Request failed with status ${response.status}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || "Failed to generate images")
      }

      let generatedImages = data.images || []
      
      // Proxy BFL delivery URLs through our API route for local development
      // This handles CORS and expiration issues
      generatedImages = generatedImages.map((url: string) => {
        if (isBFLDeliveryUrl(url)) {
          // Use proxy route in development, or if API routes are available
          return `/api/images/proxy?url=${encodeURIComponent(url)}`
        }
        return url
      })
      
      setResults(generatedImages)
      setLoadingProgress(100)
      
      // Save generated images to localStorage (defer to avoid blocking)
      if (typeof window !== "undefined" && generatedImages.length > 0) {
        // Use setTimeout to defer localStorage write and avoid blocking UI
        setTimeout(() => {
          try {
            const dataToSave: StoredGeneratedImages = {
              images: generatedImages,
              timestamp: Date.now(),
              prompt: prompt,
              selectedImages: selectedImages,
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
          } catch (e) {
            console.error("Failed to save generated images to localStorage:", e)
          }
        }, 0)
      }
      
      // Log batch information if available
      if (data.totalImages) {
        console.log(`Successfully generated ${data.totalImages} image(s)`)
      }
      
      // Reset CAPTCHA after successful generation (user needs to verify again to generate more)
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      turnstileKeyRef.current += 1
      
      // Open modal if there are results
      if (generatedImages.length > 0) {
        setResultsModalOpen(true)
      }
    } catch (e) {
      setResults([])
      
      // Handle specific error types
      if (e instanceof Error) {
        if (e.name === 'AbortError') {
          setError("Request timed out. Generation may take longer than expected. Please try again.")
        } else if (e.message.includes('fetch')) {
          setError("Network error. Please check your connection and try again. If the problem persists, it may be caused by a browser extension.")
        } else {
          setError(e.message || "Unknown error occurred")
        }
      } else {
        setError("Unknown error occurred")
      }
      
      console.error("AI generation error:", e)
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  // Memoize selected images set for O(1) lookup
  const selectedImagesSet = useMemo(() => new Set(selectedImages), [selectedImages])

  // Stable toggle handler - O(1) operations using Set
  const handleToggleImage = useCallback((url: string) => {
    if (!isTurnstileVerified) return
    
    setSelectedImages((prev) => {
      const prevSet = new Set(prev)
      if (prevSet.has(url)) {
        setError("")
        prevSet.delete(url)
        return Array.from(prevSet)
      } else {
        setError("")
        prevSet.add(url)
        return Array.from(prevSet)
      }
    })
  }, [isTurnstileVerified])

  // Fetch studio images dynamically on component mount
  useEffect(() => {
    async function fetchStudioImages() {
      try {
        setIsLoadingImages(true)
        const response = await fetch("/api/ai-space/images")
        const data = await response.json()
        
        if (data.success && data.images) {
          // Apply base path to each image URL
          const imagesWithBasePath = data.images.map((path: string) => withBasePath(path))
          setStudioImages(imagesWithBasePath)
        } else {
          console.warn("Failed to load studio images:", data.error)
          setError("Failed to load studio images. Please refresh the page.")
        }
      } catch (error) {
        console.error("Error fetching studio images:", error)
        setError("Failed to load studio images. Please refresh the page.")
      } finally {
        setIsLoadingImages(false)
      }
    }

    fetchStudioImages()
  }, [])

  // Handle carousel navigation
  useEffect(() => {
    if (!carouselApi) return

    const onSelect = () => {
      setCurrentImageIndex(carouselApi.selectedScrollSnap())
    }
    
    // Set initial index
    setCurrentImageIndex(carouselApi.selectedScrollSnap())
    
    carouselApi.on("select", onSelect)

    return () => {
      carouselApi.off("select", onSelect)
    }
  }, [carouselApi])

  // Reset carousel index when modal opens or results change
  useEffect(() => {
    if (resultsModalOpen && carouselApi && results.length > 0) {
      carouselApi.scrollTo(0)
      setCurrentImageIndex(0)
    }
  }, [resultsModalOpen, results.length, carouselApi])

  // Simulate loading progress (optional enhancement)
  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 90) return prev // Don't go to 100% until actual completion
          return prev + Math.random() * 10
        })
      }, 500)
      return () => clearInterval(interval)
    } else {
      setLoadingProgress(0)
    }
  }, [isLoading])

  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.75rem, 0.9vw, 1rem)' }}>
      {/* Turnstile CAPTCHA - Must be verified before using the form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
        <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
          Please verify you're human before proceeding:
        </p>
        <div className="lg:scale-75 xl:scale-90 origin-left">
          <Turnstile
            key={turnstileKeyRef.current}
            onVerify={handleTurnstileVerify}
            onError={handleTurnstileError}
            onExpire={handleTurnstileExpire}
            size="compact"
          />
        </div>
        {!isTurnstileVerified && (
          <p className="text-[#5a3a2a]/60 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            Complete verification to enable form fields
          </p>
        )}
      </div>

      <div className="flex flex-col" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
          <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            Select images (each image processed separately):
          </p>
          <span className="text-[#5a3a2a]/50 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            {selectedImages.length} selected
            {selectedImages.length > 0 && (
              <span className="ml-1 text-[#5a3a2a]/40">
                ({selectedImages.length} request{selectedImages.length > 1 ? 's' : ''})
              </span>
            )}
          </span>
        </div>
        {isLoadingImages ? (
          <p className="text-[#5a3a2a]/60 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            Loading images...
          </p>
        ) : studioImages.length === 0 ? (
          <p className="text-[#5a3a2a]/60 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            No images available. Please add images to public/aispaces/studio/
          </p>
        ) : (
          <div className="relative w-full">
            <Carousel
              opts={{
                align: "start",
                loop: false,
              }}
              className="w-full"
            >
              <CarouselContent className="-ml-2 md:-ml-4">
                {studioImages.map((url, index) => (
                  <ImageSlideItem
                    key={url}
                    url={url}
                    isSelected={selectedImagesSet.has(url)}
                    isTurnstileVerified={isTurnstileVerified}
                    onToggle={handleToggleImage}
                    index={index}
                  />
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-2 md:left-4 bg-white/95 hover:bg-white border border-gray-300 shadow-md disabled:opacity-50" />
              <CarouselNext className="right-2 md:right-4 bg-white/95 hover:bg-white border border-gray-300 shadow-md disabled:opacity-50" />
            </Carousel>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
        <label htmlFor="prompt" className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
          Describe the decoration style you want
        </label>
        <textarea
          id="prompt"
          name="prompt"
          autoComplete="off"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isTurnstileVerified ? "Describe the decoration style you want..." : "Please complete CAPTCHA verification first..."}
          disabled={!isTurnstileVerified}
          className={`w-full border rounded resize-none font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
          style={{ 
            minHeight: 'clamp(3rem, 3.5vw, 4rem)',
            padding: 'clamp(0.5rem, 0.6vw, 0.75rem)',
            fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)'
          }}
        />
      </div>

      <div className="flex items-center" style={{ gap: 'clamp(0.5rem, 0.6vw, 0.75rem)' }}>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading || selectedImages.length === 0 || prompt.trim().length === 0 || !isTurnstileVerified}
          className="rounded bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ 
            padding: 'clamp(0.5rem, 0.6vw, 0.75rem) clamp(0.75rem, 0.9vw, 1rem)',
            fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)'
          }}
        >
          {isLoading ? "Generating…" : "Generate"}
        </button>
        <span className="text-gray-500 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
          {selectedImages.length} selected
        </span>
      </div>

      {error && (
        <div className="text-red-600 font-comfortaa" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>
          {error}
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center justify-between text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            <span>
              Processing {selectedImages.length} image{selectedImages.length > 1 ? 's' : ''}...
            </span>
            <span>{Math.round(loadingProgress)}%</span>
          </div>
          <Progress value={loadingProgress} className="h-2" />
          <div className="flex items-center justify-center py-4">
            <div className="w-8 h-8 border-4 border-[#5B9AB8] border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
      )}

      {/* Results Preview */}
      {results.length > 0 && !isLoading && (
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setResultsModalOpen(true)}
            className="w-full text-center py-2 px-4 rounded bg-[#5B9AB8] text-white font-comfortaa hover:bg-[#4d8ea7] transition-colors"
            style={{ fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)' }}
          >
            View {results.length} Generated Image{results.length > 1 ? 's' : ''} ({currentImageIndex + 1}/{results.length})
          </button>
          <button
            type="button"
            onClick={handleGenerateAgain}
            className="w-full text-center py-2 px-4 rounded border border-[#5B9AB8] text-[#5B9AB8] font-comfortaa hover:bg-[#5B9AB8] hover:text-white transition-colors"
            style={{ fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)' }}
          >
            Generate Again (Requires CAPTCHA)
          </button>
        </div>
      )}

      {/* Results Modal with Carousel */}
      <Dialog open={resultsModalOpen} onOpenChange={handleResultsModalOpenChange}>
        <DialogContent 
          className="p-0 border-0 max-w-none sm:max-w-none md:max-w-none lg:max-w-none w-screen h-screen top-0 left-0 translate-x-0 translate-y-0 rounded-none bg-black overflow-hidden [&>button]:hidden"
          onInteractOutside={(e) => {
            // Prevent closing when loading
            if (isLoading) {
              e.preventDefault()
            }
          }}
          onEscapeKeyDown={(e) => {
            // Prevent closing when loading
            if (isLoading) {
              e.preventDefault()
            }
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Generated Images</DialogTitle>
            <DialogDescription>AI-generated space designs</DialogDescription>
          </DialogHeader>
          <div className="relative w-screen h-screen flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
              <div className="text-white font-comfortaa">
                <h3 className="text-lg font-semibold" id="modal-title">Generated Images</h3>
                <p className="text-sm text-white/70" aria-live="polite" aria-atomic="true">
                  {currentImageIndex + 1} of {results.length}
                </p>
              </div>
              {!isLoading && (
                <DialogClose asChild>
                  <button
                    className="text-white hover:text-white/70 transition-colors font-comfortaa px-4 py-2 rounded hover:bg-white/10"
                    style={{ fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)' }}
                  >
                    Close
                  </button>
                </DialogClose>
              )}
              {isLoading && (
                <div className="text-white font-comfortaa px-4 py-2 text-sm opacity-70">
                  Generating... Please wait
                </div>
              )}
            </div>

            {/* Carousel */}
            <div className="flex-1 pt-16">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-white">
                  <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="font-comfortaa text-lg">Generating images...</p>
                  <p className="font-comfortaa text-sm text-white/70 mt-2">
                    Please wait, this may take a few moments
                  </p>
                  <div className="mt-6 w-full max-w-md px-4">
                    <div className="flex items-center justify-between text-white/70 font-comfortaa text-sm mb-2">
                      <span>Progress</span>
                      <span>{Math.round(loadingProgress)}%</span>
                    </div>
                    <Progress value={loadingProgress} className="h-2" />
                  </div>
                </div>
              ) : (
                <Carousel 
                  className="w-full h-full" 
                  setApi={setCarouselApi}
                  opts={{ startIndex: 0 }}
                >
                  <CarouselContent className="h-full ml-0">
                    {results.map((url, idx) => (
                      <CarouselItem key={`${url}-${idx}`} className="h-full pl-0">
                        <div className="flex items-center justify-center w-full h-full bg-black">
                          {imageLoadErrors.has(idx) ? (
                            <div className="flex flex-col items-center justify-center text-white p-8">
                              <p className="font-comfortaa text-lg mb-2">Failed to load image</p>
                              <p className="font-comfortaa text-sm text-white/70">Image {idx + 1} of {results.length}</p>
                              <button
                                onClick={() => {
                                  setImageLoadErrors(prev => {
                                    const next = new Set(prev)
                                    next.delete(idx)
                                    return next
                                  })
                                }}
                                className="mt-4 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white font-comfortaa transition-colors"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <img
                              src={url}
                              alt={`AI generated space design ${idx + 1} of ${results.length}${prompt ? `: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}` : ''}`}
                              className="object-contain w-auto h-auto"
                              style={{ maxWidth: 'calc(100vw - 6rem)', maxHeight: 'calc(100vh - 6rem)' }}
                              loading={idx === 0 ? "eager" : "lazy"}
                              onError={() => {
                                setImageLoadErrors(prev => new Set(prev).add(idx))
                              }}
                              onLoad={() => {
                                setImageLoadErrors(prev => {
                                  const next = new Set(prev)
                                  next.delete(idx)
                                  return next
                                })
                              }}
                            />
                          )}
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="left-4 z-50 size-12 rounded-full bg-white/95 text-black border border-black/20 shadow-lg hover:bg-white focus:ring-4 focus:ring-white/50 backdrop-blur-sm disabled:bg-gray-400 disabled:text-white disabled:opacity-100" />
                  <CarouselNext className="right-4 z-50 size-12 rounded-full bg-white/95 text-black border border-black/20 shadow-lg hover:bg-white focus:ring-4 focus:ring-white/50 backdrop-blur-sm disabled:bg-gray-400 disabled:text-white disabled:opacity-100" />
                </Carousel>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


