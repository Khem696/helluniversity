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
  const [response, setResponse] = useState<"accept" | "propose" | "cancel" | null>(null)
  const [proposedDate, setProposedDate] = useState<Date | null>(null)
  const [message, setMessage] = useState("")
  const [submitSuccess, setSubmitSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setError("Invalid token")
      setIsLoading(false)
      return
    }

    async function fetchBooking() {
      try {
        const response = await fetch(`/api/booking/response/${token}`)
        if (!response.ok) {
          throw new Error("Failed to fetch booking details")
        }

        const data = await response.json()
        if (data.success && data.booking) {
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
        setError(err instanceof Error ? err.message : "Failed to load booking")
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
      setError("Please select a proposed date")
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

            {booking.proposedDate && (
              <div className="bg-[#fef3c7] border-l-4 border-[#f59e0b] p-3 sm:p-4 rounded">
                <Label className="text-[#92400e] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Proposed New Date
                </Label>
                <p className="text-[#78350f] font-comfortaa text-[clamp(14px,1.5vw,16px)] mt-1 font-medium">
                  {format(new Date(booking.proposedDate), "EEEE, MMMM d, yyyy")}
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

            <button
              type="button"
              onClick={() => {
                setResponse("propose")
                setError(null)
              }}
              className={`w-full p-4 sm:p-5 rounded-lg border-2 transition-all text-left ${
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-auto font-comfortaa text-[clamp(13px,1.3vw,15px)]"
                        >
                          <Calendar className="mr-2 w-4 h-4" />
                          {proposedDate
                            ? format(proposedDate, "MMMM d, yyyy")
                            : "Select Date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <SimpleCalendar
                          mode="single"
                          selected={proposedDate || undefined}
                          onSelect={(date) => {
                            setProposedDate(date || null)
                            setError(null)
                          }}
                          disabled={(date) => date < new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            </button>

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
            disabled={isSubmitting || !response || (response === "propose" && !proposedDate)}
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

