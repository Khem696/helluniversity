"use client"

import Link from "next/link"
import { useRef, useState, useEffect, useCallback } from "react"
import { Calendar as CalendarIcon, Menu, X, AlertCircle, RefreshCw, Clock, Loader2 } from "lucide-react"
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
import { TimePicker } from "@/components/ui/time-picker"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"

const STORAGE_KEY = "helluniversity_booking_form"
const DEBOUNCE_DELAY = 500 // milliseconds

// Helper function to format 24-hour time for storage (keep 24-hour format in database)
// Just ensures proper formatting: "12:00" -> "12:00", "9:5" -> "09:05"
function formatTimeForStorage(time24: string): string {
  if (!time24 || !time24.includes(':')) return ''
  
  const [hours, minutes] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  const mins = minutes || '00'
  
  if (isNaN(hour24)) return time24
  
  // Keep 24-hour format, just pad properly
  return `${hour24.toString().padStart(2, '0')}:${mins.padStart(2, '0')}`
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
  const [mounted, setMounted] = useState(false)
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
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set())
  const [unavailableTimeRanges, setUnavailableTimeRanges] = useState<Array<{
    date: string
    startTime: string | null
    endTime: string | null
    startDate: number
    endDate: number
  }>>([])
  const [bookingsEnabled, setBookingsEnabled] = useState<boolean>(true)
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date())

  // Ensure component is mounted (client-side only)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch booking enabled status and poll for changes
  useEffect(() => {
    async function fetchBookingStatus() {
      try {
        const response = await fetch(API_PATHS.settingsBookingEnabled)
        const json = await response.json()
        
        if (json.success && json.data) {
          const newStatus = json.data.enabled
          setBookingsEnabled(newStatus)
          
          // If bookings are disabled while dialog is open, close the dialog
          if (!newStatus && bookingOpen) {
            setBookingOpen(false)
            toast.error("Bookings are currently disabled. Please try again later.")
          }
        }
      } catch (error) {
        console.error("Failed to fetch booking status:", error)
        // Default to enabled on error
        setBookingsEnabled(true)
      }
    }

    if (mounted) {
      // Fetch immediately
      fetchBookingStatus()
      
      // Poll every 30 seconds to check for status changes
      const pollInterval = setInterval(fetchBookingStatus, 30000)
      
      return () => {
        clearInterval(pollInterval)
      }
    }
  }, [mounted, bookingOpen])

  // Fetch unavailable dates when booking dialog opens and refresh periodically
  useEffect(() => {
    if (bookingOpen && mounted) {
      const fetchUnavailableDates = () => {
        fetch(API_PATHS.bookingAvailability)
          .then((res) => res.json())
          .then((json) => {
              // Check both possible response structures
              const unavailableDatesArray = json.data?.unavailableDates || json.unavailableDates || []
              const unavailableTimeRangesArray = json.data?.unavailableTimeRanges || json.unavailableTimeRanges || []
              
              if (json.success) {
                const dates = new Set<string>(unavailableDatesArray)
                setUnavailableDates(dates)
                setUnavailableTimeRanges(unavailableTimeRangesArray)
                
                // Debug logging
                if (unavailableDatesArray.length > 0) {
                  console.log(`[Header] Unavailable dates fetched: ${unavailableDatesArray.length} dates`, unavailableDatesArray.slice(0, 10))
                } else {
                  console.log(`[Header] No unavailable dates found`)
                }
              } else {
                console.error("[Header] Failed to fetch unavailable dates:", json)
              }
          })
          .catch((err) => {
            console.error("Failed to fetch unavailable dates:", err)
          })
      }
      
      // Fetch immediately
      fetchUnavailableDates()
      
      // Refresh every 10 seconds while dialog is open to catch new check-ins
      const refreshInterval = setInterval(fetchUnavailableDates, 10000)
      
      return () => clearInterval(refreshInterval)
    }
  }, [bookingOpen, mounted])

  // Function to refresh unavailable dates (called on month navigation)
  const refreshUnavailableDates = () => {
    if (bookingOpen && mounted) {
      fetch("/api/v1/booking/availability")
        .then((res) => res.json())
        .then((json) => {
          const unavailableDatesArray = json.data?.unavailableDates || json.unavailableDates || []
          if (json.success) {
            const dates = new Set<string>(unavailableDatesArray)
            setUnavailableDates(dates)
            console.log(`[Header] Unavailable dates refreshed on month change: ${unavailableDatesArray.length} dates`)
          }
        })
        .catch((err) => {
          console.error("Failed to refresh unavailable dates:", err)
        })
    }
  }

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
          startDate: startDate ? dateToBangkokDateString(startDate) : null,
          endDate: endDate ? dateToBangkokDateString(endDate) : null,
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
    setFormData(prev => ({ ...prev, startDate: date ? dateToBangkokDateString(date) : null }))
    // Clear error when user selects a date
    if (error) {
      setError(null)
    }
  }

  const handleEndDateChange = (date: Date | undefined) => {
    // Validate that start date is selected first
    if (!startDate) {
      setError({
        type: "validation",
        message: "Please select a start date first before selecting an end date.",
        retryable: false
      })
      return
    }
    
    // Validate that end date is after start date when dateRange is true
    if (formData.dateRange && date && startDate) {
      const startDateStr = dateToBangkokDateString(startDate)
      const endDateStr = dateToBangkokDateString(date)
      
      if (endDateStr === startDateStr) {
        setError({
          type: "validation",
          message: "End date cannot be the same as start date. Please select a different end date.",
          retryable: false
        })
        return
      }
      
      if (date < startDate) {
        setError({
          type: "validation",
          message: "End date must be after start date. Please select a date after the start date.",
          retryable: false
        })
        return
      }
    }
    
    setEndDate(date)
    setFormData(prev => ({ ...prev, endDate: date ? dateToBangkokDateString(date) : null }))
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
    // Don't show error if form is submitting or modal is closing
    if (isSubmitting || !bookingOpen) {
      return
    }
    setRecaptchaToken(null)
    setIsRecaptchaVerified(false)
    setError({
      type: "recaptcha",
      message: "CAPTCHA verification failed. Please try again.",
      retryable: true
    })
  }

  function handleRecaptchaExpire() {
    // Don't show error if form is submitting or modal is closing
    // This prevents error messages after successful submission
    if (isSubmitting || !bookingOpen) {
      return
    }
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
    
    // Check if bookings are enabled before allowing submission
    if (!bookingsEnabled) {
      setError({
        type: "validation",
        message: "Bookings are currently disabled. Please try again later.",
        retryable: false
      })
      setBookingOpen(false)
      return
    }
    
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
    // Use Bangkok timezone for consistent date comparison
    if (formData.dateRange && startDate && endDate) {
      const startDateStr = dateToBangkokDateString(startDate)
      const endDateStr = dateToBangkokDateString(endDate)
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
    
    // Validate single day booking: end time must be after start time
    // For multiple day bookings, times are on different days so we don't compare them
    if (!formData.dateRange && formData.startTime && formData.endTime) {
      const parseTime = (time: string): number => {
        if (!time || !time.includes(':')) return 0
        const [hours, minutes] = time.split(':').map(Number)
        return (hours || 0) * 60 + (minutes || 0) // Convert to minutes for comparison
      }
      
      const startMinutes = parseTime(formData.startTime.trim())
      const endMinutes = parseTime(formData.endTime.trim())
      
      if (endMinutes <= startMinutes) {
        setError({
          type: "validation",
          message: "For single day bookings, the end time must be after the start time. Please select a later end time.",
          retryable: false
        })
        return
      }
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
    
    // Double-check bookings are still enabled right before API call
    // This prevents race conditions where status changes between form submission and API call
    try {
      const statusCheck = await fetch(API_PATHS.settingsBookingEnabled)
      const statusJson = await statusCheck.json()
      
      if (statusJson.success && statusJson.data && !statusJson.data.enabled) {
        setBookingsEnabled(false)
        setError({
          type: "validation",
          message: "Bookings are currently disabled. Please try again later.",
          retryable: false
        })
        setBookingOpen(false)
        return
      }
    } catch (statusError) {
      // If status check fails, proceed with submission (API will handle it)
      console.warn("Failed to verify booking status before submission:", statusError)
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
        startDate: startDate ? dateToBangkokDateString(startDate) : null,
        endDate: endDate ? dateToBangkokDateString(endDate) : null,
        startTime: formData.startTime ? formatTimeForStorage(formData.startTime.trim()) : null,
        endTime: formData.endTime ? formatTimeForStorage(formData.endTime.trim()) : null,
        organizationType: formData.organizationType,
        introduction: formData.introduction.trim(),
        biography: formData.biography.trim(),
        specialRequests: formData.specialRequests.trim(),
      }
      
      const response = await fetch(API_PATHS.booking, {
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
        // Clone response to check status before parsing
        const responseClone = response.clone()
        data = await response.json()
        
        // Debug: Log response in development
        if (process.env.NODE_ENV === 'development') {
          console.log('Booking API Response:', {
            status: response.status,
            ok: response.ok,
            success: data?.success,
            hasData: !!data?.data,
            hasError: !!data?.error,
            fullData: data
          })
        }
      } catch (jsonError) {
        // Try to get text for debugging
        try {
          const text = await response.clone().text()
          console.error('Failed to parse JSON response:', {
            error: jsonError,
            status: response.status,
            ok: response.ok,
            responseText: text.substring(0, 500)
          })
        } catch (textError) {
          console.error('Failed to parse response and get text:', jsonError, textError)
        }
        throw new Error("Server returned invalid response. Please try again.")
      }
      
      // Helper function to extract error message from API response
      const getErrorMessage = (error: any, defaultMsg: string): string => {
        if (!error) return defaultMsg
        if (typeof error === 'string') return error
        if (typeof error === 'object') {
          // Priority 1: Check for validation errors array in details (most specific)
          // This is the structure: error.details.errors = ['Error 1', 'Error 2', ...]
          if (error.details) {
            if (Array.isArray(error.details.errors) && error.details.errors.length > 0) {
              return error.details.errors.join('. ')
            }
            // Check if details itself is an object with errors
            if (typeof error.details === 'object' && Array.isArray(error.details.errors)) {
              return error.details.errors.join('. ')
            }
            // Check for string details
            if (typeof error.details === 'string') {
              return error.details
            }
          }
          // Priority 2: Check for errors array at root level
          if (Array.isArray(error.errors) && error.errors.length > 0) {
            return error.errors.join('. ')
          }
          // Priority 3: Use message property, but check for validation errors first
          if (error.message) {
            // For validation errors, always check details first
            if (error.message === 'Validation failed' || error.code === 'VALIDATION_ERROR') {
              if (error.details && Array.isArray(error.details.errors) && error.details.errors.length > 0) {
                return error.details.errors.join('. ')
              }
            }
            return error.message
          }
          // Fallback: try to stringify if it's an object
          return JSON.stringify(error)
        }
        return defaultMsg
      }
      
      if (!response.ok) {
        // Handle different HTTP error status codes
        if (response.status === 404) {
          // 404 likely means API route doesn't exist (static export mode)
          throw new Error("Reservation form is not available on this static site. Please contact us directly via email or phone.")
        } else if (response.status === 400) {
          // For 400 errors, show specific validation errors if available
          // Debug: Log the error structure to help diagnose issues
          if (process.env.NODE_ENV === 'development') {
            console.log('API Error Response (400):', JSON.stringify(data, null, 2))
          }
          const errorMsg = getErrorMessage(data.error, "Invalid request. Please check your input and try again.")
          throw new Error(errorMsg)
        } else if (response.status === 401 || response.status === 403) {
          throw new Error("Authentication failed. Please refresh the page and try again.")
        } else if (response.status === 429) {
          throw new Error("Too many requests. Please wait a moment and try again.")
        } else if (response.status >= 500) {
          throw new Error("Server error. Please try again in a few moments.")
        } else {
          throw new Error(getErrorMessage(data.error, `Request failed with status ${response.status}`))
        }
      }
      
      if (!data.success) {
        // Extract error message, prioritizing specific validation errors
        const errorMsg = getErrorMessage(data.error, "Failed to submit booking")
        throw new Error(errorMsg)
      }
      
      // Success - clear form data and localStorage
      toast.success("Reservation submitted successfully!", {
        description: "Thank you for your reservation request! We'll be in touch soon.",
        duration: 5000,
        className: "bg-white border border-gray-300 rounded-lg shadow-lg font-comfortaa",
        style: {
          backgroundColor: "#ffffff",
          borderColor: "#d1d5db",
          borderRadius: "0.5rem",
          padding: "clamp(0.75rem, 2vw, 1rem)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          maxWidth: "calc(100vw - 2rem)",
          width: "auto",
          minWidth: "280px",
          fontSize: "clamp(0.875rem, 2vw, 1rem)",
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
        className: "bg-red-600 border border-red-700 text-white rounded-lg shadow-lg font-comfortaa",
        style: {
          backgroundColor: "#dc2626",
          borderColor: "#b91c1c",
          color: "#ffffff",
          borderRadius: "0.5rem",
          padding: "clamp(0.75rem, 2vw, 1rem)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          maxWidth: "calc(100vw - 2rem)",
          width: "auto",
          minWidth: "280px",
          fontSize: "clamp(0.875rem, 2vw, 1rem)",
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
    <header ref={headerRef} className="main-site-header absolute top-0 left-0 right-0 z-50 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2 sm:py-3 md:py-4 lg:py-6 no-horiz-overflow">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-none mx-auto mb-0 lg:mb-0 min-w-0 relative">
        {/* Logo (hidden ≤425px) */}
        <Link href="/" prefetch={false} aria-label="Hell University Home" className="hidden lg:flex items-center justify-center ml-1 md:ml-0">
          <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 3xl:w-24 3xl:h-24 4xl:w-28 4xl:h-28 5xl:w-32 5xl:h-32 rounded-full bg-white border-2 lg:border-4 3xl:border-[6px] 4xl:border-8 border-[var(--hell-dusty-blue)]">
            <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={62} height={62} className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-16 lg:h-16 3xl:w-[4.5rem] 3xl:h-[4.5rem] 4xl:w-[5rem] 4xl:h-[5rem] 5xl:w-[6rem] 5xl:h-[6rem]" />
          </div>
        </Link>

        {/* Title - wraps on very small screens to avoid overlap; single line from phone and up */}
                <h1 className="flex-1 text-left font-heading font-black tracking-wide whitespace-normal lg:whitespace-nowrap lg:absolute lg:left-1/2 lg:-translate-x-1/2 lg:text-center max-w-[80vw] lg:max-w-none text-xl sm:text-2xl md:text-3xl lg:text-5xl 3xl:text-6xl 4xl:text-7xl 5xl:text-8xl">
          <span className="text-[var(--hell-dusty-blue)] font-urbanist font-extrabold leading-[1.2]">Hell</span>{' '}
          <span className="text-[#2a1f1a] font-urbanist font-extrabold leading-[1.2]">University</span>
        </h1>

        {/* Booking Button - Only show if bookings are enabled */}
        {mounted && bookingsEnabled && (
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
  
                      {/* Required Information */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.4vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Required Information</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="name" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Full Name *</Label>
                            <Input
                              id="name"
                              name="name"
                              type="text"
                              autoComplete="name"
                              required
                              value={formData.name || ""}
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
                              value={formData.email || ""}
                              onChange={(e) => handleInputChange("email", e.target.value)}
                              placeholder="your@email.com"
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label htmlFor="phone" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Phone Number *</Label>
                            <input
                              id="phone"
                              name="phone"
                              type="tel"
                              value={formData.phone || ""}
                              required
                              autoComplete="tel"
                              readOnly
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
                              aria-hidden="true"
                            />
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
                              value={formData.participants || ""}
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
                          <Label id="dateRange-label" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Date Selection *</Label>
                          <div className="flex gap-4" role="radiogroup" aria-labelledby="dateRange-label">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                id="dateRange-single"
                                name="dateRange"
                                value="single"
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
                                id="dateRange-range"
                                name="dateRange"
                                value="range"
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
                            <Label id="startDate-label" htmlFor="startDate" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>
                              {formData.dateRange ? "Start Date *" : "Date *"}
                            </Label>
                            <input
                              id="startDate"
                              name="startDate"
                              type="date"
                              value={startDate ? dateToBangkokDateString(startDate) : ""}
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
                                  type="button"
                                  variant="outline"
                                  disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                                  className={`w-full justify-start text-left font-normal font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`}
                                  style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                  aria-labelledby="startDate-label"
                                  aria-describedby="startDate"
                                >
                                  <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                  {startDate ? format(startDate, "PPP") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <SimpleCalendar
                                  selected={startDate}
                                  month={calendarMonth}
                                  onMonthChange={(date) => {
                                    setCalendarMonth(date)
                                    // Refresh unavailable dates when month changes
                                    refreshUnavailableDates()
                                  }}
                                  onSelect={handleStartDateChange}
                                  disabled={(date) => {
                                    // Disable past dates and today (users cannot book current date)
                                    // Use Bangkok timezone for date comparison to ensure consistent behavior
                                    // regardless of user's browser timezone
                                    const todayStr = dateToBangkokDateString(new Date())
                                    const dateStr = dateToBangkokDateString(date)
                                    if (dateStr < todayStr) return true  // Disable past dates (Bangkok timezone)
                                    if (todayStr === dateStr) return true  // Disable today
                                    if (!isRecaptchaVerified) return true
                                    if (process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1') return true
                                    // Check if date is unavailable (has confirmed booking)
                                    // Convert date to Bangkok timezone for proper comparison
                                    const isUnavailable = unavailableDates.has(dateStr)
                                    if (isUnavailable) {
                                      console.log(`[Header] Date ${dateStr} is unavailable (blocked by confirmed booking)`)
                                    }
                                    return isUnavailable
                                  }}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* End Date (only shown for date range) */}
                          {formData.dateRange && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                              <Label id="endDate-label" htmlFor="endDate" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>End Date *</Label>
                              <input
                                id="endDate"
                                name="endDate"
                                type="date"
                                value={endDate ? dateToBangkokDateString(endDate) : ""}
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
                                    type="button"
                                    variant="outline"
                                    disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1' || !startDate}
                                    className={`w-full justify-start text-left font-normal font-comfortaa ${!isRecaptchaVerified || !startDate ? "opacity-50 cursor-not-allowed" : ""}`}
                                    style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                    aria-labelledby="endDate-label"
                                    aria-describedby="endDate"
                                    title={!startDate ? "Please select a start date first" : ""}
                                  >
                                    <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                    {endDate ? format(endDate, "PPP") : !startDate ? "Select start date first" : "Pick end date"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <SimpleCalendar
                                    selected={endDate}
                                    month={calendarMonth}
                                    onMonthChange={(date) => {
                                      setCalendarMonth(date)
                                      // Refresh unavailable dates when month changes
                                      refreshUnavailableDates()
                                    }}
                                    onSelect={handleEndDateChange}
                                    disabled={(date) => {
                                      if (!isRecaptchaVerified) return true
                                      if (process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1') return true
                                      // Use Bangkok timezone for date comparison to ensure consistent behavior
                                      // regardless of user's browser timezone
                                      const todayStr = dateToBangkokDateString(new Date())
                                      const dateStr = dateToBangkokDateString(date)
                                      if (dateStr < todayStr) return true  // Disable past dates (Bangkok timezone)
                                      if (startDate) {
                                        const startDateStr = dateToBangkokDateString(startDate)
                                        // Disable if date is before start date OR same as start date
                                        if (dateStr < startDateStr || startDateStr === dateStr) return true
                                      }
                                      // Check if date is unavailable (has confirmed booking)
                                      // Convert date to Bangkok timezone for proper comparison
                                      const isUnavailable = unavailableDates.has(dateStr)
                                      if (isUnavailable) {
                                        console.log(`[Header] End date ${dateStr} is unavailable (blocked by confirmed booking)`)
                                      }
                                      return isUnavailable
                                    }}
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          )}

                          {/* Start Time */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label id="startTime-label" htmlFor="startTime" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Start Time *</Label>
                            <TimePicker
                              id="startTime"
                              name="startTime"
                              value={formData.startTime || ""}
                              onChange={(value) => handleInputChange("startTime", value)}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              required
                              className={!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}
                            />
                          </div>

                          {/* End Time */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label id="endTime-label" htmlFor="endTime" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>End Time *</Label>
                            <TimePicker
                              id="endTime"
                              name="endTime"
                              value={formData.endTime || ""}
                              onChange={(value) => handleInputChange("endTime", value)}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              required
                              className={!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}
                            />
                          </div>

                          {/* Event Type */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)', position: 'relative' }}>
                            <Label id="eventType-label" htmlFor="eventType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Event Type *</Label>
                            <select
                              id="eventType"
                              name="eventType"
                              value={formData.eventType || ""}
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
                              aria-labelledby="eventType-label"
                            >
                              <option value="">Select event type</option>
                              <option value="Arts & Design Coaching">Arts & Design Coaching Workshop</option>
                              <option value="Seminar & Workshop">Seminar & Workshop</option>
                              <option value="Family Gathering">Family Gathering</option>
                              <option value="Holiday Festive">Holiday Festive</option>
                              <option value="Other">Other</option>
                            </select>
                            <Select value={formData.eventType || ""} onValueChange={(value) => handleInputChange("eventType", value)} disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}>
                              <SelectTrigger 
                                id="eventType-visual" 
                                aria-labelledby="eventType-label" 
                                aria-describedby="eventType"
                                className={`font-comfortaa ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed" : ""}`} 
                                style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                              >
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
                              value={formData.otherEventType || ""}
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
                          <Label id="organizationType-label" htmlFor="organizationType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Organization *</Label>
                          <RadioGroup
                            id="organizationType"
                            name="organizationType"
                            value={formData.organizationType || ""}
                            onValueChange={(value) => handleInputChange("organizationType", value)}
                            disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                            className="flex flex-row gap-6"
                            aria-labelledby="organizationType-label"
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
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Tailor Your Reservation</h4>
                        <div className="space-y-1 sm:space-y-1.5 lg:space-y-1">
                          <div className="space-y-1">
                            <Label htmlFor="introduction" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Brief Your Desire *</Label>
                            <Textarea
                              id="introduction"
                              name="introduction"
                              autoComplete="off"
                              required
                              value={formData.introduction || ""}
                              onChange={(e) => handleInputChange("introduction", e.target.value)}
                              placeholder={isRecaptchaVerified ? "Tell us what you desire..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isRecaptchaVerified || process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isRecaptchaVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="specialRequests" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Special Requirements</Label>
                            <Textarea
                              id="specialRequests"
                              name="specialRequests"
                              autoComplete="off"
                              value={formData.specialRequests || ""}
                              onChange={(e) => handleInputChange("specialRequests", e.target.value)}
                              placeholder={isRecaptchaVerified ? "Describe any special requirements..." : "Please complete CAPTCHA verification first..."}
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
                          className="font-comfortaa bg-[#5B9AB8] hover:bg-[#4d8ea7] text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          style={{ 
                            padding: 'clamp(0.5rem, 0.6vw, 0.75rem) clamp(1rem, 1.2vw, 1.5rem)',
                            fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)'
                          }}
                        >
                          {process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1' 
                            ? "Form Unavailable" 
                            : isSubmitting 
                            ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Submitting...</span>
                              </>
                            )
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
        )}

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
        <Link href="/" prefetch={false} className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Home</Link>
        <Link href="/about" prefetch={false} className="transition-colors hover:opacity-80 font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal" style={{ color: '#FFD700' }}>HUStory</Link>
        <Link href="/studio-gallery" prefetch={false} className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Studio/Gallery</Link>
        <Link href="/contact" prefetch={false} className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Contact</Link>
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
            <Link href="/" prefetch={false} onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" prefetch={false} onClick={() => setMobileMenuOpen(false)} className="transition-colors hover:opacity-80 font-comfortaa" style={{ fontSize: '22px', fontWeight: '400', color: '#FFD700' }}>HUStory</Link>
            <Link href="/studio-gallery" prefetch={false} onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" prefetch={false} onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}