"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Calendar, X, Check, MessageSquare, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { TimePicker } from "@/components/ui/time-picker"
import { dateToBangkokDateString } from "@/lib/timezone-client"

// Parse 24-hour time string from user_response (HH:MM format)
// Returns 24-hour format string or null
function parseTimeFromResponse(timeString: string): string | null {
  if (!timeString) return null
  const trimmed = timeString.trim()
  
  // Parse 24-hour format (HH:MM)
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (match) {
    const hours = parseInt(match[1], 10)
    const minutes = match[2] || '00'
    if (hours >= 0 && hours <= 23 && parseInt(minutes) >= 0 && parseInt(minutes) <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes}`
    }
  }
  
  return null
}

// Helper function to add AM/PM to 24-hour time format for display
// Converts "13:00" -> "13:00 PM", "09:30" -> "09:30 AM", "00:00" -> "00:00 AM"
function formatTimeForDisplay(time24: string | null | undefined): string {
  if (!time24 || !time24.includes(':')) return time24 || ''
  
  try {
    const [hours, minutes] = time24.split(':')
    const hour24 = parseInt(hours, 10)
    const mins = minutes || '00'
    
    if (isNaN(hour24)) return time24
    
    // Keep 24-hour format, just add AM/PM
    const period = hour24 < 12 ? 'AM' : 'PM'
    return `${time24} ${period}`
  } catch (error) {
    return time24
  }
}

interface BookingData {
  id: string
  name: string
  email: string
  eventType: string
  otherEventType?: string
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  status: string
  proposedDate?: string | null
  proposedEndDate?: string | null
  userResponse?: string
  depositEvidenceUrl?: string | null
}

export default function BookingResponsePage() {
  const params = useParams()
  const router = useRouter()
  const token = params?.token as string

  const [booking, setBooking] = useState<BookingData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [response, setResponse] = useState<"accept" | "propose" | "cancel" | null>(null)
  const [proposedDate, setProposedDate] = useState<Date | null>(null)
  const [proposedEndDate, setProposedEndDate] = useState<Date | null>(null)
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [proposedStartTime, setProposedStartTime] = useState("09:00") // 24-hour format for TimePicker
  const [proposedEndTime, setProposedEndTime] = useState("17:00") // 24-hour format for TimePicker
  const [message, setMessage] = useState("")
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set())

  // Fetch unavailable dates on mount
  // This includes checked-in bookings and postponed bookings with deposit_verified_at
  // (original dates of postponed bookings remain blocked until admin accepts new date)
  // EXCEPTION: Excludes current booking's dates so user can select their own original dates
  useEffect(() => {
    if (!booking?.id) return // Wait for booking to load
    
    const url = booking.id 
      ? `/api/booking/availability?bookingId=${encodeURIComponent(booking.id)}`
      : "/api/booking/availability"
    
    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          const unavailableDatesArray = json.data?.unavailableDates || json.unavailableDates || []
          setUnavailableDates(new Set(unavailableDatesArray))
          
          // Debug logging
          if (unavailableDatesArray.length > 0) {
            console.log(`[BookingResponse] Unavailable dates fetched (excluding booking ${booking.id}): ${unavailableDatesArray.length} dates`, unavailableDatesArray.slice(0, 10))
          } else {
            console.log(`[BookingResponse] No unavailable dates found (excluding booking ${booking.id})`)
          }
        }
      })
      .catch((err) => {
        console.error("Failed to fetch unavailable dates:", err)
      })
  }, [booking?.id])

  useEffect(() => {
    if (!token) {
      // Fix #12: Better error message for missing token
      setError("Invalid or missing token. Please contact the administrator if you need a new response link.")
      setIsLoading(false)
      return
    }

    async function fetchBooking() {
      try {
        const response = await fetch(`/api/booking/response/${token}`)
        const json = await response.json()
        
        if (!response.ok || !json.success) {
          // Fix #12: Better error message for token expiration
          const errorMessage = json.error?.message || json.error || "Failed to fetch booking details"
          if (errorMessage.includes("expired") || errorMessage.includes("Invalid")) {
            throw new Error(errorMessage || "This response link has expired. Please contact the administrator to request a new link.")
          }
          throw new Error(errorMessage)
        }

        // Check if booking data exists (API wraps data in json.data.booking)
        const booking = json.data?.booking || json.booking
        if (booking) {
          setBooking(booking)
          // Pre-fill proposed date if available
          if (booking.proposedDate) {
            setProposedDate(new Date(booking.proposedDate))
          }
          // Pre-fill proposed end date if available (multiple days)
          if (booking.proposedEndDate) {
            setProposedEndDate(new Date(booking.proposedEndDate))
            setProposedDateRange("multiple")
          }
                // Parse times from user_response if available (24-hour format)
                if (booking.userResponse) {
                  const timeMatch = booking.userResponse.match(/Start Time: ([^,)]+)/)
                  if (timeMatch) {
                    const time24 = parseTimeFromResponse(timeMatch[1].trim())
                    if (time24) setProposedStartTime(time24)
                  }
                  const endTimeMatch = booking.userResponse.match(/End Time: ([^,)]+)/)
                  if (endTimeMatch) {
                    const time24 = parseTimeFromResponse(endTimeMatch[1].trim())
                    if (time24) setProposedEndTime(time24)
                  }
                }
        } else {
          throw new Error("Booking not found")
        }
      } catch (err) {
        console.error("Error fetching booking:", err)
        // Fix #12: Better error message
        const errorMessage = err instanceof Error ? err.message : "Failed to load booking"
        setError(errorMessage.includes("expired") || errorMessage.includes("Invalid") 
          ? errorMessage 
          : "This response link is invalid or expired. Please contact the administrator to request a new link.")
      } finally {
        setIsLoading(false)
      }
    }

    fetchBooking()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!response) {
      setError("Please select a response option")
      return
    }

    if (response === "propose" && !proposedDate) {
      setError("Please select a proposed start date")
      return
    }
    
    if (response === "propose" && proposedDateRange === "multiple" && !proposedEndDate) {
      setError("Please select a proposed end date for multiple day reservation")
      return
    }
    
    // Validate that start date is selected first for multiple day proposals
    if (response === "propose" && proposedDateRange === "multiple" && !proposedDate) {
      setError("Please select a proposed start date first before selecting an end date")
      return
    }
    
    // Validate that end date is after start date
    if (response === "propose" && proposedDateRange === "multiple" && proposedEndDate && proposedDate) {
      const startDateStr = dateToBangkokDateString(proposedDate)
      const endDateStr = dateToBangkokDateString(proposedEndDate)
      
      if (endDateStr === startDateStr) {
        setError("End date cannot be the same as start date. Please select a different end date.")
        return
      }
      
      if (proposedEndDate < proposedDate) {
        setError("End date must be after start date. Please select a date after the start date.")
        return
      }
    }
    
    // Validate single day proposed date: end time must be after start time
    if (response === "propose" && proposedDateRange === "single" && proposedStartTime && proposedEndTime) {
      const parseTime = (time: string): number => {
        if (!time || !time.includes(':')) return 0
        const [hours, minutes] = time.split(':').map(Number)
        return (hours || 0) * 60 + (minutes || 0) // Convert to minutes for comparison
      }
      
      const startMinutes = parseTime(proposedStartTime)
      const endMinutes = parseTime(proposedEndTime)
      
      if (endMinutes <= startMinutes) {
        setError("For single day bookings, the end time must be after the start time.")
        return
      }
    }
    
    // Frontend validation using GMT+7 timezone (matches backend validation)
    if (response === "propose" && proposedDate && booking) {
      const { validateProposedDateFrontend } = await import("@/lib/timezone-client")
      const originalStartDate = booking.start_date ? Math.floor(new Date(booking.start_date).getTime() / 1000) : undefined
      
      // Use dateToBangkokDateString to ensure consistent timezone handling
      // toISOString() converts to UTC which can cause timezone issues
      const proposedDateStr = dateToBangkokDateString(proposedDate)
      const proposedEndDateStr = proposedDateRange === "multiple" && proposedEndDate 
        ? dateToBangkokDateString(proposedEndDate) 
        : null
      
      const validation = validateProposedDateFrontend(
        proposedDateStr,
        proposedEndDateStr,
        originalStartDate
      )
      
      if (!validation.valid) {
        setError(validation.reason || "Invalid proposed date. All dates use GMT+7 (Bangkok time).")
        return
      }
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const responseData = await fetch(`/api/booking/response/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response,
          // Extract date in Bangkok timezone to avoid timezone conversion issues
          proposedDate: proposedDate ? dateToBangkokDateString(proposedDate) : undefined,
          proposedEndDate: proposedDateRange === "multiple" && proposedEndDate ? dateToBangkokDateString(proposedEndDate) : undefined,
              proposedStartTime: proposedStartTime || undefined,
              proposedEndTime: proposedEndTime || undefined,
          message: message.trim() || undefined,
        }),
      })

      const json = await responseData.json()

      if (json.success) {
        setSubmitSuccess(true)
        // Redirect after 3 seconds
        setTimeout(() => {
          router.push("/")
        }, 3000)
      } else {
        // Parse backend error for better user experience
        const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
        // Extract error message from API response structure
        const errorMessage = json.error?.message || json.error || "Failed to submit response"
        const parsedError = parseBackendError(errorMessage, responseData)
        throw new Error(getErrorMessageWithGuidance(parsedError))
      }
    } catch (err) {
      console.error("Error submitting response:", err)
      // Parse error for better display
      const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
      const parsedError = parseBackendError(err instanceof Error ? err : new Error(String(err)))
      const errorMessage = getErrorMessageWithGuidance(parsedError)
      setError(errorMessage)
      
      // Highlight invalid fields if validation error
      if (parsedError.type === 'validation' && parsedError.details?.field) {
        // Field highlighting can be added here if needed
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatEventType = (type: string, other?: string): string => {
    const types: Record<string, string> = {
      reunion: "Reunion",
      "family-friends": "Family & Friends",
      "baby-shower": "Baby Shower",
      engagement: "Engagement",
      "art-workshop": "Art Workshop",
      "painting-workshop": "Painting Workshop",
      "ceramics-workshop": "Ceramics Workshop",
      "brainstorming-session": "Brainstorming Session",
      other: "Other",
    }
    const baseType = types[type] || type
    return other && other.trim() ? `${baseType} - ${other}` : baseType
  }

  const formatDateRange = (start: string, end?: string): string => {
    const startDate = new Date(start)
    const endDate = end ? new Date(end) : null

    if (endDate && endDate.getTime() !== startDate.getTime()) {
      return `${format(startDate, "MMMM d, yyyy")} - ${format(endDate, "MMMM d, yyyy")}`
    }
    return format(startDate, "MMMM d, yyyy")
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center">
          <p className="text-white font-comfortaa text-[clamp(16px,2vw,20px)]">
            Loading booking details...
          </p>
        </div>
      </div>
    )
  }

  if (error && !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 sm:w-16 sm:h-16 text-white/80 mx-auto mb-4" />
          <h1 className="text-white font-urbanist text-[clamp(24px,4vw,32px)] font-extrabold mb-4">
            Invalid or Expired Link
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] mb-6">
            {error}
          </p>
          <Button
            onClick={() => router.push("/")}
            className="bg-white text-[#3e82bb] hover:bg-white/90 font-comfortaa"
          >
            Return to Home
          </Button>
        </div>
      </div>
    )
  }

  if (submitSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center max-w-md">
          <Check className="w-12 h-12 sm:w-16 sm:h-16 text-white mx-auto mb-4" />
          <h1 className="text-white font-urbanist text-[clamp(24px,4vw,32px)] font-extrabold mb-4">
            Response Submitted
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] mb-6">
            Thank you for your response. We will review it and get back to you soon.
          </p>
          <p className="text-white/70 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
            Redirecting to home page...
          </p>
        </div>
      </div>
    )
  }

  if (!booking) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#3e82bb] to-[#2a5f8f] p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-white font-urbanist text-[clamp(28px,5vw,40px)] lg:text-[clamp(32px,5.5vw,48px)] font-extrabold leading-[1.2] mb-2 sm:mb-3">
            Reservation Response
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)]">
            Please review your reservation and respond below
          </p>
        </div>

        {/* Booking Details Card */}
        <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8">
          <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
            Reservation Details
          </h2>

          <div className="space-y-3 sm:space-y-4">
            <div>
              <Label className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold">
                Event Type
              </Label>
              <p className="text-[#5a3a2a] font-comfortaa text-[clamp(14px,1.5vw,16px)] mt-1">
                {formatEventType(booking.eventType, booking.otherEventType)}
              </p>
            </div>

            <div>
              <Label className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold">
                Date & Time
              </Label>
              <p className="text-[#5a3a2a] font-comfortaa text-[clamp(14px,1.5vw,16px)] mt-1">
                {formatDateRange(booking.startDate, booking.endDate || undefined)}
                {booking.startTime && (
                  <span className="ml-2">
                    {formatTimeForDisplay(booking.startTime)}
                    {booking.endTime && ` - ${formatTimeForDisplay(booking.endTime)}`}
                  </span>
                )}
              </p>
            </div>

            {booking.status === "postponed" && booking.proposedDate && (
              <div className="bg-[#fef3c7] border-l-4 border-[#f59e0b] p-3 sm:p-4 rounded">
                <Label className="text-[#92400e] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4" />
                  Date Change Comparison
                </Label>
                <div className="space-y-2">
                  <div>
                    <p className="text-[#92400e] font-comfortaa text-[clamp(11px,1.1vw,13px)] font-semibold">
                      Original Date:
                    </p>
                    <p className="text-[#78350f] font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                      {formatDateRange(booking.startDate, booking.endDate || undefined)}
                      {booking.startTime && (
                        <span className="ml-2">
                          {formatTimeForDisplay(booking.startTime)}
                          {booking.endTime && ` - ${formatTimeForDisplay(booking.endTime)}`}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="border-t border-[#f59e0b]/30 pt-2">
                    <p className="text-[#92400e] font-comfortaa text-[clamp(11px,1.1vw,13px)] font-semibold">
                      Proposed New Date{booking.proposedEndDate && booking.proposedEndDate !== booking.proposedDate ? "s" : ""}:
                    </p>
                    <p className="text-[#78350f] font-comfortaa text-[clamp(13px,1.3vw,15px)] font-medium">
                      {booking.proposedEndDate && booking.proposedEndDate !== booking.proposedDate
                        ? `${format(new Date(booking.proposedDate), "EEEE, MMMM d, yyyy")} - ${format(new Date(booking.proposedEndDate), "EEEE, MMMM d, yyyy")}`
                        : format(new Date(booking.proposedDate), "EEEE, MMMM d, yyyy")}
                    </p>
                    {/* Parse and display times from user_response */}
                    {booking.userResponse && (() => {
                      const startTimeMatch = booking.userResponse.match(/Start Time: ([^,)]+)/)
                      const endTimeMatch = booking.userResponse.match(/End Time: ([^,)]+)/)
                      if (startTimeMatch || endTimeMatch) {
                        const startTime = startTimeMatch ? parseTimeFromResponse(startTimeMatch[1].trim()) : null
                        const endTime = endTimeMatch ? parseTimeFromResponse(endTimeMatch[1].trim()) : null
                        return (
                          <p className="text-[#78350f] font-comfortaa text-[clamp(12px,1.2vw,14px)] mt-1">
                            {startTime && endTime 
                              ? `Time: ${formatTimeForDisplay(startTime)} - ${formatTimeForDisplay(endTime)}`
                              : startTime 
                                ? `Time: ${formatTimeForDisplay(startTime)}`
                                : endTime 
                                  ? `Time: ${formatTimeForDisplay(endTime)}`
                                  : null}
                          </p>
                        )
                      }
                      return null
                    })()}
                  </div>
                </div>
              </div>
            )}
            {booking.status === "postponed" && !booking.proposedDate && (
              <div className="bg-[#fee2e2] border-l-4 border-[#ef4444] p-3 sm:p-4 rounded">
                <Label className="text-[#991b1b] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  Action Required
                </Label>
                <p className="text-[#991b1b] font-comfortaa text-[clamp(13px,1.3vw,15px)] font-medium mb-2">
                  Your original reservation date:
                </p>
                <p className="text-[#b91c1c] font-comfortaa text-[clamp(14px,1.5vw,16px)] font-semibold mb-3">
                  {formatDateRange(booking.startDate, booking.endDate || undefined)}
                  {booking.startTime && (
                    <span className="ml-2">
                      {formatTimeForDisplay(booking.startTime)}
                      {booking.endTime && ` - ${formatTimeForDisplay(booking.endTime)}`}
                    </span>
                  )}
                </p>
                <p className="text-[#991b1b] font-comfortaa text-[clamp(12px,1.2vw,14px)]">
                  Please propose an alternative date or cancel your reservation below.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Deposit Upload Section for Accepted Status */}
        {booking.status === "accepted" && (
          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8">
            <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
              Upload Deposit Evidence
            </h2>
            <div className="bg-green-50 border border-green-200 rounded p-4 mb-4">
              <p className="text-green-800 font-comfortaa text-[clamp(13px,1.3vw,15px)] mb-2">
                Your reservation has been accepted! Please upload your deposit evidence to complete the booking process.
              </p>
              <p className="text-green-700 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
                The deposit must be uploaded before the reservation start date and time.
              </p>
            </div>
            <a
              href={`/booking/deposit/${token}`}
              className="inline-block w-full sm:w-auto"
            >
              <Button
                type="button"
                className="w-full sm:w-auto bg-[#10b981] hover:bg-[#10b981]/90 text-white font-comfortaa"
              >
                Upload Deposit Evidence
              </Button>
            </a>
          </div>
        )}

        {/* Deposit Verification Pending for Paid Deposit Status */}
        {booking.status === "paid_deposit" && (
          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8">
            <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
              Deposit Verification Pending
            </h2>
            <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-4">
              <p className="text-purple-800 font-comfortaa text-[clamp(13px,1.3vw,15px)] mb-2">
                ✓ Your deposit evidence has been successfully uploaded!
              </p>
              <p className="text-purple-700 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
                Our admin team is currently reviewing your deposit evidence. Once verified and your check-in is confirmed, you will receive an email with access to your reservation management page.
              </p>
              <p className="text-purple-600 font-comfortaa text-[clamp(11px,1.1vw,13px)] mt-2">
                Please wait for our team to complete the verification process.
              </p>
            </div>
            {booking.depositEvidenceUrl && (
              <div className="mt-4">
                <a
                  href={booking.depositEvidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block w-full sm:w-auto"
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto border-purple-300 text-purple-700 hover:bg-purple-50 font-comfortaa"
                  >
                    View Uploaded Evidence
                  </Button>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Response Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8">
          <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
            Your Response
          </h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 sm:p-4 rounded mb-4 sm:mb-6">
              <p className="font-comfortaa text-[clamp(13px,1.3vw,15px)]">{error}</p>
            </div>
          )}

          {/* Response Options */}
          <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
            {/* Show accept option for postponed with proposed date */}
            {booking.status === "postponed" && booking.proposedDate ? (
              <button
                type="button"
                onClick={() => {
                  setResponse("accept")
                  setError(null)
                }}
                className={`w-full p-4 sm:p-5 rounded-lg border-2 transition-all text-left ${
                  response === "accept"
                    ? "border-[#10b981] bg-[#10b981]/10"
                    : "border-gray-200 hover:border-[#10b981]/50"
                }`}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div
                    className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      response === "accept"
                        ? "border-[#10b981] bg-[#10b981]"
                        : "border-gray-300"
                    }`}
                  >
                    {response === "accept" && (
                      <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-[#5a3a2a] font-urbanist text-[clamp(16px,2vw,20px)] font-extrabold mb-1">
                      Accept Proposed Date
                    </h3>
                    <p className="text-[#5a3a2a]/70 font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                      I accept the proposed new date for my reservation
                    </p>
                  </div>
                </div>
              </button>
            ) : null}

            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                setResponse("propose")
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  setResponse("propose")
                  setError(null)
                }
              }}
              className={`w-full p-4 sm:p-5 rounded-lg border-2 transition-all text-left cursor-pointer ${
                response === "propose"
                  ? "border-[#f59e0b] bg-[#f59e0b]/10"
                  : "border-gray-200 hover:border-[#f59e0b]/50"
              }`}
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    response === "propose"
                      ? "border-[#f59e0b] bg-[#f59e0b]"
                      : "border-gray-300"
                  }`}
                >
                  {response === "propose" && (
                    <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-[#5a3a2a] font-urbanist text-[clamp(16px,2vw,20px)] font-extrabold mb-1">
                    Propose Alternative Date
                  </h3>
                  <p className="text-[#5a3a2a]/70 font-comfortaa text-[clamp(13px,1.3vw,15px)] mb-3 sm:mb-4">
                    I would like to suggest a different date
                  </p>
                  {response === "propose" && (
                    <div className="space-y-3 sm:space-y-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-[#5a3a2a]">Date Range:</label>
                        <select
                          value={proposedDateRange}
                          onChange={(e) => {
                            setProposedDateRange(e.target.value as "single" | "multiple")
                            if (e.target.value === "single") {
                              setProposedEndDate(null)
                            }
                            setError(null)
                          }}
                          className="px-2 py-1 border rounded text-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="single">Single Day</option>
                          <option value="multiple">Multiple Days</option>
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              className="font-comfortaa text-[clamp(13px,1.3vw,15px)]"
                            >
                              <Calendar className="mr-2 w-4 h-4" />
                              {proposedDate
                                ? format(proposedDate, "MMMM d, yyyy")
                                : "Select Start Date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <SimpleCalendar
                              selected={proposedDate || undefined}
                              onSelect={(date) => {
                                setProposedDate(date || null)
                                if (proposedDateRange === "multiple" && proposedEndDate && date && date > proposedEndDate) {
                                  setProposedEndDate(null)
                                }
                                setError(null)
                              }}
                              disabled={(date) => {
                                // Disable past dates and today (users cannot propose current date)
                                if (date < new Date()) return true
                                // Check if date is today in Bangkok timezone
                                const todayStr = dateToBangkokDateString(new Date())
                                const dateStr = dateToBangkokDateString(date)
                                if (todayStr === dateStr) return true
                                // Check if date is unavailable (has checked-in booking or postponed booking with deposit_verified_at)
                                const isUnavailable = unavailableDates.has(dateStr)
                                if (isUnavailable) {
                                  console.log(`[BookingResponse] Proposed start date ${dateStr} is unavailable (blocked by booking)`)
                                }
                                return isUnavailable
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        {proposedDateRange === "multiple" && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="font-comfortaa text-[clamp(13px,1.3vw,15px)]"
                                disabled={!proposedDate}
                                title={!proposedDate ? "Please select a start date first" : ""}
                              >
                                <Calendar className="mr-2 w-4 h-4" />
                                {proposedEndDate
                                  ? format(proposedEndDate, "MMMM d, yyyy")
                                  : !proposedDate
                                  ? "Select start date first"
                                  : "Select End Date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <SimpleCalendar
                                selected={proposedEndDate || undefined}
                                onSelect={(date) => {
                                  setProposedEndDate(date || null)
                                  setError(null)
                                }}
                                disabled={(date) => {
                                  // Disable if start date is not selected
                                  if (!proposedDate) return true
                                  // Disable past dates and today
                                  if (date < new Date()) return true
                                  const todayStr = dateToBangkokDateString(new Date())
                                  const dateStr = dateToBangkokDateString(date)
                                  if (todayStr === dateStr) return true
                                  // Disable if date is before or equal to start date
                                  if (proposedDate && (date < proposedDate || dateToBangkokDateString(proposedDate) === dateStr)) return true
                                  // Check if date is unavailable (has checked-in booking or postponed booking with deposit_verified_at)
                                  const isUnavailable = unavailableDates.has(dateStr)
                                  if (isUnavailable) {
                                    console.log(`[BookingResponse] Proposed end date ${dateStr} is unavailable (blocked by booking)`)
                                  }
                                  return isUnavailable
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                      {response === "propose" && (
                        <div className="space-y-3 sm:space-y-4 mt-4" onClick={(e) => e.stopPropagation()}>
                          <div>
                            <Label htmlFor="proposed_start_time" className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold">
                              Proposed Start Time
                            </Label>
                            <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                              <TimePicker
                                id="proposed_start_time"
                                name="proposed_start_time"
                                value={proposedStartTime}
                                onChange={(value) => {
                                  setProposedStartTime(value)
                                  setError(null)
                                }}
                                disabled={isSubmitting}
                                required
                                className="w-full"
                              />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="proposed_end_time" className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold">
                              Proposed End Time
                            </Label>
                            <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                              <TimePicker
                                id="proposed_end_time"
                                name="proposed_end_time"
                                value={proposedEndTime}
                                onChange={(value) => {
                                  setProposedEndTime(value)
                                  setError(null)
                                }}
                                disabled={isSubmitting}
                                required
                                className="w-full"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setResponse("cancel")
                setError(null)
              }}
              className={`w-full p-4 sm:p-5 rounded-lg border-2 transition-all text-left ${
                response === "cancel"
                  ? "border-red-500 bg-red-50"
                  : "border-gray-200 hover:border-red-500/50"
              }`}
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    response === "cancel"
                      ? "border-red-500 bg-red-500"
                      : "border-gray-300"
                  }`}
                >
                  {response === "cancel" && (
                    <X className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                  )}
                </div>
                <div>
                  <h3 className="text-[#5a3a2a] font-urbanist text-[clamp(16px,2vw,20px)] font-extrabold mb-1">
                    Cancel Reservation
                  </h3>
                  <p className="text-[#5a3a2a]/70 font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                    I would like to cancel my reservation
                  </p>
                </div>
              </div>
            </button>
          </div>

          {/* Optional Message */}
          <div className="mb-4 sm:mb-6">
            <Label
              htmlFor="message"
              className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold flex items-center gap-2 mb-2"
            >
              <MessageSquare className="w-4 h-4" />
              Additional Message (Optional)
            </Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add any additional comments or requests..."
              className="font-comfortaa text-[clamp(13px,1.3vw,15px)] min-h-[100px] sm:min-h-[120px] resize-y"
              rows={4}
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting || !response || (response === "propose" && (!proposedDate || (proposedDateRange === "multiple" && !proposedEndDate)))}
            className="w-full sm:w-auto bg-[#3e82bb] hover:bg-[#2a5f8f] text-white font-comfortaa text-[clamp(14px,1.5vw,16px)] font-semibold px-6 sm:px-8 py-2 sm:py-3"
          >
            {isSubmitting ? "Submitting..." : "Submit Response"}
          </Button>
        </form>

        {/* Footer Note */}
        <div className="text-center mt-6 sm:mt-8">
          <p className="text-white/80 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
            If you have any questions, please contact us directly
          </p>
        </div>
      </div>
    </div>
  )
}

