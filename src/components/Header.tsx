"use client"

import Link from "next/link"
import { useRef, useState, useEffect, useCallback } from "react"
import { Calendar as CalendarIcon, Menu, X, AlertCircle, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { withBasePath } from "@/lib/utils"
import { Turnstile } from "./Turnstile"

const STORAGE_KEY = "helluniversity_booking_form"
const DEBOUNCE_DELAY = 500 // milliseconds

interface FormData {
  name: string
  email: string
  phone: string
  guests: string
  eventType: string
  introduction: string
  biography: string
  specialRequests: string
}

interface StoredFormData {
  formData: FormData
  selectedDate: string | null
  timestamp: number
}

interface FormError {
  type: "network" | "validation" | "server" | "turnstile" | "static"
  message: string
  retryable?: boolean
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>()
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [isTurnstileVerified, setIsTurnstileVerified] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    phone: "",
    guests: "",
    eventType: "",
    introduction: "",
    biography: "",
    specialRequests: ""
  })
  const [error, setError] = useState<FormError | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const turnstileKeyRef = useRef(0) // Force Turnstile re-render

  // Load form data from localStorage on component mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        try {
          const parsed: StoredFormData = JSON.parse(stored)
          // Only restore if data is less than 24 hours old
          const hoursSinceSave = (Date.now() - parsed.timestamp) / (1000 * 60 * 60)
          if (hoursSinceSave < 24) {
            setFormData(parsed.formData)
            if (parsed.selectedDate) {
              setSelectedDate(new Date(parsed.selectedDate))
            }
          } else {
            // Clear old data
            localStorage.removeItem(STORAGE_KEY)
          }
        } catch (e) {
          console.error("Failed to parse stored form data:", e)
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }, [])

  // Auto-save form data to localStorage with debouncing
  const saveFormData = useCallback(() => {
    if (typeof window !== "undefined") {
      const dataToSave: StoredFormData = {
        formData,
        selectedDate: selectedDate?.toISOString() || null,
        timestamp: Date.now()
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
      } catch (e) {
        console.error("Failed to save form data:", e)
      }
    }
  }, [formData, selectedDate])

  // Debounced save function
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveFormData()
    }, DEBOUNCE_DELAY)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formData, selectedDate, saveFormData])

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (error) {
      setError(null)
    }
  }

  const handleDateChange = (date: Date | undefined) => {
    setSelectedDate(date)
    // Clear error when user selects a date
    if (error) {
      setError(null)
    }
  }

  function handleTurnstileVerify(token: string) {
    setTurnstileToken(token)
    setIsTurnstileVerified(true)
    setError(null) // Clear any previous errors
  }

  function handleTurnstileError() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
    setError({
      type: "turnstile",
      message: "CAPTCHA verification failed. Please try again.",
      retryable: true
    })
  }

  function handleTurnstileExpire() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
    setError({
      type: "turnstile",
      message: "CAPTCHA verification expired. Please verify again to continue.",
      retryable: true
    })
  }

  // Reset Turnstile when modal opens (but preserve form data)
  const handleBookingOpenChange = (open: boolean) => {
    // Prevent closing the modal when submitting
    if (!open && isSubmitting) {
      return
    }
    setBookingOpen(open)
    if (open) {
      // Modal opened - reset captcha verification but keep form data
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      setError(null)
      setRetryCount(0)
      // Force Turnstile to re-render by incrementing key
      turnstileKeyRef.current += 1
    } else {
      // Modal closed - only clear on successful submission
      // Form data persists in localStorage
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    // Check if we're in static export mode (GitHub Pages)
    const isStaticMode = process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'
    
    if (isStaticMode) {
      // In static mode, API routes don't work - show helpful message
      setError({
        type: "static",
        message: "Reservation form is not available on this static site. Please contact us directly via email or phone.",
        retryable: false
      })
      return
    }
    
    // Validate Turnstile
    if (!isTurnstileVerified || !turnstileToken) {
      setError({
        type: "turnstile",
        message: "Please complete the CAPTCHA verification first.",
        retryable: false
      })
      return
    }
    
    // Validate required fields
    if (!selectedDate) {
      setError({
        type: "validation",
        message: "Please select a desired date.",
        retryable: false
      })
      return
    }
    if (!formData.guests) {
      setError({
        type: "validation",
        message: "Please select the number of guests.",
        retryable: false
      })
      return
    }
    if (!formData.eventType) {
      setError({
        type: "validation",
        message: "Please select an event type.",
        retryable: false
      })
      return
    }
    
    setIsSubmitting(true)
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch("/api/booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: turnstileToken,
          ...formData,
          date: selectedDate?.toISOString(),
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Handle non-JSON responses
      let data
      try {
        data = await response.json()
      } catch (jsonError) {
        throw new Error("Server returned invalid response. Please try again.")
      }
      
      if (!response.ok) {
        // Handle different HTTP error status codes
        if (response.status === 404) {
          // 404 likely means API route doesn't exist (static export mode)
          throw new Error("Reservation form is not available on this static site. Please contact us directly via email or phone.")
        } else if (response.status === 400) {
          throw new Error(data.error || "Invalid request. Please check your input and try again.")
        } else if (response.status === 401 || response.status === 403) {
          throw new Error("Authentication failed. Please refresh the page and try again.")
        } else if (response.status === 429) {
          throw new Error("Too many requests. Please wait a moment and try again.")
        } else if (response.status >= 500) {
          throw new Error("Server error. Please try again in a few moments.")
        } else {
          throw new Error(data.error || `Request failed with status ${response.status}`)
        }
      }
      
      if (!data.success) {
        // Extract error message, including details if available
        const errorMsg = data.error || "Failed to submit booking"
        const details = data.details ? ` ${data.details}` : ""
        throw new Error(errorMsg + details)
      }
      
      // Success - clear form data and localStorage
      toast.success("Reservation submitted successfully!", {
        description: "Thank you for your reservation request! We'll be in touch soon.",
        duration: 5000,
        className: "bg-green-50 border-green-200 text-green-900 rounded-lg shadow-lg font-comfortaa",
        style: {
          backgroundColor: "#f0fdf4",
          borderColor: "#bbf7d0",
          color: "#14532d",
          borderRadius: "0.5rem",
          padding: "1rem",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        },
      })
      
      setFormData({
        name: "",
        email: "",
        phone: "",
        guests: "",
        eventType: "",
        introduction: "",
        biography: "",
        specialRequests: ""
      })
      setSelectedDate(undefined)
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      
      // Clear localStorage on successful submission
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY)
      }
      
      setBookingOpen(false)
      setRetryCount(0)
      setError(null)
      
    } catch (error: any) {
      console.error("Booking submission error:", error)
      
      let errorMessage = "Failed to submit booking. Please try again."
      let errorType: FormError["type"] = "network"
      let retryable = true

      if (error.name === "AbortError") {
        errorMessage = "Request timed out. Please check your connection and try again."
        errorType = "network"
        retryable = true
      } else if (error.message) {
        errorMessage = error.message
        // Check for email-related errors
        if (error.message.includes("email") || error.message.includes("confirmation")) {
          errorType = "server"
          errorMessage = "Failed to send confirmation emails. Your form data has been saved. Please verify CAPTCHA again below and try submitting once more."
          retryable = true
        } else if (error.message.includes("network") || error.message.includes("fetch")) {
          errorType = "network"
          retryable = true
        } else if (error.message.includes("validation") || error.message.includes("required")) {
          errorType = "validation"
          retryable = false
        } else if (error.message.includes("server") || error.message.includes("500")) {
          errorType = "server"
          retryable = true
        }
      }

      // On error, reset CAPTCHA but keep form data in localStorage
      // User must verify CAPTCHA again to retry
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      turnstileKeyRef.current += 1

      // Form data stays in localStorage and form fields - user can retry
      setError({
        type: errorType,
        message: errorMessage,
        retryable
      })

      // Show error toast notification
      toast.error("Failed to submit reservation", {
        description: errorMessage,
        duration: 7000,
        className: "bg-red-50 border-red-200 text-red-900 rounded-lg shadow-lg font-comfortaa",
        style: {
          backgroundColor: "#fef2f2",
          borderColor: "#fecaca",
          color: "#991b1b",
          borderRadius: "0.5rem",
          padding: "1rem",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Retry submission handler
  const handleRetry = () => {
    if (error?.retryable && retryCount < 3) {
      setRetryCount(prev => prev + 1)
      setError(null)
      // Reset captcha to force re-verification
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      turnstileKeyRef.current += 1
    }
  }

  // Header height is provided via CSS defaults in globals to avoid first-paint jumps.

  return (
    <header ref={headerRef} className="absolute top-0 left-0 right-0 z-50 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2 sm:py-3 md:py-4 lg:py-6 no-horiz-overflow">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-none mx-auto mb-0 lg:mb-0 min-w-0 relative">
        {/* Logo (hidden ≤425px) */}
        <Link href="/" aria-label="Hell University Home" className="hidden lg:flex items-center justify-center ml-1 md:ml-0">
          <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 3xl:w-24 3xl:h-24 4xl:w-28 4xl:h-28 5xl:w-32 5xl:h-32 rounded-full bg-white border-2 lg:border-4 3xl:border-[6px] 4xl:border-8 border-[var(--hell-dusty-blue)]">
            <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={62} height={62} className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-16 lg:h-16 3xl:w-[4.5rem] 3xl:h-[4.5rem] 4xl:w-[5rem] 4xl:h-[5rem] 5xl:w-[6rem] 5xl:h-[6rem]" />
          </div>
        </Link>

        {/* Title - wraps on very small screens to avoid overlap; single line from phone and up */}
                <h1 className="flex-1 text-left font-heading font-black tracking-wide whitespace-normal lg:whitespace-nowrap lg:absolute lg:left-1/2 lg:-translate-x-1/2 lg:text-center max-w-[80vw] lg:max-w-none text-xl sm:text-2xl md:text-3xl lg:text-5xl 3xl:text-6xl 4xl:text-7xl 5xl:text-8xl">
          <span className="text-[var(--hell-dusty-blue)] font-urbanist font-extrabold leading-[1.2]">Hell</span>{' '}
          <span className="text-[#2a1f1a] font-urbanist font-extrabold leading-[1.2]">University</span>
        </h1>

        {/* Booking Button */}
        <Dialog open={bookingOpen} onOpenChange={handleBookingOpenChange}>
          <DialogTrigger className="hidden lg:flex items-center gap-3 text-white/80 hover:text-white transition-colors mr-1 sm:mr-2 md:mr-3 lg:mr-0" aria-label="Open Booking">
            <div className="flex items-center justify-center w-10 h-10 lg:w-12 lg:h-12 3xl:w-14 3xl:h-14 4xl:w-16 4xl:h-16 5xl:w-20 5xl:h-20 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <CalendarIcon className="w-5 h-5 lg:w-6 lg:h-6 3xl:w-7 3xl:h-7 4xl:w-8 4xl:h-8 5xl:w-10 5xl:h-10 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden lg:inline font-comfortaa font-normal text-sm lg:text-base 3xl:text-lg">Booking</span>
          </DialogTrigger>

          {/* Mobile/Tablet trigger placed next to burger (≤1023px) */}
          <DialogTrigger className="lg:hidden flex items-center gap-2 text-white/80 hover:text-white transition-colors absolute right-16 sm:right-20 md:right-24 top-1/2 -translate-y-1/2" aria-label="Open Booking">
            <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <CalendarIcon className="w-5 h-5 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden sm:inline font-comfortaa font-normal text-sm md:text-base">Booking</span>
          </DialogTrigger>

          <DialogContent 
            className={`top-0 left-0 translate-x-0 translate-y-0 w-full h-screen max-w-none sm:max-w-none rounded-none border-0 p-0 bg-transparent overflow-hidden ${isSubmitting ? '[&>button]:hidden [&>button]:pointer-events-none [&>button]:opacity-0' : ''}`}
            onEscapeKeyDown={(e) => {
              if (isSubmitting) {
                e.preventDefault()
              }
            }}
            onInteractOutside={(e) => {
              if (isSubmitting) {
                e.preventDefault()
              }
            }}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Booking</DialogTitle>
              <DialogDescription>Menu and Booking modal</DialogDescription>
            </DialogHeader>
            <div className="relative h-full flex flex-col overflow-hidden">
              <div className="flex flex-col lg:flex-row h-full min-h-0">
                {/* Left Side - Hero-like panel */}
                <div className="w-full lg:w-1/2 bg-[#5B9AB8] flex flex-col justify-center xl:pl-12 2xl:pl-16 py-6 sm:py-8 md:py-10 lg:py-8 xl:py-10 shrink-0 overflow-y-auto">
                  <div className="max-w-xl px-6 sm:px-8 md:px-10 lg:px-8 xl:px-10">
                    <h1 className="mb-4 sm:mb-6 lg:mb-6 xl:mb-8 font-heading" style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
                      Hell<br />University
                    </h1>
                    <h2 className="text-white mb-4 sm:mb-6 lg:mb-6 xl:mb-8 font-comfortaa" style={{ fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: '400' }}>
                      Menu
                    </h2>
                    <nav className="grid grid-cols-2 gap-2 sm:gap-3 text-white/95">
                      <Link href="/" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Home">Home</Link>
                      <Link href="/about" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="About">HUStory</Link>
                      <Link href="/studio-gallery" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Studio & Gallery">Studio/Gallery</Link>
                      <Link href="/contact" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Contact">Contact</Link>
                    </nav>
                  </div>
                </div>

                {/* Right Side - Booking Form */}
                <div className="w-full lg:w-1/2 bg-[#f4f1ed] flex items-start lg:items-center justify-center min-h-0 overflow-y-auto lg:overflow-y-visible" style={{ padding: 'clamp(1rem, 1.2vw, 1.5rem) clamp(0.75rem, 1vw, 1.5rem)' }}>
                  <div className="w-full max-w-xl lg:max-w-lg xl:max-w-xl bg-white/90 border rounded-lg shadow-lg" style={{ padding: 'clamp(0.75rem, 1vw, 1.5rem)' }}>
                    <div style={{ marginBottom: 'clamp(0.5rem, 0.8vw, 1rem)' }}>
                      <h3 className="text-[#5a3a2a] font-comfortaa mb-1" style={{ fontSize: 'clamp(1.125rem, 1.4vw, 1.25rem)', fontWeight: '700' }}>
                        Reservation Inquiry
                      </h3>
                      <p className="text-[#5a3a2a]/70 font-comfortaa leading-tight" style={{ fontSize: 'clamp(0.6875rem, 0.75vw, 0.8125rem)', fontWeight: '300' }}>
                        Share your vision with us and allow our curators to craft an extraordinary experience tailored to your unique sensibilities.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 0.9vw, 1rem)' }}>
                      {/* Static Mode Notice */}
                      {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1' && (
                        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 mb-2">
                          <p className="text-yellow-800 font-comfortaa text-sm font-medium mb-1">
                            ⚠️ Reservation Form Unavailable
                          </p>
                          <p className="text-yellow-700 font-comfortaa text-xs">
                            This static site doesn't support online reservations. Please contact us directly via email or phone to make a reservation.
                          </p>
                        </div>
                      )}
                      
                      {/* Turnstile CAPTCHA - Must be verified before using the form */}
                      {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES !== '1' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)', paddingBottom: 'clamp(0.375rem, 0.5vw, 0.5rem)', borderBottom: '1px solid rgb(229 231 235)' }}>
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
                            <p className={`font-comfortaa italic ${error ? "text-orange-600 font-medium" : "text-[#5a3a2a]/60"}`} style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
                              {error 
                                ? "⚠️ Please verify CAPTCHA again to retry submission"
                                : "Complete verification to enable form fields"
                              }
                            </p>
                          )}
                        </div>
                      )}

                      {/* Basic Information */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Basic Information</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="name" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Full Name *</Label>
                            <Input
                              id="name"
                              name="name"
                              type="text"
                              autoComplete="name"
                              required
                              value={formData.name}
                              onChange={(e) => handleInputChange("name", e.target.value)}
                              placeholder="Your full name"
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="email" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Email Address *</Label>
                            <Input
                              id="email"
                              name="email"
                              type="email"
                              autoComplete="email"
                              required
                              value={formData.email}
                              onChange={(e) => handleInputChange("email", e.target.value)}
                              placeholder="your@email.com"
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="phone" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Phone Number *</Label>
                            <Input
                              id="phone"
                              name="phone"
                              type="tel"
                              autoComplete="tel"
                              required
                              value={formData.phone}
                              onChange={(e) => handleInputChange("phone", e.target.value)}
                              placeholder="+1 (555) 123-4567"
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="guests" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Number of Guests *</Label>
                            {/* Native select for form validation - visually hidden but accessible to browsers */}
                            <select
                              id="guests"
                              name="guests"
                              value={formData.guests}
                              onChange={(e) => handleInputChange("guests", e.target.value)}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              style={{ 
                                position: 'absolute',
                                width: '1px',
                                height: '1px',
                                padding: 0,
                                margin: '-1px',
                                overflow: 'hidden',
                                clip: 'rect(0, 0, 0, 0)',
                                whiteSpace: 'nowrap',
                                borderWidth: 0
                              }}
                              tabIndex={-1}
                            >
                              <option value="">Select guest count</option>
                              {Array.from({ length: 15 }, (_, i) => i + 1).map((num) => (
                                <option key={num} value={num.toString()}>
                                  {num} {num === 1 ? "guest" : "guests"}
                                </option>
                              ))}
                            </select>
                            <Select value={formData.guests} onValueChange={(value) => handleInputChange("guests", value)} disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}>
                              <SelectTrigger id="guests-visual" aria-labelledby="guests-label" className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`} style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}>
                                <SelectValue placeholder="Select guest count" />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map((num) => (
                                  <SelectItem key={num} value={num.toString()}>
                                    {num} {num === 1 ? "guest" : "guests"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Event Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Event Details</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="desiredDate" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Desired Date *</Label>
                            {/* Native date input for form validation - visually hidden but accessible to browsers */}
                            <input
                              id="desiredDate"
                              name="date"
                              type="date"
                              value={selectedDate ? selectedDate.toISOString().split('T')[0] : ""}
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleDateChange(new Date(e.target.value))
                                }
                              }}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              style={{ 
                                position: 'absolute',
                                width: '1px',
                                height: '1px',
                                padding: 0,
                                margin: '-1px',
                                overflow: 'hidden',
                                clip: 'rect(0, 0, 0, 0)',
                                whiteSpace: 'nowrap',
                                borderWidth: 0
                              }}
                              tabIndex={-1}
                            />
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  id="desiredDate-visual"
                                  aria-labelledby="desiredDate-label"
                                  variant="outline"
                                  disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                  className={`w-full justify-start text-left font-normal font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`}
                                  style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                >
                                  <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={selectedDate}
                                  onSelect={handleDateChange}
                                  disabled={(date) => date < new Date() || !isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="eventType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Event Type *</Label>
                            {/* Native select for form validation - visually hidden but accessible to browsers */}
                            <select
                              id="eventType"
                              name="eventType"
                              value={formData.eventType}
                              onChange={(e) => handleInputChange("eventType", e.target.value)}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              style={{ 
                                position: 'absolute',
                                width: '1px',
                                height: '1px',
                                padding: 0,
                                margin: '-1px',
                                overflow: 'hidden',
                                clip: 'rect(0, 0, 0, 0)',
                                whiteSpace: 'nowrap',
                                borderWidth: 0
                              }}
                              tabIndex={-1}
                            >
                              <option value="">Select event type</option>
                              <option value="reunion">Reunion</option>
                              <option value="family-friends">Family & Friends</option>
                              <option value="baby-shower">Baby Shower</option>
                              <option value="engagement">Engagement</option>
                              <option value="art-workshop">Art Workshop</option>
                              <option value="painting-workshop">Painting Workshop</option>
                              <option value="ceramics-workshop">Ceramics Workshop</option>
                              <option value="brainstorming-session">Brainstorming Session</option>
                              <option value="other">Other</option>
                            </select>
                            <Select value={formData.eventType} onValueChange={(value) => handleInputChange("eventType", value)} disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}>
                              <SelectTrigger id="eventType-visual" aria-labelledby="eventType-label" className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`} style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}>
                                <SelectValue placeholder="Select event type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="reunion">Reunion</SelectItem>
                                <SelectItem value="family-friends">Family & Friends</SelectItem>
                                <SelectItem value="baby-shower">Baby Shower</SelectItem>
                                <SelectItem value="engagement">Engagement</SelectItem>
                                <SelectItem value="art-workshop">Art Workshop</SelectItem>
                                <SelectItem value="painting-workshop">Painting Workshop</SelectItem>
                                <SelectItem value="ceramics-workshop">Ceramics Workshop</SelectItem>
                                <SelectItem value="brainstorming-session">Brainstorming Session</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Personal Information */}
                      <div className="space-y-2 sm:space-y-3 lg:space-y-1.5">
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Share Your Story</h4>
                        <div className="space-y-2 sm:space-y-2.5 lg:space-y-1.5">
                          <div className="space-y-1">
                            <Label htmlFor="introduction" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Brief Introduction *</Label>
                            <Textarea
                              id="introduction"
                              name="introduction"
                              autoComplete="off"
                              required
                              value={formData.introduction}
                              onChange={(e) => handleInputChange("introduction", e.target.value)}
                              placeholder={isTurnstileVerified ? "Tell us a bit about yourself..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="biography" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Background & Interests</Label>
                            <Textarea
                              id="biography"
                              name="biography"
                              autoComplete="off"
                              value={formData.biography}
                              onChange={(e) => handleInputChange("biography", e.target.value)}
                              placeholder={isTurnstileVerified ? "Share your interests, profession..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="specialRequests" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Special Requests or Vision</Label>
                            <Textarea
                              id="specialRequests"
                              name="specialRequests"
                              autoComplete="off"
                              value={formData.specialRequests}
                              onChange={(e) => handleInputChange("specialRequests", e.target.value)}
                              placeholder={isTurnstileVerified ? "Describe your vision, special requirements..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Error Display */}
                      {error && (
                        <div 
                          className={`flex items-start gap-2 p-3 rounded-lg border ${
                            error.type === "validation" 
                              ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                              : error.type === "network"
                              ? "bg-red-50 border-red-200 text-red-800"
                              : error.type === "turnstile"
                              ? "bg-orange-50 border-orange-200 text-orange-800"
                              : error.type === "static"
                              ? "bg-yellow-50 border-yellow-300 text-yellow-800"
                              : "bg-red-50 border-red-200 text-red-800"
                          }`}
                          style={{ fontSize: 'clamp(0.6875rem, 0.75vw, 0.8125rem)' }}
                        >
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="font-comfortaa font-medium mb-1">{error.message}</p>
                            {(error.type === "server" || error.type === "network") && (
                              <div className="mt-2 p-2 bg-white/50 rounded border border-current/20">
                                <p className="font-comfortaa text-xs mb-1 font-semibold">
                                  Your form data has been saved. To retry:
                                </p>
                                <ol className="font-comfortaa text-xs list-decimal list-inside space-y-0.5 ml-1">
                                  <li>Verify CAPTCHA again below</li>
                                  <li>Click Submit Inquiry</li>
                                </ol>
                              </div>
                            )}
                            {error.retryable && retryCount >= 3 && (
                              <p className="font-comfortaa text-sm mt-2 opacity-75">
                                Maximum retry attempts reached. Please refresh the page or try again later.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Submit Button */}
                      <div className="flex flex-col items-center space-y-1.5 sm:space-y-2 lg:space-y-1 pt-2 sm:pt-2.5 lg:pt-1.5">
                        <Button
                          type="submit"
                          disabled={!isTurnstileVerified || isSubmitting || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                          className="font-comfortaa bg-[#5B9AB8] hover:bg-[#4d8ea7] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ 
                            padding: 'clamp(0.5rem, 0.6vw, 0.75rem) clamp(1rem, 1.2vw, 1.5rem)',
                            fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)'
                          }}
                        >
                          {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1' 
                            ? "Form Unavailable" 
                            : isSubmitting 
                            ? "Submitting..." 
                            : "Submit Inquiry"}
                        </Button>
                        <p className="text-[#5a3a2a]/70 text-center max-w-lg font-comfortaa leading-tight px-2" style={{ fontSize: 'clamp(0.5625rem, 0.6vw, 0.625rem)' }}>
                          {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'
                            ? "Please contact us directly via email or phone to make a reservation."
                            : "Your inquiry will be carefully reviewed by our curation team. We honor each request with thoughtful consideration and will respond within 48 hours."}
                        </p>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden text-white p-2 sm:p-3 sm:absolute sm:right-4 sm:top-1/2 sm:-translate-y-1/2"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>


      {/* Bottom Row: Desktop Nav */}
      <nav className="hidden lg:flex items-center justify-center gap-8 lg:gap-14 xl:gap-16 max-w-none mx-auto mb-0 lg:mb-0">
        <Link href="/" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Home</Link>
        <Link href="/about" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">HUStory</Link>
        <Link href="/studio-gallery" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-center justify-center h-full gap-8 mb-0 lg:mb-0">
            {/* Logo shown at top of menu on small screens */}
            <div className="mb-4">
              <div className="flex items-center justify-center w-[64px] h-[64px] rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
                <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={56} height={56} className="w-[56px] h-[56px]" />
              </div>
            </div>
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>HUStory</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}