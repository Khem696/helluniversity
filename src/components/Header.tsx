"use client"

import Link from "next/link"
import { useRef, useState, useEffect, useCallback } from "react"
import { Calendar as CalendarIcon, Menu, X, AlertCircle, RefreshCw, Clock } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { format } from "date-fns"
import { withBasePath } from "@/lib/utils"
import { Recaptcha } from "./Recaptcha"
import PhoneInput from "react-phone-number-input"

const STORAGE_KEY = "helluniversity_booking_form"
const DEBOUNCE_DELAY = 500 // milliseconds

// Helper function to add AM/PM to 24-hour time format (keeps 24-hour format)
function formatTimeWithAMPM(time24: string): string {
  if (!time24 || !time24.includes(':')) return ''
  
  const [hours, minutes] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  const mins = minutes || '00'
  
  if (isNaN(hour24)) return time24
  
  // Keep 24-hour format but add AM/PM
  if (hour24 < 12) {
    return `${hours.padStart(2, '0')}:${mins} AM`
  } else {
    return `${hours.padStart(2, '0')}:${mins} PM`
  }
}

interface FormData {
  name: string
  email: string
  phone: string
  participants: string
  eventType: string
  otherEventType: string
  dateRange: boolean // false = single day, true = date range
  startDate: string | null
  endDate: string | null
  startTime: string
  endTime: string
  organizationType: "Tailor Event" | "Space Only" | ""
  introduction: string
  biography: string
  specialRequests: string
}

interface StoredFormData {
  formData: FormData
  timestamp: number
}

interface FormError {
  type: "network" | "validation" | "server" | "recaptcha" | "static"
  message: string
  retryable?: boolean
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null)
  const [isRecaptchaVerified, setIsRecaptchaVerified] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    phone: "",
    participants: "",
    eventType: "",
    otherEventType: "",
    dateRange: false,
    startDate: null,
    endDate: null,
    startTime: "",
    endTime: "",
    organizationType: "",
    introduction: "",
    biography: "",
    specialRequests: ""
  })
  const [error, setError] = useState<FormError | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const recaptchaKeyRef = useRef(0) // Force reCAPTCHA re-render

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
            if (parsed.formData.startDate) {
              setStartDate(new Date(parsed.formData.startDate))
            }
            if (parsed.formData.endDate) {
              setEndDate(new Date(parsed.formData.endDate))
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
        formData: {
          ...formData,
          startDate: startDate?.toISOString() || null,
          endDate: endDate?.toISOString() || null,
        },
        timestamp: Date.now()
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
      } catch (e) {
        console.error("Failed to save form data:", e)
      }
    }
  }, [formData, startDate, endDate])

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
  }, [formData, startDate, endDate, saveFormData])

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value }
      // Clear otherEventType if event type changes away from "Other"
      if (field === "eventType" && value !== "Other") {
        updated.otherEventType = ""
      }
      return updated
    })
    // Clear error when user starts typing
    if (error) {
      setError(null)
    }
  }

  const handleStartDateChange = (date: Date | undefined) => {
    setStartDate(date)
    setFormData(prev => ({ ...prev, startDate: date?.toISOString() || null }))
    // Clear error when user selects a date
    if (error) {
      setError(null)
    }
  }

  const handleEndDateChange = (date: Date | undefined) => {
    // Validate that end date is not the same as start date when dateRange is true
    if (formData.dateRange && date && startDate) {
      const startDateStr = startDate.toISOString().split('T')[0]
      const endDateStr = date.toISOString().split('T')[0]
      if (startDateStr === endDateStr) {
        setError({
          type: "validation",
          message: "End date cannot be the same as start date. Please select a different end date.",
          retryable: false
        })
        return
      }
    }
    
    setEndDate(date)
    setFormData(prev => ({ ...prev, endDate: date?.toISOString() || null }))
    // Clear error when user selects a valid date
    if (error) {
      setError(null)
    }
  }

  const handleDateRangeToggle = (isRange: boolean) => {
    setFormData(prev => ({ ...prev, dateRange: isRange }))
    if (!isRange) {
      // Single day mode - clear end date
      setEndDate(undefined)
      setFormData(prev => ({ ...prev, endDate: null }))
    }
  }

  function handleRecaptchaVerify(token: string) {
    setRecaptchaToken(token)
    setIsRecaptchaVerified(true)
    setError(null) // Clear any previous errors
  }

  function handleRecaptchaError() {
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
    setError({
      type: "recaptcha",
      message: "CAPTCHA verification failed. Please try again.",
      retryable: true
    })
  }

  function handleRecaptchaExpire() {
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
    setError({
      type: "recaptcha",
      message: "CAPTCHA verification expired. Please verify again to continue.",
      retryable: true
    })
  }

  // Reset reCAPTCHA when modal opens (but preserve form data)
  const handleBookingOpenChange = (open: boolean) => {
    // Prevent closing the modal when submitting
    if (!open && isSubmitting) {
      return
    }
    setBookingOpen(open)
    if (open) {
      // Modal opened - reset captcha verification but keep form data
      setRecaptchaToken(null)
      setIsRecaptchaVerified(false)
      setError(null)
      setRetryCount(0)
      // Force reCAPTCHA to re-render by incrementing key
      recaptchaKeyRef.current += 1
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
    
    // Validate reCAPTCHA
    if (!isRecaptchaVerified || !recaptchaToken) {
      setError({
        type: "recaptcha",
        message: "Please complete the CAPTCHA verification first.",
        retryable: false
      })
      return
    }
    
    // Validate required fields
    if (!startDate) {
      setError({
        type: "validation",
        message: "Please select a start date.",
        retryable: false
      })
      return
    }
    if (formData.dateRange && !endDate) {
      setError({
        type: "validation",
        message: "Please select an end date for the date range.",
        retryable: false
      })
      return
    }
    // Validate that start and end dates are not the same when dateRange is true
    if (formData.dateRange && startDate && endDate) {
      const startDateStr = startDate.toISOString().split('T')[0]
      const endDateStr = endDate.toISOString().split('T')[0]
      if (startDateStr === endDateStr) {
        setError({
          type: "validation",
          message: "End date cannot be the same as start date. Please select a different end date.",
          retryable: false
        })
        return
      }
    }
    if (!formData.startTime) {
      setError({
        type: "validation",
        message: "Please select a start time.",
        retryable: false
      })
      return
    }
    if (!formData.endTime) {
      setError({
        type: "validation",
        message: "Please select an end time.",
        retryable: false
      })
      return
    }
    if (!formData.participants || parseInt(formData.participants) <= 0) {
      setError({
        type: "validation",
        message: "Please enter the number of participants (must be greater than 0).",
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
    if (formData.eventType === "Other" && !formData.otherEventType.trim()) {
      setError({
        type: "validation",
        message: "Please specify the event type.",
        retryable: false
      })
      return
    }
    if (!formData.organizationType) {
      setError({
        type: "validation",
        message: "Please select an organization type.",
        retryable: false
      })
      return
    }
    
    setIsSubmitting(true)
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      // Prepare booking data - ensure all fields are properly formatted
      const bookingPayload = {
        token: recaptchaToken,
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        participants: formData.participants.trim(),
        eventType: formData.eventType.trim(),
        otherEventType: formData.otherEventType.trim(),
        dateRange: formData.dateRange,
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
        startTime: formData.startTime.trim(),
        endTime: formData.endTime.trim(),
        organizationType: formData.organizationType,
        introduction: formData.introduction.trim(),
        biography: formData.biography.trim(),
        specialRequests: formData.specialRequests.trim(),
      }
      
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bookingPayload),
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
        participants: "",
        eventType: "",
        otherEventType: "",
        dateRange: false,
        startDate: null,
        endDate: null,
        startTime: "",
        endTime: "",
        organizationType: "",
        introduction: "",
        biography: "",
        specialRequests: ""
      })
      setStartDate(undefined)
      setEndDate(undefined)
      setRecaptchaToken(null)
      setIsRecaptchaVerified(false)
      
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
      setRecaptchaToken(null)
      setIsRecaptchaVerified(false)
      recaptchaKeyRef.current += 1

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
      setRecaptchaToken(null)
      setIsRecaptchaVerified(false)
      recaptchaKeyRef.current += 1
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
                  </div>
                </div>

                {/* Right Side - Booking Form */}
                <div className="w-full lg:w-[75%] bg-[#f4f1ed] flex items-start justify-center min-h-0 overflow-y-auto" style={{ padding: 'clamp(0.5rem, 0.8vw, 1rem) clamp(0.5rem, 0.8vw, 1rem)' }}>
                  <div className="w-full max-w-xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white/90 border rounded-lg shadow-lg h-full lg:h-auto lg:max-h-[95vh] flex flex-col" style={{ padding: 'clamp(0.75rem, 1vw, 1.5rem)' }}>
                    <div style={{ marginBottom: 'clamp(0.375rem, 0.6vw, 0.75rem)', flexShrink: 0 }}>
                      <h3 className="text-[#5a3a2a] font-comfortaa mb-1" style={{ fontSize: 'clamp(1.125rem, 1.4vw, 1.25rem)', fontWeight: '700' }}>
                        Reservation Inquiry
                      </h3>
                      <p className="text-[#5a3a2a]/70 font-comfortaa leading-tight" style={{ fontSize: 'clamp(0.6875rem, 0.75vw, 0.8125rem)', fontWeight: '300' }}>
                        Share your vision with us and allow our curators to craft an extraordinary experience tailored to your unique sensibilities.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.4rem, 0.6vw, 0.75rem)' }}>
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
                      
                      {/* reCAPTCHA v2 - Must be verified before using the form */}
                      {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES !== '1' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)', paddingBottom: 'clamp(0.375rem, 0.5vw, 0.5rem)', borderBottom: '1px solid rgb(229 231 235)' }}>
                          <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
                            Please verify you're human before proceeding:
                          </p>
                          <div 
                            className="origin-left"
                            style={{
                              transform: 'scale(0.9)',
                              transformOrigin: 'left center',
                              position: 'relative',
                              zIndex: 1000,
                              pointerEvents: 'auto'
                            }}
                          >
                            <Recaptcha
                              key={recaptchaKeyRef.current}
                              onVerify={handleRecaptchaVerify}
                              onError={handleRecaptchaError}
                              onExpire={handleRecaptchaExpire}
                              size="compact"
                            />
                          </div>
                          {!isRecaptchaVerified && (
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.4vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Basic Information</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
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
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
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
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="phone" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Phone Number *</Label>
                            <div className={`phone-input-wrapper ${!isRecaptchaVerified ? "opacity-50 pointer-events-none" : ""}`}>
                              <PhoneInput
                                international
                                defaultCountry="US"
                                value={formData.phone || undefined}
                                onChange={(value) => handleInputChange("phone", value || "")}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                className="font-comfortaa"
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="participants" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Number of Participants *</Label>
                            <Input
                              id="participants"
                              name="participants"
                              type="number"
                              min="1"
                              required
                              value={formData.participants}
                              onChange={(e) => handleInputChange("participants", e.target.value)}
                              placeholder="Enter number of participants"
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Event Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.4vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Event Details</h4>
                        
                        {/* Date Range Toggle */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                          <Label className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Date Selection *</Label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="dateRange"
                                checked={!formData.dateRange}
                                onChange={() => handleDateRangeToggle(false)}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                className="cursor-pointer"
                              />
                              <span className="font-comfortaa text-sm" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Single Day</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="dateRange"
                                checked={formData.dateRange}
                                onChange={() => handleDateRangeToggle(true)}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                className="cursor-pointer"
                              />
                              <span className="font-comfortaa text-sm" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Date Range</span>
                            </label>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          {/* Start Date */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="startDate" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>
                              {formData.dateRange ? "Start Date *" : "Date *"}
                            </Label>
                            <input
                              id="startDate"
                              name="startDate"
                              type="date"
                              value={startDate ? startDate.toISOString().split('T')[0] : ""}
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleStartDateChange(new Date(e.target.value))
                                }
                              }}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
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
                                  id="startDate-visual"
                                  variant="outline"
                                  disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                  className={`w-full justify-start text-left font-normal font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`}
                                  style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                >
                                  <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                  {startDate ? format(startDate, "PPP") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <SimpleCalendar
                                  selected={startDate}
                                  onSelect={handleStartDateChange}
                                  disabled={(date) => date < new Date() || !isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* End Date (only shown for date range) */}
                          {formData.dateRange && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                              <Label htmlFor="endDate" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>End Date *</Label>
                              <input
                                id="endDate"
                                name="endDate"
                                type="date"
                                value={endDate ? endDate.toISOString().split('T')[0] : ""}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleEndDateChange(new Date(e.target.value))
                                  }
                                }}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
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
                                    id="endDate-visual"
                                    variant="outline"
                                    disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                    className={`w-full justify-start text-left font-normal font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`}
                                    style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                  >
                                    <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                    {endDate ? format(endDate, "PPP") : "Pick end date"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <SimpleCalendar
                                    selected={endDate}
                                    onSelect={handleEndDateChange}
                                    disabled={(date) => {
                                      if (!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1') return true
                                      if (date < new Date()) return true
                                      if (startDate) {
                                        const startDateStr = startDate.toISOString().split('T')[0]
                                        const dateStr = date.toISOString().split('T')[0]
                                        // Disable if date is before start date OR same as start date
                                        return date < startDate || startDateStr === dateStr
                                      }
                                      return false
                                    }}
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          )}

                          {/* Start Time */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="startTime" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Start Time *</Label>
                            <div className="relative">
                              <Input
                                id="startTime"
                                name="startTime"
                                type="time"
                                required
                                value={formData.startTime}
                                onChange={(e) => handleInputChange("startTime", e.target.value)}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                                style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                              />
                              <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            </div>
                            {formData.startTime && (
                              <span className="text-xs text-gray-600 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.65vw, 0.6875rem)' }}>
                                {formatTimeWithAMPM(formData.startTime)}
                              </span>
                            )}
                          </div>

                          {/* End Time */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="endTime" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>End Time *</Label>
                            <div className="relative">
                              <Input
                                id="endTime"
                                name="endTime"
                                type="time"
                                required
                                value={formData.endTime}
                                onChange={(e) => handleInputChange("endTime", e.target.value)}
                                disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                                style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                              />
                              <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            </div>
                            {formData.endTime && (
                              <span className="text-xs text-gray-600 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.65vw, 0.6875rem)' }}>
                                {formatTimeWithAMPM(formData.endTime)}
                              </span>
                            )}
                          </div>

                          {/* Event Type */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="eventType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Event Type *</Label>
                            <select
                              id="eventType"
                              name="eventType"
                              value={formData.eventType}
                              onChange={(e) => handleInputChange("eventType", e.target.value)}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
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
                              <option value="Arts & Design Coaching">Arts & Design Coaching Workshop</option>
                              <option value="Seminar & Workshop">Seminar & Workshop</option>
                              <option value="Family Gathering">Family Gathering</option>
                              <option value="Holiday Festive">Holiday Festive</option>
                              <option value="Other">Other</option>
                            </select>
                            <Select value={formData.eventType} onValueChange={(value) => handleInputChange("eventType", value)} disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}>
                              <SelectTrigger id="eventType-visual" aria-labelledby="eventType-label" className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`} style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}>
                                <SelectValue placeholder="Select event type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Arts & Design Coaching">Arts & Design Coaching Workshop</SelectItem>
                                <SelectItem value="Seminar & Workshop">Seminar & Workshop</SelectItem>
                                <SelectItem value="Family Gathering">Family Gathering</SelectItem>
                                <SelectItem value="Holiday Festive">Holiday Festive</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Other Event Type - Conditional field */}
                        {formData.eventType === "Other" && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="otherEventType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Please Specify *</Label>
                            <Input
                              id="otherEventType"
                              name="otherEventType"
                              type="text"
                              required
                              value={formData.otherEventType}
                              onChange={(e) => handleInputChange("otherEventType", e.target.value)}
                              placeholder="Please specify your event type"
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                        )}

                        {/* Organization Type */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                          <Label className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Organization *</Label>
                          <RadioGroup
                            value={formData.organizationType}
                            onValueChange={(value) => handleInputChange("organizationType", value)}
                            disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                            className="flex flex-row gap-6"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="Tailor Event" id="tailor-event" disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'} />
                              <Label htmlFor="tailor-event" className="font-comfortaa cursor-pointer" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>
                                Tailor Event
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="Space Only" id="space-only" disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'} />
                              <Label htmlFor="space-only" className="font-comfortaa cursor-pointer" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>
                                Space Only
                              </Label>
                            </div>
                          </RadioGroup>
                          {formData.organizationType && (
                            <p className="text-[#5a3a2a]/70 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
                              {formData.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Personal Information */}
                      <div className="space-y-1 sm:space-y-2 lg:space-y-1">
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Share Your Story</h4>
                        <div className="space-y-1 sm:space-y-1.5 lg:space-y-1">
                          <div className="space-y-1">
                            <Label htmlFor="introduction" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Brief Introduction *</Label>
                            <Textarea
                              id="introduction"
                              name="introduction"
                              autoComplete="off"
                              required
                              value={formData.introduction}
                              onChange={(e) => handleInputChange("introduction", e.target.value)}
                              placeholder={isRecaptchaVerified ? "Tell us a bit about yourself..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
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
                              placeholder={isRecaptchaVerified ? "Share your interests, profession..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
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
                              placeholder={isRecaptchaVerified ? "Describe your vision, special requirements..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
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
                              : error.type === "recaptcha"
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
                          disabled={!isRecaptchaVerified || isSubmitting || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
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
                            : ""}
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
        <Link href="/about" className="transition-colors hover:opacity-80 font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal" style={{ color: '#FFD700' }}>HUStory</Link>
        <Link href="/studio-gallery" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-start justify-start h-full gap-8 mb-0 lg:mb-0 pt-8 sm:pt-12 md:pt-16 px-6 sm:px-8 md:px-10">
            {/* Logo shown at top of menu on small screens */}
            <div className="mb-4">
              <div className="flex items-center justify-center w-[64px] h-[64px] rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
                <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={56} height={56} className="w-[56px] h-[56px]" />
              </div>
            </div>
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors hover:opacity-80 font-comfortaa" style={{ fontSize: '22px', fontWeight: '400', color: '#FFD700' }}>HUStory</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}