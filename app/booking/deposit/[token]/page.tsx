"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Upload, Check, AlertCircle, X, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { API_PATHS } from "@/lib/api-config"
import { useUserBookingSSE } from "@/hooks/useUserBookingSSE"

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
  depositEvidenceUrl?: string | null
  depositVerifiedAt?: number | null
}

export default function DepositUploadPage() {
  const params = useParams()
  const router = useRouter()
  const token = params?.token as string

  const [booking, setBooking] = useState<BookingData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelSuccess, setCancelSuccess] = useState(false)
  
  // Real-time booking updates via SSE (for deposit verification status)
  useUserBookingSSE({
    token: token || "",
    enabled: !!token, // Enable with just token - SSE will work even if initial booking fetch fails
    onDepositVerified: (event) => {
      // Update booking state when deposit is verified
      if (event.booking) {
        setBooking(prev => prev ? {
          ...prev,
          status: event.booking.status,
          depositVerifiedAt: event.booking.deposit_verified_at || null,
        } : null)
      }
    },
    onStatusChange: (event) => {
      // Update booking state when status changes
      if (event.booking) {
        setBooking(prev => prev ? {
          ...prev,
          status: event.booking.status,
          depositVerifiedAt: event.booking.deposit_verified_at || null,
        } : null)
      }
    },
    onBookingUpdate: (event) => {
      // Update booking state for any booking update
      if (event.booking) {
        setBooking(prev => prev ? {
          ...prev,
          status: event.booking.status,
          depositVerifiedAt: event.booking.deposit_verified_at || null,
        } : null)
      }
    },
  })

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing token")
      setIsLoading(false)
      return
    }

    async function fetchBooking() {
      try {
        const response = await fetch(API_PATHS.bookingResponse(token))
        const json = await response.json()
        
        // Check for API errors first
        if (!response.ok || !json.success) {
          const errorMessage = json.error?.message || json.error || json.message || "Failed to fetch booking details"
          console.error("API error:", { status: response.status, error: errorMessage, json })
          throw new Error(errorMessage)
        }

        // Check if booking data exists
        if (!json.data || !json.data.booking) {
          console.error("Booking data missing in response:", json)
          throw new Error("Booking not found in response")
        }

        const booking = json.data.booking
        setBooking(booking)
        
        // Check if booking is in pending_deposit status
        // pending_deposit means admin accepted booking and is waiting for deposit, or admin rejected previous deposit
        if (booking.status !== "pending_deposit") {
          setError(`Deposit can only be uploaded for pending_deposit bookings. Current status: ${booking.status}`)
        }
      } catch (err) {
        console.error("Error fetching booking:", err)
        const errorMessage = err instanceof Error ? err.message : "Failed to load booking"
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    fetchBooking()
  }, [token])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }

    // Validate file size (configurable via environment variable, default 20MB)
    // Note: This is a client-side check. Backend also validates.
    const maxFileSize = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_FILE_SIZE || '20971520', 10) // 20MB default
    if (file.size > maxFileSize) {
      const maxSizeMB = Math.round(maxFileSize / 1024 / 1024)
      toast.error(`File size must be less than ${maxSizeMB}MB`)
      return
    }

    setSelectedFile(file)
    setError(null)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedFile) {
      setError("Please select a file to upload")
      return
    }

    if (!token) {
      setError("Invalid token")
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("token", token)
      formData.append("file", selectedFile)

      const response = await fetch(API_PATHS.bookingDeposit, {
        method: "POST",
        body: formData,
      })

      const json = await response.json()

      if (!response.ok || !json.success) {
        // Parse error for better user experience
        const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
        const parsedError = parseBackendError(json.error || "Failed to upload deposit evidence", response)
        
        // Handle 409 Conflict (optimistic locking)
        if (response.status === 409 || parsedError.type === 'conflict') {
          // Refresh booking data and show retry option
          try {
            const bookingResponse = await fetch(API_PATHS.bookingResponse(token))
            const bookingJson = await bookingResponse.json()
            if (bookingJson.success) {
              const refreshedBooking = bookingJson.data?.booking || bookingJson.booking
              if (refreshedBooking) {
                setBooking(refreshedBooking)
                // Check if status still allows deposit upload
                if (refreshedBooking.status !== "accepted" && refreshedBooking.status !== "pending_deposit") {
                  setError(`Booking status changed to "${refreshedBooking.status}". Deposit can only be uploaded for accepted or pending_deposit bookings.`)
                  toast.error(`Booking status changed. Current status: ${refreshedBooking.status}`)
                  return
                }
              }
            }
          } catch (refreshError) {
            console.error("Failed to refresh booking data:", refreshError)
          }
          
          setError(getErrorMessageWithGuidance(parsedError))
          toast.error(parsedError.userMessage, {
            action: parsedError.retryable ? {
              label: "Retry",
              onClick: () => handleUpload(e as any),
            } : undefined,
          })
          return
        }
        
        // Handle other errors
        throw new Error(getErrorMessageWithGuidance(parsedError))
      }

      setUploadSuccess(true)
      toast.success("Deposit evidence uploaded successfully!")

      // Redirect to home page after 5 seconds (users will receive email when admin verifies)
      // Users can also click the button to redirect immediately
      setTimeout(() => {
        router.push(`/`)
      }, 5000)
    } catch (err) {
      console.error("Error uploading deposit:", err)
      // Parse error for better display
      const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
      const parsedError = parseBackendError(err instanceof Error ? err : new Error(String(err)))
      const errorMessage = getErrorMessageWithGuidance(parsedError)
      setError(errorMessage)
      toast.error(errorMessage, {
        action: parsedError.retryable ? {
          label: parsedError.actionLabel || "Retry",
          onClick: () => handleUpload(e as any),
        } : undefined,
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleCancelBooking = async () => {
    if (!token) {
      setError("Invalid token")
      return
    }

    setIsCancelling(true)
    setError(null)

    try {
      const response = await fetch(API_PATHS.bookingResponse(token), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response: "cancel",
        }),
      })

      const json = await response.json()

      if (!response.ok || !json.success) {
        const errorMessage = json.error?.message || json.error || "Failed to cancel booking"
        throw new Error(errorMessage)
      }

      setCancelSuccess(true)
      setShowCancelConfirm(false)
      toast.success("Booking cancelled successfully!")

      // Redirect to home page after 3 seconds
      setTimeout(() => {
        router.push(`/`)
      }, 3000)
    } catch (err) {
      console.error("Error cancelling booking:", err)
      setError(err instanceof Error ? err.message : "Failed to cancel booking")
      toast.error(err instanceof Error ? err.message : "Failed to cancel booking")
    } finally {
      setIsCancelling(false)
    }
  }

  const formatDateRange = (startDate: string, endDate?: string) => {
    const start = new Date(startDate)
    const startFormatted = start.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })

    if (endDate && endDate !== startDate) {
      const end = new Date(endDate)
      const endFormatted = end.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      return `${startFormatted} - ${endFormatted}`
    }

    return startFormatted
  }

  const formatEventType = (eventType: string, otherEventType?: string): string => {
    const eventTypes: Record<string, string> = {
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

    const baseType = eventTypes[eventType] || eventType
    return otherEventType ? `${baseType} - ${otherEventType}` : baseType
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white font-comfortaa text-[clamp(14px,1.5vw,18px)]">
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
            Error
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

  if (uploadSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center max-w-md">
          <Check className="w-12 h-12 sm:w-16 sm:h-16 text-white mx-auto mb-4" />
          <h1 className="text-white font-urbanist text-[clamp(24px,4vw,32px)] font-extrabold mb-4">
            Deposit Uploaded Successfully
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] mb-6">
            Thank you! Your deposit evidence has been uploaded. Our admin team will verify it and confirm your check-in shortly. You will receive an email with access to your reservation management page once the verification is complete.
          </p>
          <div className="space-y-3">
            <Button
              onClick={() => router.push(`/`)}
              className="bg-white text-[#3e82bb] hover:bg-white/90 font-comfortaa w-full sm:w-auto"
            >
              Return to Home Page
            </Button>
            <p className="text-white/70 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
              Redirecting automatically in a few seconds...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (cancelSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#3e82bb] p-4 sm:p-6">
        <div className="text-center max-w-md">
          <XCircle className="w-12 h-12 sm:w-16 sm:h-16 text-white mx-auto mb-4" />
          <h1 className="text-white font-urbanist text-[clamp(24px,4vw,32px)] font-extrabold mb-4">
            Booking Cancelled
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)] mb-6">
            Your booking has been cancelled successfully. You and the admin team have been notified via email.
          </p>
          <div className="space-y-3">
            <Button
              onClick={() => router.push(`/`)}
              className="bg-white text-[#3e82bb] hover:bg-white/90 font-comfortaa w-full sm:w-auto"
            >
              Return to Home Page
            </Button>
            <p className="text-white/70 font-comfortaa text-[clamp(12px,1.2vw,14px)]">
              Redirecting automatically in a few seconds...
            </p>
          </div>
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
            Upload Deposit Evidence
          </h1>
          <p className="text-white/90 font-comfortaa text-[clamp(14px,1.5vw,18px)]">
            {booking.status === "pending_deposit" && booking.depositEvidenceUrl
              ? "Your previous deposit evidence was rejected. Please upload a new deposit evidence image."
              : "Please upload your deposit payment evidence"}
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
          </div>
        </div>

        {/* Upload Form */}
        <form onSubmit={handleUpload} className="bg-white rounded-lg shadow-lg p-4 sm:p-6 lg:p-8">
          <h2 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4 sm:mb-6">
            Deposit Evidence
          </h2>

          {booking.status === "pending_deposit" && booking.depositEvidenceUrl && (
            <div className="bg-orange-50 border border-orange-200 text-orange-800 p-3 sm:p-4 rounded mb-4 sm:mb-6">
              <p className="font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                ⚠️ <strong>Re-upload Required:</strong> Your previous deposit evidence did not meet our requirements. Please upload a new deposit evidence image.
              </p>
            </div>
          )}
          
          {booking.status === "pending_deposit" && !booking.depositEvidenceUrl && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 sm:p-4 rounded mb-4 sm:mb-6">
              <p className="font-comfortaa text-[clamp(13px,1.3vw,15px)]">
                ℹ️ <strong>Deposit Required:</strong> Your reservation has been accepted! Please upload your deposit evidence to complete the booking process.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 sm:p-4 rounded mb-4 sm:mb-6">
              <p className="font-comfortaa text-[clamp(13px,1.3vw,15px)]">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="file" className="text-[#5a3a2a] font-comfortaa text-[clamp(12px,1.2vw,14px)] font-semibold">
                Select Deposit Evidence Image *
              </Label>
              <div className="mt-2">
                <input
                  type="file"
                  id="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isUploading}
                />
                <label
                  htmlFor="file"
                  className="flex flex-col items-center justify-center w-full h-32 sm:h-40 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden"
                >
                  {previewUrl ? (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedFile(null)
                          setPreviewUrl(null)
                        }}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 z-10"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-10 h-10 text-gray-400 mb-2" />
                      <p className="mb-2 text-sm text-gray-500 font-comfortaa">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500 font-comfortaa">
                        PNG, JPG, WEBP up to {Math.round((parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_FILE_SIZE || '20971520', 10) / 1024 / 1024))}MB
                      </p>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {selectedFile ? (
              <div className="bg-green-50 border border-green-200 p-3 rounded">
                <p className="text-sm text-green-800 font-comfortaa">
                  ✓ Selected: <span className="font-semibold">{selectedFile.name}</span> ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
                <p className="text-sm text-yellow-800 font-comfortaa">
                  ⚠️ Please select a deposit evidence image above to enable upload
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2">
              <Button
                type="submit"
                disabled={!selectedFile || isUploading || isCancelling}
                className={`flex-1 font-comfortaa ${
                  !selectedFile || isUploading || isCancelling
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-[#10b981] hover:bg-[#10b981]/90 text-white"
                }`}
              >
                {isUploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Uploading...
                  </>
                ) : !selectedFile ? (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Select File First
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Deposit Evidence
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCancelConfirm(true)}
                className="font-comfortaa border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                disabled={isUploading || isCancelling}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancel Booking
              </Button>
            </div>
          </div>
        </form>

        {/* Cancel Confirmation Dialog */}
        {showCancelConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-[#5a3a2a] font-urbanist text-[clamp(20px,3vw,24px)] font-extrabold mb-4">
                Confirm Cancellation
              </h3>
              <p className="text-[#5a3a2a] font-comfortaa text-[clamp(14px,1.5vw,16px)] mb-6">
                Are you sure you want to cancel this booking? This action cannot be undone. You and the admin team will be notified via email.
              </p>
              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={handleCancelBooking}
                  disabled={isCancelling}
                  className="flex-1 font-comfortaa bg-red-600 hover:bg-red-700 text-white"
                >
                  {isCancelling ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 mr-2" />
                      Yes, Cancel Booking
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isCancelling}
                  variant="outline"
                  className="flex-1 font-comfortaa"
                >
                  No, Keep Booking
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

