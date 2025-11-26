"use client"

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react"
import { withBasePath, getThumbnailUrl, loadThumbnailManifest } from "@/lib/utils"
import { API_PATHS } from "@/lib/api-config"
import { Recaptcha } from "./Recaptcha"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

const STORAGE_KEY = "helluniversity_ai_generated_images"

interface StoredGeneratedImages {
  images: string[]
  timestamp: number
  eventType: string
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
  imageOrientation: 'none', // Prevent browser from applying EXIF orientation (we handle it in thumbnail generation)
  contentVisibility: 'auto',
  backfaceVisibility: 'hidden',
  transform: 'translateZ(0)',
  contain: 'layout style paint'
}

// Simplified image slide item component with Intersection Observer
const ImageSlideItem = memo(function ImageSlideItem({
  url,
  isSelected,
  isRecaptchaVerified,
  onToggle,
  index,
  shouldPreload
}: {
  url: string
  isSelected: boolean
  isRecaptchaVerified: boolean
  onToggle: (url: string) => void
  index: number
  shouldPreload: boolean
}) {
  const fileName = url.split("/").pop() || url
  const [isInView, setIsInView] = useState(shouldPreload)
  const [isLoaded, setIsLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Use smaller dimensions for carousel thumbnails (max 280px)
  const displayWidth = 280
  const displayHeight = 280
  
  // Get optimized thumbnail URL (falls back to original if API unavailable)
  const thumbnailUrl = useMemo(() => {
    // Extract the path relative to public directory
    const pathMatch = url.match(/\/aispaces\/studio\/[^/]+$/)
    if (pathMatch) {
      return getThumbnailUrl(pathMatch[0], displayWidth, displayHeight, 80)
    }
    // Fallback to original URL for external images or if path doesn't match
    return url
  }, [url, displayWidth, displayHeight])
  
  // Intersection Observer for lazy loading
  useEffect(() => {
    if (shouldPreload || isInView) return // Already visible or should preload
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true)
            observer.disconnect()
          }
        })
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold: 0.01
      }
    )
    
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    
    return () => {
      observer.disconnect()
    }
  }, [shouldPreload, isInView])
  
  // Preload image when in view
  useEffect(() => {
    if (isInView && !isLoaded && !imageError) {
      const img = new Image()
      img.src = thumbnailUrl
      img.onload = () => {
        setIsLoaded(true)
        setImageError(false)
      }
      img.onerror = () => {
        // If optimized image fails, try original as fallback
        if (thumbnailUrl !== url) {
          const fallbackImg = new Image()
          fallbackImg.src = url
          fallbackImg.onload = () => {
            setIsLoaded(true)
            setImageError(false)
          }
          fallbackImg.onerror = () => {
            setIsLoaded(true) // Mark as loaded to prevent infinite retries
            setImageError(true)
          }
        } else {
          setIsLoaded(true) // Mark as loaded to prevent infinite retries
          setImageError(true)
        }
      }
    }
  }, [isInView, thumbnailUrl, url, isLoaded, imageError])
  
  return (
    <CarouselItem className="pl-2 md:pl-4 basis-auto">
      <div
        ref={containerRef}
        onClick={() => isRecaptchaVerified && onToggle(url)}
        className={`relative group cursor-pointer rounded-lg border-2 overflow-hidden bg-gray-100 w-[200px] h-[200px] sm:w-[240px] sm:h-[240px] md:w-[280px] md:h-[280px] ${
          isSelected ? 'border-[#5B9AB8] ring-2 ring-[#5B9AB8]/20' : 'border-gray-200 hover:border-gray-300'
        } ${!isRecaptchaVerified ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        role="button"
        tabIndex={isRecaptchaVerified ? 0 : -1}
        aria-label={`Select image ${fileName}`}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && isRecaptchaVerified) {
            e.preventDefault()
            onToggle(url)
          }
        }}
      >
        {isInView && !imageError && (
          <img
            key={`img-${index}-${url}`} // Stable key based on original URL and index
            ref={imgRef}
            src={thumbnailUrl}
            alt={fileName}
            className={`absolute inset-0 transition-opacity duration-300 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              ...IMAGE_STYLE,
              maxWidth: '280px',
              maxHeight: '280px',
              // Force no rotation - ensure browser doesn't apply any transforms
              transform: 'translateZ(0) rotate(0deg)',
            }}
            width={displayWidth}
            height={displayHeight}
            loading={shouldPreload ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={shouldPreload ? "high" : "low"}
            sizes="(max-width: 640px) 200px, (max-width: 768px) 240px, 280px"
            onLoad={() => {
              setIsLoaded(true)
              setImageError(false)
            }}
            onError={() => {
              // Don't fallback to original - it might have wrong orientation
              // Instead, try to reload the thumbnail with cache busting
              if (imgRef.current && thumbnailUrl !== url) {
                const separator = thumbnailUrl.includes('?') ? '&' : '?'
                imgRef.current.src = `${thumbnailUrl}${separator}t=${Date.now()}`
              } else {
                setImageError(true)
                setIsLoaded(true)
              }
            }}
          />
        )}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
            <p className="text-xs text-gray-500 text-center px-2">Failed to load</p>
          </div>
        )}
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-200 animate-pulse">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-[#5B9AB8] rounded-full animate-spin" />
          </div>
        )}
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
              disabled={!isRecaptchaVerified}
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
  const [selectedEventType, setSelectedEventType] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState<string>("")
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null)
  const [isRecaptchaVerified, setIsRecaptchaVerified] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<number>>(new Set())
  const recaptchaKeyRef = useRef(0) // Force reCAPTCHA re-render
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null) // Store timeout for cleanup on unmount
  const abortControllerRef = useRef<AbortController | null>(null) // Store AbortController for cleanup on unmount

  // Event types available for selection (excluding "Other")
  const eventTypes = [
    { value: "Arts & Design Coaching", label: "Arts & Design Coaching Workshop" },
    { value: "Seminar & Workshop", label: "Seminar & Workshop" },
    { value: "Family Gathering", label: "Family Gathering" },
    { value: "Holiday Festive", label: "Holiday Festive" },
  ]

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
            if (parsed.eventType) {
              setSelectedEventType(parsed.eventType)
            }
          } else {
            // Clear old data
            localStorage.removeItem(STORAGE_KEY)
          }
        } catch (e) {
          // Use structured logger for errors (non-blocking)
          import('@/lib/logger').then(({ logError }) => {
            logError('Failed to parse stored generated images', {
              error: e instanceof Error ? e.message : String(e),
            }, e instanceof Error ? e : new Error(String(e))).catch(() => {
              // Fallback if logger fails
            })
          }).catch(() => {
            // Fallback if logger import fails
          })
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }, [])

  function handleRecaptchaVerify(token: string) {
    setRecaptchaToken(token)
    setIsRecaptchaVerified(true)
  }

  function handleRecaptchaError() {
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
    setError("CAPTCHA verification failed. Please try again.")
  }

  function handleRecaptchaExpire() {
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
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
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
    setError("")
    // Force reCAPTCHA to re-render by incrementing key
    recaptchaKeyRef.current += 1
    // Clear previous results
    setResults([])
    setSelectedEventType("")
    setImageLoadErrors(new Set())
    setCurrentImageIndex(0)
    // Clear localStorage
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  async function onGenerate() {
    if (!isRecaptchaVerified || !recaptchaToken) {
      setError("Please complete the CAPTCHA verification first.")
      return
    }

    if (!selectedEventType) {
      setError("Please select an event type.")
      return
    }

    setError("")
    setIsLoading(true)
    setLoadingProgress(0)
    setResults([])
    
    // Create AbortController to handle request cancellation
    const abortController = new AbortController()
    abortControllerRef.current = abortController // Store for cleanup on unmount
    
    // Clear any existing timeout before creating new one
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current)
      timeoutIdRef.current = null
    }
    
    // Set timeout for request cancellation (5 minutes)
    timeoutIdRef.current = setTimeout(() => {
      abortController.abort()
    }, 300000) // 5 minutes timeout (generation can take a while)
    
    try {
      const response = await fetch(API_PATHS.aiSpace, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: recaptchaToken,
          eventType: selectedEventType,
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
        
        // Helper function to extract error message from API response
        const getErrorMessage = (error: any, defaultMsg: string): string => {
          if (!error) return defaultMsg
          if (typeof error === 'string') return error
          if (typeof error === 'object') {
            if (error.message) return error.message
            if (Array.isArray(error.errors)) {
              return error.errors.join(', ')
            }
            if (error.details) {
              if (typeof error.details === 'string') return error.details
              if (Array.isArray(error.details.errors)) {
                return error.details.errors.join(', ')
              }
            }
            return JSON.stringify(error)
          }
          return defaultMsg
        }
        
        throw new Error(getErrorMessage(errorData.error, `Request failed with status ${response.status}`))
      }

      const json = await response.json()

      if (!json.success) {
        // Helper function to extract error message from API response
        const getErrorMessage = (error: any, defaultMsg: string): string => {
          if (!error) return defaultMsg
          if (typeof error === 'string') return error
          if (typeof error === 'object') {
            if (error.message) return error.message
            if (Array.isArray(error.errors)) {
              return error.errors.join(', ')
            }
            if (error.details) {
              if (typeof error.details === 'string') return error.details
              if (Array.isArray(error.details.errors)) {
                return error.details.errors.join(', ')
              }
            }
            return JSON.stringify(error)
          }
          return defaultMsg
        }
        throw new Error(getErrorMessage(json.error, "Failed to generate images"))
      }

      // API returns { success: true, data: { images: [...] } }
      const responseData = json.data || json
      let generatedImages = responseData.images || []
      
      // Proxy BFL delivery URLs through our API route for local development
      // This handles CORS and expiration issues
      // Note: In static export mode (GitHub Pages), proxy won't work since API routes are unavailable
      const useStaticImages = process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'
      generatedImages = generatedImages.map((url: string) => {
        if (isBFLDeliveryUrl(url) && !useStaticImages) {
          // Use proxy route in development/server mode, or if API routes are available
          return `${API_PATHS.imagesProxy}?url=${encodeURIComponent(url)}`
        }
        // In static mode, use BFL URLs directly (they may expire, but API proxy isn't available)
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
              eventType: selectedEventType,
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
          } catch (e) {
            // Use structured logger for errors (non-blocking)
            import('@/lib/logger').then(({ logError }) => {
              logError('Failed to save generated images to localStorage', {
                error: e instanceof Error ? e.message : String(e),
              }, e instanceof Error ? e : new Error(String(e))).catch(() => {
                // Fallback if logger fails
              })
            }).catch(() => {
              // Fallback if logger import fails
            })
          }
        }, 0)
      }
      
      // Log batch information if available (development only)
      if (responseData.totalImages && process.env.NODE_ENV === 'development') {
        import('@/lib/logger').then(({ logDebug }) => {
          logDebug('Successfully generated images', {
            totalImages: responseData.totalImages,
          }).catch(() => {
            // Fallback if logger fails
          })
        }).catch(() => {
          // Fallback if logger import fails
        })
      }
      
      // Reset CAPTCHA after successful generation (user needs to verify again to generate more)
      setRecaptchaToken(null)
      setIsRecaptchaVerified(false)
      recaptchaKeyRef.current += 1
      
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
      
      // Use structured logger for errors (non-blocking)
      import('@/lib/logger').then(({ logError }) => {
        logError('AI generation error', {
          error: e instanceof Error ? e.message : String(e),
          errorName: e instanceof Error ? e.name : undefined,
        }, e instanceof Error ? e : new Error(String(e))).catch(() => {
          // Fallback if logger fails
        })
      }).catch(() => {
        // Fallback if logger import fails
      })
    } finally {
      // Always clear timeout and reset refs
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }
  
  // Cleanup on component unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clear timeout if component unmounts while request is in progress
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
      // Abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
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
      {/* reCAPTCHA v2 - Must be verified before using the form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
        <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
          Please verify you're human before proceeding:
        </p>
        <div className="lg:scale-75 xl:scale-90 origin-left">
          <Recaptcha
            key={recaptchaKeyRef.current}
            onVerify={handleRecaptchaVerify}
            onError={handleRecaptchaError}
            onExpire={handleRecaptchaExpire}
            size="compact"
          />
        </div>
        {!isRecaptchaVerified && (
          <p className="text-[#5a3a2a]/60 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
            Complete verification to enable form fields
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
        <label htmlFor="event-type-select" className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
          Select event type to generate AI space design
        </label>
        <Select 
          value={selectedEventType} 
          onValueChange={setSelectedEventType}
          disabled={!isRecaptchaVerified}
        >
          <SelectTrigger 
            id="event-type-select"
            className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`}
            style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2.5rem, 3vw, 3rem)' }}
          >
            <SelectValue placeholder={isRecaptchaVerified ? "Select event type..." : "Please complete CAPTCHA verification first..."} />
          </SelectTrigger>
          <SelectContent>
            {eventTypes.map((eventType) => (
              <SelectItem key={eventType.value} value={eventType.value}>
                {eventType.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center" style={{ gap: 'clamp(0.5rem, 0.6vw, 0.75rem)' }}>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading || !selectedEventType || !isRecaptchaVerified || results.length > 0}
          className="rounded bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ 
            padding: 'clamp(0.5rem, 0.6vw, 0.75rem) clamp(0.75rem, 0.9vw, 1rem)',
            fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)'
          }}
        >
          {isLoading ? "Generating…" : "Generate"}
        </button>
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
              Generating AI space design...
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
                              alt={`AI generated space design ${idx + 1} of ${results.length}`}
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


