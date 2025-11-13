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
  // User can only cancel bookings now - no propose date functionality
  const [response, setResponse] = useState<"cancel" | null>(null)
  const [message, setMessage] = useState("")
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set())

  // Fetch unavailable dates on mount
  // This includes confirmed bookings
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
          // No propose date functionality in new flow
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

    // Only cancel is available in new flow - no propose date functionality

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
          // No propose date functionality in new flow
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

          </div>
        </div>

        {/* Deposit Upload Section for Pending Deposit Status */}
        {booking.status === "pending_deposit" && !booking.depositEvidenceUrl && (
          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8">
            <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
              Upload Deposit Evidence
            </h2>
            <div className="bg-green-50 border border-green-200 rounded p-4 mb-4">
              <p className="text-green-800 font-comfortaa text-[clamp(13px,1.3vw,15px)] mb-2">
                Your reservation has been accepted! Please upload your deposit evidence to complete the booking process.
              </p>
              <p className="text-green-700 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
                Please send a deposit evidence before start date. The deposit must be uploaded before the reservation start date and time.
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

        {/* Deposit Verification Pending for Pending Deposit Status with Evidence */}
        {booking.status === "pending_deposit" && booking.depositEvidenceUrl && (
          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8">
            <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
              Deposit Verification Pending
            </h2>
            <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-4">
              <p className="text-purple-800 font-comfortaa text-[clamp(13px,1.3vw,15px)] mb-2">
                ✓ Your deposit evidence has been successfully uploaded!
              </p>
              <p className="text-purple-700 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
                Our admin team is currently reviewing your deposit evidence. Once verified, your booking will be confirmed and you will receive an email notification.
              </p>
              <p className="text-purple-600 font-comfortaa text-[clamp(11px,1.1vw,13px)] mt-2">
                Please wait for our team to complete the verification process.
              </p>
            </div>
            {booking.depositEvidenceUrl && (() => {
              // Generate secure proxy URL instead of direct blob URL
              const proxyUrl = `/api/deposit/${token}/image`
              return (
              <div className="mt-4">
                <a
                    href={proxyUrl}
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
              )
            })()}
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

          {/* Response Options - Only Cancel Available */}
          <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
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
            disabled={isSubmitting || !response}
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

