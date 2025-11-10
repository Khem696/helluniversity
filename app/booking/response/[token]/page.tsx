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

// Convert 24-hour format (HH:MM) to 12-hour format with AM/PM
function convert24To12Hour(time24: string): string {
  if (!time24 || !time24.includes(':')) return time24
  const [hours, minutes] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  const mins = minutes || '00'
  if (isNaN(hour24)) return time24
  
  let hour12 = hour24 % 12
  if (hour12 === 0) hour12 = 12
  const period = hour24 < 12 ? 'AM' : 'PM'
  return `${hour12}:${mins} ${period}`
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
}

export default function BookingResponsePage() {
  const params = useParams()
  const router = useRouter()
  const token = params?.token as string

  const [booking, setBooking] = useState<BookingData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [response, setResponse] = useState<"accept" | "propose" | "cancel" | "check-in" | null>(null)
  const [proposedDate, setProposedDate] = useState<Date | null>(null)
  const [proposedEndDate, setProposedEndDate] = useState<Date | null>(null)
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [proposedStartTime, setProposedStartTime] = useState("09:00") // 24-hour format for TimePicker
  const [proposedEndTime, setProposedEndTime] = useState("17:00") // 24-hour format for TimePicker
  const [message, setMessage] = useState("")
  const [submitSuccess, setSubmitSuccess] = useState(false)

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
        const data = await response.json()
        
        if (!response.ok || !data.success) {
          // Fix #12: Better error message for token expiration
          if (data.error && (data.error.includes("expired") || data.error.includes("Invalid"))) {
            throw new Error(data.error || "This response link has expired. Please contact the administrator to request a new link.")
          }
          throw new Error(data.error || "Failed to fetch booking details")
        }

        if (data.booking) {
          setBooking(data.booking)
          // Pre-fill proposed date if available
          if (data.booking.proposedDate) {
            setProposedDate(new Date(data.booking.proposedDate))
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
    
    if (response === "propose" && proposedDateRange === "multiple" && proposedEndDate && proposedDate && proposedEndDate < proposedDate) {
      setError("End date must be after start date")
      return
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
          proposedDate: proposedDate ? proposedDate.toISOString() : undefined,
          proposedEndDate: proposedDateRange === "multiple" && proposedEndDate ? proposedEndDate.toISOString() : undefined,
          proposedStartTime: proposedStartTime ? convert24To12Hour(proposedStartTime) : undefined,
          proposedEndTime: proposedEndTime ? convert24To12Hour(proposedEndTime) : undefined,
          message: message.trim() || undefined,
        }),
      })

      const data = await responseData.json()

      if (data.success) {
        setSubmitSuccess(true)
        // Redirect after 3 seconds
        setTimeout(() => {
          router.push("/")
        }, 3000)
      } else {
        throw new Error(data.error || "Failed to submit response")
      }
    } catch (err) {
      console.error("Error submitting response:", err)
      setError(err instanceof Error ? err.message : "Failed to submit response")
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
                    {booking.startTime}
                    {booking.endTime && ` - ${booking.endTime}`}
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
                          {booking.startTime}
                          {booking.endTime && ` - ${booking.endTime}`}
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
                      {booking.startTime}
                      {booking.endTime && ` - ${booking.endTime}`}
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
            {/* Show different first option based on booking status */}
            {booking.status === "accepted" ? (
              <button
                type="button"
                onClick={() => {
                  setResponse("check-in")
                  setError(null)
                }}
                className={`w-full p-4 sm:p-5 rounded-lg border-2 transition-all text-left ${
                  response === "check-in"
                    ? "border-[#10b981] bg-[#10b981]/10"
                    : "border-gray-200 hover:border-[#10b981]/50"
                }`}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div
                    className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      response === "check-in"
                        ? "border-[#10b981] bg-[#10b981]"
                        : "border-gray-300"
                    }`}
                  >
                    {response === "check-in" && (
                      <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-[#5a3a2a] font-urbanist text-[clamp(16px,2vw,20px)] font-extrabold mb-1">
                      Confirm Check-In
                    </h3>
                    <p className="text-[#5a3a2a]/70 font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                      I confirm that I have checked in for my reservation
                    </p>
                  </div>
                </div>
              </button>
            ) : booking.status === "postponed" && booking.proposedDate ? (
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
                              mode="single"
                              selected={proposedDate || undefined}
                              onSelect={(date) => {
                                setProposedDate(date || null)
                                if (proposedDateRange === "multiple" && proposedEndDate && date && date > proposedEndDate) {
                                  setProposedEndDate(null)
                                }
                                setError(null)
                              }}
                              disabled={(date) => date < new Date()}
                              initialFocus
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
                              >
                                <Calendar className="mr-2 w-4 h-4" />
                                {proposedEndDate
                                  ? format(proposedEndDate, "MMMM d, yyyy")
                                  : "Select End Date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <SimpleCalendar
                                mode="single"
                                selected={proposedEndDate || undefined}
                                onSelect={(date) => {
                                  setProposedEndDate(date || null)
                                  setError(null)
                                }}
                                disabled={(date) => {
                                  if (!proposedDate) return date < new Date()
                                  return date < proposedDate || date < new Date()
                                }}
                                initialFocus
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

