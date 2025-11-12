"use client"

import { useState, useEffect, useRef } from "react"
import { redirect } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Calendar,
  Mail,
  Phone,
  Users,
  Clock,
  FileText,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Ban,
  CalendarX,
  Archive,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { BookingStateInfo } from "@/components/admin/BookingStateInfo"
import { ActionConfirmationDialog } from "@/components/admin/ActionConfirmationDialog"
import { useBookingActions } from "@/hooks/useBookingActions"
import { getAvailableActions, type ActionDefinition } from "@/lib/booking-state-machine"
import { calculateStartTimestamp } from "@/lib/booking-validations"
import { getBangkokTime } from "@/lib/timezone"

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

interface Booking {
  id: string
  name: string
  email: string
  phone: string
  participants: string | null
  event_type: string
  other_event_type: string | null
  date_range: number
  start_date: number
  end_date: number | null
  start_time: string
  end_time: string
  organization_type: string | null
  organized_person: string | null
  introduction: string | null
  biography: string | null
  special_requests: string | null
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in" | "paid_deposit" | "pending_deposit"
  admin_notes: string | null
  response_token: string | null
  token_expires_at: number | null
  proposed_date: number | null
  proposed_end_date: number | null
  user_response: string | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
  deposit_verified_by: string | null
  created_at: number
  updated_at: number
}

interface StatusHistory {
  id: string
  booking_id: string
  old_status: string
  new_status: string
  changed_by: string | null
  change_reason: string | null
  created_at: number
}

export default function BookingsPage() {
  const { data: session, status } = useSession()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([])
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailFilter, setEmailFilter] = useState("")
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [postponeMode, setPostponeMode] = useState<"user-propose" | "admin-propose">("user-propose")
  const [selectedStatusInForm, setSelectedStatusInForm] = useState<string>("")
  const [selectedAction, setSelectedAction] = useState<"accept" | "reject" | "postpone" | null>(null)
  const [newResponsesCount, setNewResponsesCount] = useState<number>(0)
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<ActionDefinition | null>(null)
  const [pendingValidation, setPendingValidation] = useState<any>(null)
  
  // Use refs to track current values without causing dependency array changes
  const selectedBookingRef = useRef<Booking | null>(null)
  const viewDialogOpenRef = useRef<boolean>(false)
  const lastCheckedAtRef = useRef<number>(Date.now())
  const seenResponseIdsRef = useRef<Set<string>>(new Set())
  const lastStatusCheckRef = useRef<Map<string, { status: string; updated_at: number }>>(new Map())
  
  // Update refs when values change
  useEffect(() => {
    selectedBookingRef.current = selectedBooking
  }, [selectedBooking])
  
  useEffect(() => {
    viewDialogOpenRef.current = viewDialogOpen
  }, [viewDialogOpen])
  
  // Initialize booking actions hook
  const {
    isLoading: actionLoading,
    validationResult,
    getActions,
    validateActionBeforeExecution,
    executeAction,
  } = useBookingActions({
    onSuccess: () => {
      setStatusDialogOpen(false)
      setSelectedAction(null)
      setSelectedStatusInForm("")
      setPostponeMode("user-propose")
      setProposedDateRange("single")
      fetchBookings()
      if (viewDialogOpen) {
        fetchBookingDetails(selectedBooking?.id || "")
      }
    },
  })

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // Fetch bookings
  const fetchBookings = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }
      if (emailFilter) {
        params.append("email", emailFilter)
      }
      params.append("limit", "1000")

      const response = await fetch(`/api/admin/bookings?${params.toString()}`)
      const json = await response.json()
      
      if (json.success && json.data) {
        const bookings = json.data.bookings || []
        setBookings(Array.isArray(bookings) ? bookings : [])
      } else {
        const errorMessage = json.error?.message || "Failed to load bookings"
        toast.error(errorMessage)
        // Set to empty array on error to prevent undefined state
        setBookings([])
      }
    } catch (error) {
      toast.error("Failed to load bookings")
      console.error(error)
      // Set to empty array on error to prevent undefined state
      setBookings([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchBookings()
      lastCheckedAtRef.current = Date.now()
    }
  }, [session, statusFilter, emailFilter])

  // Poll for new user responses and status changes every 30 seconds
  useEffect(() => {
    if (!session) return

    const pollInterval = setInterval(async () => {
      // Get current selected booking ID to avoid stale closure using refs
      const currentSelectedBookingId = selectedBookingRef.current?.id
      const isDialogOpen = viewDialogOpenRef.current
      try {
        // Check for bookings with new user responses and status changes
        const params = new URLSearchParams()
        params.append("limit", "1000")
        const response = await fetch(`/api/admin/bookings?${params.toString()}`)
        const json = await response.json()
        
        if (json.success && json.data) {
          const bookings = json.data.bookings || []
          if (Array.isArray(bookings)) {
            const currentBookings = bookings as Booking[]
            
            // Find bookings with new user responses (response_date after lastCheckedAt)
          const newResponses = currentBookings.filter(booking => {
            if (!booking.user_response || !booking.response_date) return false
            
            // Check if this response is new (response_date is after lastCheckedAt)
            const responseTime = booking.response_date * 1000 // Convert to milliseconds
            const isNew = responseTime > lastCheckedAtRef.current
            
            // Check if we've already seen this response
            const responseId = `${booking.id}-${booking.response_date}`
            const alreadySeen = seenResponseIdsRef.current.has(responseId)
            
            return isNew && !alreadySeen
          })

          // Find bookings with status changes (compare with last known status)
          const statusChanges: Booking[] = []
          const newStatusMap = new Map<string, { status: string; updated_at: number }>()
          
          currentBookings.forEach(booking => {
            const lastKnown = lastStatusCheckRef.current.get(booking.id)
            newStatusMap.set(booking.id, {
              status: booking.status,
              updated_at: booking.updated_at || 0
            })
            
            // Detect status change (status different or updated_at changed significantly)
            if (lastKnown) {
              const statusChanged = lastKnown.status !== booking.status
              const wasRecentlyUpdated = booking.updated_at && 
                booking.updated_at > lastKnown.updated_at &&
                (booking.updated_at - lastKnown.updated_at) > 5 // At least 5 seconds difference
              
              if (statusChanged && wasRecentlyUpdated) {
                // Status changed - notify admin
                statusChanges.push(booking)
              } else if (!statusChanged && wasRecentlyUpdated && booking.updated_at) {
                // Status same but booking was updated (might be auto-update or other admin)
                // Only notify if it's a significant change (updated_at changed by more than polling interval)
                const timeDiff = booking.updated_at - lastKnown.updated_at
                if (timeDiff > 25) { // More than 25 seconds (close to polling interval)
                  statusChanges.push(booking)
                }
              }
            } else {
              // First time seeing this booking - don't notify
            }
          })
          
          lastStatusCheckRef.current = newStatusMap

          // Show notifications for new user responses
          if (newResponses.length > 0) {
            // Mark responses as seen
            newResponses.forEach(booking => {
              if (booking.response_date) {
                const responseId = `${booking.id}-${booking.response_date}`
                seenResponseIdsRef.current.add(responseId)
              }
            })

            // Show notifications for each new response
            newResponses.forEach(booking => {
              const responseType = booking.user_response?.toLowerCase() || ""
              let message = ""
              let type: "success" | "info" | "warning" = "info"

              if (responseType.includes("accept")) {
                message = `${booking.name} accepted the proposed date`
                type = "success"
              } else if (responseType.includes("propose")) {
                message = `${booking.name} proposed an alternative date`
                type = "warning"
              } else if (responseType.includes("cancel")) {
                message = `${booking.name} cancelled their reservation`
                type = "warning"
              } else {
                message = `${booking.name} responded to their reservation`
              }

              toast[type](message, {
                description: `Event: ${booking.event_type}`,
                action: {
                  label: "View",
                  onClick: () => {
                    setSelectedBooking(booking)
                    setViewDialogOpen(true)
                    fetchBookingDetails(booking.id)
                  },
                },
                duration: 5000,
              })
            })

            // Update new responses count
            setNewResponsesCount(prev => prev + newResponses.length)
          }
          
          // Show notifications for status changes
          if (statusChanges.length > 0) {
            statusChanges.forEach(booking => {
              const lastKnown = lastStatusCheckRef.current.get(booking.id)
              if (lastKnown && lastKnown.status !== booking.status) {
                // Special notification for deposit uploads
                const isDepositUpload = lastKnown.status === "accepted" && booking.status === "paid_deposit"
                
                if (isDepositUpload) {
                  toast.success(`Deposit Evidence Uploaded: ${booking.name}`, {
                    description: "A deposit evidence has been uploaded and requires verification.",
                    action: {
                      label: "View",
                      onClick: () => {
                        setSelectedBooking(booking)
                        setViewDialogOpen(true)
                        fetchBookingDetails(booking.id)
                      },
                    },
                    duration: 8000,
                  })
                } else {
                toast.info(`Booking status updated: ${booking.name}`, {
                  description: `Status changed from "${lastKnown.status}" to "${booking.status}"`,
                  action: {
                    label: "View",
                    onClick: () => {
                      setSelectedBooking(booking)
                      setViewDialogOpen(true)
                      fetchBookingDetails(booking.id)
                    },
                  },
                  duration: 5000,
                })
                }
                
                // If this booking is currently selected and dialog is open, refresh it
                if (currentSelectedBookingId === booking.id && isDialogOpen) {
                  fetchBookingDetails(booking.id)
                }
              } else {
                // Booking was updated but status didn't change (might be auto-update or other admin)
                toast.info(`Booking updated: ${booking.name}`, {
                  description: "This booking was recently updated. Refreshing...",
                  duration: 3000,
                })
                
                // If this booking is currently selected and dialog is open, refresh it
                if (currentSelectedBookingId === booking.id && isDialogOpen) {
                  fetchBookingDetails(booking.id)
                }
              }
            })
          }
          
          // Refresh bookings list if there are any changes
          if (newResponses.length > 0 || statusChanges.length > 0) {
            fetchBookings()
            
            // If dialog is open, refresh selected booking details to get latest data
            if (isDialogOpen && currentSelectedBookingId) {
              fetchBookingDetails(currentSelectedBookingId)
            }
          }

            // Update last checked time
            lastCheckedAtRef.current = Date.now()
          }
        }
      } catch (error) {
        console.error("Error polling for updates:", error)
      }
    }, 30000) // Poll every 30 seconds

    return () => clearInterval(pollInterval)
  }, [session]) // Only depend on session to prevent constant re-renders

  // Fetch booking details and history
  const fetchBookingDetails = async (bookingId: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`)
      const json = await response.json()
      
      if (json.success && json.data) {
        const booking = json.data.booking
        const statusHistory = (json.data.statusHistory || []).filter((h: StatusHistory) => 
          h.old_status && h.new_status && h.old_status.trim() !== '' && h.new_status.trim() !== ''
        )
        
        if (booking) {
          setSelectedBooking(booking)
          setStatusHistory(statusHistory)
          // Reset postpone mode when opening dialog
          setPostponeMode("user-propose")
          setProposedDateRange("single")
          setSelectedStatusInForm(booking.status)
        } else {
          toast.error("Booking data not found in response")
        }
      } else {
        const errorMessage = json.error?.message || "Failed to load booking details"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to load booking details")
      console.error(error)
    }
  }

  // Handle delete booking
  const handleDeleteBooking = async (bookingId: string) => {
    // Find the booking to check its status
    const booking = bookings.find(b => b.id === bookingId)
    let statusText = ""
    if (booking?.status === "rejected" || booking?.status === "cancelled" || booking?.status === "finished") {
      statusText = booking?.status === "finished"
        ? "Only admin will be notified. No user email will be sent as the event has already finished."
        : "Only admin will be notified of this deletion."
    } else {
      statusText = "A cancellation email will be sent to the user, and admin will be notified."
    }
    
    if (!confirm(`Are you sure you want to delete this booking? This action cannot be undone. ${statusText}`)) {
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: "DELETE",
      })

      // Check if response is ok and has content
      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = "Failed to delete booking"
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = errorText || errorMessage
        }
        toast.error(errorMessage)
        return
      }

      // Check if response has content before parsing JSON
      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        toast.error("Invalid response from server")
        return
      }

      const json = await response.json()
      
      if (json.success) {
        const message = json.data?.message || "Booking deleted successfully. Notifications sent if applicable."
        toast.success(message)
        setViewDialogOpen(false)
        setStatusDialogOpen(false)
        fetchBookings()
      } else {
        const errorMessage = json.error?.message || "Failed to delete booking"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to delete booking")
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Map admin action to status
  const mapActionToStatus = (action: "accept" | "reject" | "postpone", currentStatus: string): string => {
    if (action === "accept") {
      // Accept always maps to "accepted" - backend will handle deposit carry-over logic
      return "accepted"
    } else if (action === "reject") {
      return "rejected"
    } else if (action === "postpone") {
      return "postponed"
    }
    return currentStatus
  }

  // Handle action update with validation
  const handleActionUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedBooking) return

    // Prevent action updates for checked-in bookings
    if ((selectedBooking.status as string) === "checked-in") {
      toast.error("Cannot update status for checked-in bookings. Only deletion is allowed.")
      return
    }

    if (!selectedAction) {
      toast.error("Please select an action (Accept, Reject, or Postpone)")
      return
    }

    // Check if booking date is in the past
    const now = getBangkokTime()
    const checkDate = selectedBooking.proposed_date && selectedBooking.status === "postponed" 
      ? selectedBooking.proposed_date 
      : selectedBooking.start_date
    const startTimestamp = calculateStartTimestamp(checkDate, selectedBooking.start_time || null)
    const isDateInPast = startTimestamp < now

    // Get available actions from state machine
    const availableActions = getAvailableActions(
      selectedBooking.status as any,
      Boolean(selectedBooking.proposed_date),
      Boolean(selectedBooking.deposit_evidence_url),
      isDateInPast
    )
    
    // Find the selected action definition
    const actionDef = availableActions.find(
      (a) => 
        (selectedAction === "accept" && a.id === "accept") ||
        (selectedAction === "reject" && a.id === "reject") ||
        (selectedAction === "postpone" && a.id === "postpone")
    )

    if (!actionDef) {
      toast.error(`Action "${selectedAction}" is not available for status "${selectedBooking.status}"`)
      return
    }

    // Validate action if required
    if (actionDef.requiresValidation) {
      const validation = await validateActionBeforeExecution(
        actionDef.id as any,
        selectedBooking as any
      )

      if (!validation.valid) {
        // Show errors and prevent action
        validation.errors.forEach((error) => {
          toast.error(error)
        })
        return
      }

      // If there are warnings, show confirmation dialog
      if (validation.warnings.length > 0 || validation.overlappingBookings) {
        setPendingAction(actionDef)
        setPendingValidation(validation)
        setConfirmationDialogOpen(true)
        return
      }
    }

    // Proceed with action (no warnings or validation not required)
    await executeActionDirectly(actionDef)
  }

  // Execute action directly (after confirmation if needed)
  const executeActionDirectly = async (actionDef: ActionDefinition) => {
    if (!selectedBooking) return

    setSaving(true)
    const form = document.querySelector('form[onSubmit]') as HTMLFormElement
    const formData = form ? new FormData(form) : new FormData()
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string
    
    // Map action to status
    const status = mapActionToStatus(selectedAction!, selectedBooking.status)
    
    // For postpone action: Admin requests user to propose - no dates from admin
    let proposedDate: string | null = null
    
    if (selectedAction === "postpone") {
      proposedDate = null
    }

    try {
      const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: status,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: proposedDate,
          proposedStartDate: null,
          proposedEndDate: null,
          proposedStartTime: null,
          proposedEndTime: null,
          depositVerifiedBy: null,
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        toast.success(`Booking ${selectedAction === "accept" ? "accepted" : selectedAction === "reject" ? "rejected" : "postponed"} successfully. Email notification sent.`)
        setStatusDialogOpen(false)
        setSelectedAction(null)
        setSelectedStatusInForm("")
        setPostponeMode("user-propose")
        setProposedDateRange("single")
        setConfirmationDialogOpen(false)
        setPendingAction(null)
        setPendingValidation(null)
        fetchBookings()
        if (viewDialogOpen) {
          fetchBookingDetails(selectedBooking.id)
        }
      } else {
          // Parse error for better user experience
          const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
          const errorText = json.error?.message || "Failed to update booking"
          const parsedError = parseBackendError(errorText, response)
          const errorMessage = getErrorMessageWithGuidance(parsedError)
          
          // Check if error is due to optimistic locking conflict
          if (parsedError.type === 'conflict') {
            toast.error(parsedError.userMessage, {
              action: {
                label: "Refresh",
                onClick: async () => {
                  if (selectedBooking) {
                    await fetchBookingDetails(selectedBooking.id)
                  }
                  fetchBookings()
                },
              },
            })
            // Auto-refresh booking data
            if (selectedBooking) {
              await fetchBookingDetails(selectedBooking.id)
            }
            fetchBookings()
          } else if (parsedError.type === 'transition') {
            // Show transition error with valid options
            toast.error(errorMessage)
          } else {
            toast.error(errorMessage)
          }
        }
      } catch (error) {
        const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
        const parsedError = parseBackendError(error instanceof Error ? error : new Error(String(error)))
        const errorMessage = getErrorMessageWithGuidance(parsedError)
        
        // Check if error is due to optimistic locking conflict
        if (parsedError.type === 'conflict') {
          toast.error(parsedError.userMessage, {
            action: {
              label: "Refresh",
              onClick: async () => {
                if (selectedBooking) {
                  await fetchBookingDetails(selectedBooking.id)
                }
                fetchBookings()
              },
            },
          })
          // Auto-refresh booking data
          if (selectedBooking) {
            await fetchBookingDetails(selectedBooking.id)
          }
          fetchBookings()
        } else {
          toast.error(errorMessage)
        }
        console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Handle confirmation dialog confirm
  const handleConfirmAction = async () => {
    if (pendingAction) {
      await executeActionDirectly(pendingAction)
      setConfirmationDialogOpen(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "outline",
      accepted: "default",
      paid_deposit: "secondary",
      rejected: "destructive",
      postponed: "secondary",
      cancelled: "destructive",
      finished: "default",
      "checked-in": "default",
    }
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
      accepted: "bg-green-100 text-green-800 border-green-300",
      paid_deposit: "bg-purple-100 text-purple-800 border-purple-300",
      pending_deposit: "bg-orange-100 text-orange-800 border-orange-300",
      rejected: "bg-red-100 text-red-800 border-red-300",
      postponed: "bg-blue-100 text-blue-800 border-blue-300",
      cancelled: "bg-gray-100 text-gray-800 border-gray-300",
      finished: "bg-gray-100 text-gray-800 border-gray-300",
      "checked-in": "bg-emerald-100 text-emerald-800 border-emerald-300",
    }
    return (
      <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
        {status === "checked-in" ? "Checked In" : status === "paid_deposit" ? "Paid Deposit" : status === "pending_deposit" ? "Pending Deposit" : status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const formatTimestamp = (timestamp: number | null | undefined) => {
    if (timestamp === null || timestamp === undefined || timestamp === 0) return "N/A"
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const timestampMs = timestamp > 1000000000000 
        ? timestamp // Already in milliseconds
        : timestamp * 1000 // Convert from seconds to milliseconds
      
      // CRITICAL: Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      
      return format(bangkokDate, "MMM dd, yyyy 'at' h:mm a")
    } catch (error) {
      console.error("Error formatting timestamp:", timestamp, error)
      return "N/A"
    }
  }

  const formatDate = (timestamp: number | null | undefined) => {
    if (timestamp === null || timestamp === undefined || timestamp === 0) return "N/A"
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const timestampMs = timestamp > 1000000000000 
        ? timestamp // Already in milliseconds
        : timestamp * 1000 // Convert from seconds to milliseconds
      
      // Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      
      return format(bangkokDate, "MMM dd, yyyy")
    } catch (error) {
      console.error("Error formatting date:", timestamp, error)
      return "N/A"
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Reservation Management</h1>
            <p className="text-gray-600">Manage booking requests and status updates</p>
            {newResponsesCount > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {newResponsesCount} new response{newResponsesCount > 1 ? 's' : ''} received
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewResponsesCount(0)
                    setLastCheckedAt(Date.now())
                  }}
                >
                  Mark as read
                </Button>
              </div>
            )}
          </div>
          <Link href="/admin/bookings/archive" prefetch={false}>
            <Button variant="outline">
              <Archive className="w-4 h-4 mr-2" />
              View Archive
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="postponed">Postponed</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by email..."
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      {/* Bookings Table */}
      {bookings.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No bookings found</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event Details
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                    Date/Time
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                    Proposed Date
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                    <th className="px-6 xl:px-8 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bookings.map((booking) => {
                  const hasNewResponse = booking.user_response && booking.response_date && 
                    (booking.response_date * 1000) > lastCheckedAt - 300000 // New if within last 5 minutes
                  
                  return (
                  <tr 
                    key={booking.id} 
                    className={`hover:bg-gray-50 ${hasNewResponse ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                  >
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">{booking.name}</div>
                        {booking.user_response && (
                          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Response
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Mail className="w-3 h-3" />
                        {booking.email}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Phone className="w-3 h-3" />
                        {booking.phone}
                      </div>
                    </td>
                    <td className="px-6 xl:px-8 py-4">
                      <div className="text-sm text-gray-900">{booking.event_type}</div>
                      {booking.organization_type && (
                        <div className="text-sm text-gray-500">{booking.organization_type}</div>
                      )}
                      {booking.participants && (
                        <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                          <Users className="w-3 h-3" />
                          {booking.participants} participants
                        </div>
                      )}
                    </td>
                    <td className="px-6 xl:px-8 py-4 min-w-[180px]">
                      <div className="text-sm text-gray-900">
                        {formatDate(booking.start_date)}
                        {booking.end_date && booking.end_date !== booking.start_date && (
                          <span> - {formatDate(booking.end_date)}</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="whitespace-normal break-words">{formatTimeForDisplay(booking.start_time)} - {formatTimeForDisplay(booking.end_time)}</span>
                      </div>
                    </td>
                    <td className="px-6 xl:px-8 py-4 min-w-[180px] whitespace-normal">
                      {booking.proposed_date ? (
                        <div>
                        <div className="text-sm text-gray-900">
                          {formatDate(booking.proposed_date)}
                          {booking.proposed_end_date && booking.proposed_end_date !== booking.proposed_date && (
                            <span> - {formatDate(booking.proposed_end_date)}</span>
                          )}
                          </div>
                          {/* Parse and display times from user_response */}
                          {booking.user_response && (() => {
                            const startTimeMatch = booking.user_response.match(/Start Time: ([^,)]+)/)
                            const endTimeMatch = booking.user_response.match(/End Time: ([^,)]+)/)
                            if (startTimeMatch || endTimeMatch) {
                              // Parse 24-hour format times from user_response
                              const parseTime = (timeStr: string): string | null => {
                                const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
                                if (match) {
                                  const hours = parseInt(match[1], 10)
                                  const minutes = match[2] || '00'
                                  if (hours >= 0 && hours <= 23 && parseInt(minutes) >= 0 && parseInt(minutes) <= 59) {
                                    return `${hours.toString().padStart(2, '0')}:${minutes}`
                                  }
                                }
                                return null
                              }
                              const startTime = startTimeMatch ? parseTime(startTimeMatch[1].trim()) : null
                              const endTime = endTimeMatch ? parseTime(endTimeMatch[1].trim()) : null
                              return (
                                <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                  <Clock className="w-3 h-3" />
                                  {startTime && endTime 
                                    ? `${formatTimeForDisplay(startTime)} - ${formatTimeForDisplay(endTime)}`
                                    : startTime 
                                      ? formatTimeForDisplay(startTime)
                                      : endTime 
                                        ? formatTimeForDisplay(endTime)
                                        : null}
                                </div>
                              )
                            }
                            return null
                          })()}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">-</div>
                      )}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      {getStatusBadge(booking.status)}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestamp(booking.created_at)}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedBooking(booking)
                            setViewDialogOpen(true)
                            fetchBookingDetails(booking.id)
                          }}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteBooking(booking.id)}
                          disabled={saving}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

          {/* Mobile/Tablet Card View */}
          <div className="lg:hidden space-y-4">
            {bookings.map((booking) => {
              const hasNewResponse = booking.user_response && booking.response_date && 
                (booking.response_date * 1000) > lastCheckedAt - 300000
              
              return (
                <div
                  key={booking.id}
                  className={`bg-white rounded-lg shadow p-4 sm:p-6 ${hasNewResponse ? 'border-l-4 border-l-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900">{booking.name}</h3>
                        {booking.user_response && (
                          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Response
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {booking.email}
                        </div>
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {booking.phone}
                        </div>
                      </div>
                    </div>
                    <div className="ml-2">
                      {getStatusBadge(booking.status)}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Event</div>
                      <div className="text-sm text-gray-900">{booking.event_type}</div>
                      {booking.organization_type && (
                        <div className="text-xs text-gray-500 mt-0.5">{booking.organization_type}</div>
                      )}
                      {booking.participants && (
                        <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                          <Users className="w-3 h-3" />
                          {booking.participants} participants
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Date/Time</div>
                      <div className="text-sm text-gray-900">
                        {formatDate(booking.start_date)}
                        {booking.end_date && booking.end_date !== booking.start_date && (
                          <span> - {formatDate(booking.end_date)}</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        {formatTimeForDisplay(booking.start_time)} - {formatTimeForDisplay(booking.end_time)}
                      </div>
                    </div>

                    {booking.proposed_date && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-1">Proposed Date</div>
                        <div className="text-sm text-gray-900">
                          {formatDate(booking.proposed_date)}
                          {booking.proposed_end_date && booking.proposed_end_date !== booking.proposed_date && (
                            <span> - {formatDate(booking.proposed_end_date)}</span>
                          )}
                        </div>
                        {booking.user_response && (() => {
                          const startTimeMatch = booking.user_response.match(/Start Time: ([^,)]+)/)
                          const endTimeMatch = booking.user_response.match(/End Time: ([^,)]+)/)
                          if (startTimeMatch || endTimeMatch) {
                            const parseTime = (timeStr: string): string | null => {
                              const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
                              if (match) {
                                const hours = parseInt(match[1], 10)
                                const minutes = match[2] || '00'
                                if (hours >= 0 && hours <= 23 && parseInt(minutes) >= 0 && parseInt(minutes) <= 59) {
                                  return `${hours.toString().padStart(2, '0')}:${minutes}`
                                }
                              }
                              return null
                            }
                            const startTime = startTimeMatch ? parseTime(startTimeMatch[1].trim()) : null
                            const endTime = endTimeMatch ? parseTime(endTimeMatch[1].trim()) : null
                            return (
                              <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3 flex-shrink-0" />
                                {startTime && endTime 
                                  ? `${formatTimeForDisplay(startTime)} - ${formatTimeForDisplay(endTime)}`
                                  : startTime 
                                    ? formatTimeForDisplay(startTime)
                                    : endTime 
                                      ? formatTimeForDisplay(endTime)
                                      : null}
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    )}

                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Created</div>
                      <div className="text-sm text-gray-500">{formatTimestamp(booking.created_at)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setSelectedBooking(booking)
                        setViewDialogOpen(true)
                        fetchBookingDetails(booking.id)
                      }}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => handleDeleteBooking(booking.id)}
                      disabled={saving}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* View Booking Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl xl:max-w-6xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              View and manage booking information
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-6">
              {/* Status and Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Status badges - aligned with action buttons */}
                  {getStatusBadge(selectedBooking.status)}
                  {selectedBooking.deposit_verified_at && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Deposit Verified
                    </Badge>
                  )}
                  {selectedBooking.proposed_date && selectedBooking.status === "postponed" && (
                    <div className="text-sm text-gray-600">
                      <div>
                      Proposed Date: {formatDate(selectedBooking.proposed_date)}
                        {selectedBooking.proposed_end_date && selectedBooking.proposed_end_date !== selectedBooking.proposed_date && (
                          <span> - {formatDate(selectedBooking.proposed_end_date)}</span>
                        )}
                      </div>
                      {/* Parse and display times from user_response */}
                      {selectedBooking.user_response && (() => {
                        const startTimeMatch = selectedBooking.user_response.match(/Start Time: ([^,)]+)/)
                        const endTimeMatch = selectedBooking.user_response.match(/End Time: ([^,)]+)/)
                        if (startTimeMatch || endTimeMatch) {
                          // Parse 24-hour format times from user_response
                          const parseTime = (timeStr: string): string | null => {
                            const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
                            if (match) {
                              const hours = parseInt(match[1], 10)
                              const minutes = match[2] || '00'
                              if (hours >= 0 && hours <= 23 && parseInt(minutes) >= 0 && parseInt(minutes) <= 59) {
                                return `${hours.toString().padStart(2, '0')}:${minutes}`
                              }
                            }
                            return null
                          }
                          const startTime = startTimeMatch ? parseTime(startTimeMatch[1].trim()) : null
                          const endTime = endTimeMatch ? parseTime(endTimeMatch[1].trim()) : null
                          return (
                            <div className="text-gray-500 mt-1">
                              {startTime && endTime 
                                ? `Time: ${formatTimeForDisplay(startTime)} - ${formatTimeForDisplay(endTime)}`
                                : startTime 
                                  ? `Start Time: ${formatTimeForDisplay(startTime)}`
                                  : endTime 
                                    ? `End Time: ${formatTimeForDisplay(endTime)}`
                                    : null}
                            </div>
                          )
                        }
                        return null
                      })()}
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    onClick={() => {
                      setStatusDialogOpen(true)
                    }}
                    disabled={selectedBooking.status === "checked-in"}
                    title={selectedBooking.status === "checked-in" ? "Checked-in bookings cannot have their status changed" : ""}
                    className="w-full sm:w-auto"
                  >
                    Update Status
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteBooking(selectedBooking.id)}
                    disabled={saving}
                    className="w-full sm:w-auto"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Booking State Info - Shows warnings and state information */}
              <BookingStateInfo booking={selectedBooking as any} />

              {/* Contact Information */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Contact Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Name</Label>
                    <div className="text-sm text-gray-900">{selectedBooking.name}</div>
                  </div>
                  <div>
                    <Label>Email</Label>
                    <div className="text-sm text-gray-900">{selectedBooking.email}</div>
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <div className="text-sm text-gray-900">{selectedBooking.phone}</div>
                  </div>
                  <div>
                    <Label>Participants</Label>
                    <div className="text-sm text-gray-900">{selectedBooking.participants || "N/A"}</div>
                  </div>
                </div>
              </div>

              {/* Event Details */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Event Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <Label>Event Type</Label>
                    <div className="text-sm text-gray-900">
                      {selectedBooking.event_type}
                      {selectedBooking.other_event_type && ` - ${selectedBooking.other_event_type}`}
                    </div>
                  </div>
                  <div>
                    <Label>Organization Type</Label>
                    <div className="text-sm text-gray-900">{selectedBooking.organization_type || "N/A"}</div>
                  </div>
                  <div>
                    <Label>Date Range</Label>
                    <div className="text-sm text-gray-900">
                      {selectedBooking.date_range ? "Multiple Days" : "Single Day"}
                    </div>
                  </div>
                  <div>
                    <Label>Start Date</Label>
                    <div className="text-sm text-gray-900">{formatDate(selectedBooking.start_date)}</div>
                  </div>
                  {selectedBooking.end_date && (
                    <div>
                      <Label>End Date</Label>
                      <div className="text-sm text-gray-900">{formatDate(selectedBooking.end_date)}</div>
                    </div>
                  )}
                  <div>
                    <Label>Time</Label>
                    <div className="text-sm text-gray-900">
                      {formatTimeForDisplay(selectedBooking.start_time)} - {formatTimeForDisplay(selectedBooking.end_time)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              {(selectedBooking.introduction || selectedBooking.biography || selectedBooking.special_requests) && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Additional Information</h3>
                  {selectedBooking.introduction && (
                    <div className="mb-3">
                      <Label>Introduction</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.introduction}</div>
                    </div>
                  )}
                  {selectedBooking.biography && (
                    <div className="mb-3">
                      <Label>Biography</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.biography}</div>
                    </div>
                  )}
                  {selectedBooking.special_requests && (
                    <div>
                      <Label>Special Requests</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.special_requests}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Notes */}
              {selectedBooking.admin_notes && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Admin Notes</h3>
                  <div className="bg-gray-50 p-3 rounded text-sm text-gray-900">
                    {selectedBooking.admin_notes}
                  </div>
                </div>
              )}

              {/* User Response */}
              {selectedBooking.user_response && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">User Response</h3>
                  <div className="bg-blue-50 p-3 rounded text-sm text-gray-900">
                    {selectedBooking.user_response}
                  </div>
                  {selectedBooking.response_date && (
                    <div className="text-xs text-gray-500 mt-1">
                      Responded: {formatTimestamp(selectedBooking.response_date)}
                    </div>
                  )}
                </div>
              )}

              {/* Status History */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Status History</h3>
                {(() => {
                  const validHistory = statusHistory.filter((history) => history.old_status && history.new_status)
                  return validHistory.length > 0 ? (
                  <div className="space-y-2">
                      {validHistory.map((history) => (
                      <div key={history.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {history.old_status} → {history.new_status}
                          </div>
                          {history.change_reason && (
                            <div className="text-xs text-gray-600 mt-1">{history.change_reason}</div>
                          )}
                          <div className="text-xs text-gray-500 mt-1">
                            {formatTimestamp(history.created_at)}
                            {history.changed_by && ` by ${history.changed_by}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  ) : (
                    <div className="p-3 bg-gray-50 rounded text-sm text-gray-500">
                      No status changes recorded yet.
                </div>
                  )
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Update Action Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-2xl xl:max-w-4xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Admin Action</DialogTitle>
            <DialogDescription>
              {selectedBooking?.status === "checked-in" 
                ? "This booking is checked-in. Status changes are not allowed."
                : "Select an action to take on this booking. An email notification will be sent to the user."}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <form onSubmit={handleActionUpdate} className="space-y-4" data-booking-form="true">
              {(selectedBooking.status as string) === "checked-in" ? (
                <div className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded">
                  <p className="font-medium">This booking is checked-in and cannot have its status changed. Only deletion is allowed for edge cases.</p>
                </div>
                  {/* For checked-in bookings, show only the cancel button */}
                  <div className="flex flex-col sm:flex-row justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStatusDialogOpen(false)}
                      disabled={saving}
                      className="w-full sm:w-auto"
                    >
                      Close
                    </Button>
                </div>
                </div>
              ) : (selectedBooking.status as string) === "paid_deposit" ? (
                // Warning message is shown in the deposit verification section below, so we don't duplicate it here
                null
              ) : (
                <div>
                  <Label htmlFor="action">Select Action *</Label>
                  {(() => {
                    // Get available actions from state machine
                    // Check if booking date is in the past
                    const checkDate = selectedBooking.proposed_date && selectedBooking.status === "postponed" 
                      ? selectedBooking.proposed_date 
                      : selectedBooking.start_date
                    const startTimestamp = calculateStartTimestamp(checkDate, selectedBooking.start_time || null)
                    const now = getBangkokTime()
                    const isDateInPast = startTimestamp < now

                    const availableActions = getAvailableActions(
                      selectedBooking.status as any,
                      Boolean(selectedBooking.proposed_date),
                      Boolean(selectedBooking.deposit_evidence_url),
                      isDateInPast
                    )
                    const acceptAction = availableActions.find(a => a.id === "accept")
                    const rejectAction = availableActions.find(a => a.id === "reject")
                    const postponeAction = availableActions.find(a => a.id === "postpone")
                    
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAction("accept")
                            setSelectedStatusInForm("accepted")
                          }}
                          className={`p-4 rounded-lg border-2 transition-all text-center ${
                            selectedAction === "accept"
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-green-300"
                          } ${!acceptAction ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={saving || !acceptAction}
                          title={!acceptAction ? "Accept action is not available for this status" : ""}
                        >
                          <CheckCircle2 className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "accept" ? "text-green-600" : "text-gray-400"}`} />
                          <div className="font-semibold text-sm">Accept</div>
                          <div className="text-xs text-gray-500 mt-1">Approve booking</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAction("reject")
                            setSelectedStatusInForm("rejected")
                          }}
                          className={`p-4 rounded-lg border-2 transition-all text-center ${
                            selectedAction === "reject"
                              ? "border-red-500 bg-red-50"
                              : "border-gray-200 hover:border-red-300"
                          } ${!rejectAction ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={saving || !rejectAction}
                          title={!rejectAction ? "Reject action is not available for this status" : ""}
                        >
                          <XCircle className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "reject" ? "text-red-600" : "text-gray-400"}`} />
                          <div className="font-semibold text-sm">Reject</div>
                          <div className="text-xs text-gray-500 mt-1">Decline booking</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAction("postpone")
                            setSelectedStatusInForm("postponed")
                          }}
                          className={`p-4 rounded-lg border-2 transition-all text-center ${
                            selectedAction === "postpone"
                              ? "border-orange-500 bg-orange-50"
                              : "border-gray-200 hover:border-orange-300"
                          } ${!postponeAction ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={saving || !postponeAction}
                          title={!postponeAction ? "Postpone action is not available for this status" : ""}
                        >
                          <CalendarX className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "postpone" ? "text-orange-600" : "text-gray-400"}`} />
                          <div className="font-semibold text-sm">Postpone</div>
                          <div className="text-xs text-gray-500 mt-1">Request new date</div>
                        </button>
                      </div>
                    )
                  })()}
                  <input type="hidden" name="action" value={selectedAction || ""} />
                  {selectedAction === "postpone" && selectedBooking.status === "postponed" && (
                    <div className="mt-3 bg-orange-50 border border-orange-200 rounded p-3">
                      <p className="text-sm text-orange-800">
                        ℹ️ This will clear the user's current proposal and request a new date proposal.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* Change Reason and Admin Notes - Hide for checked-in bookings */}
              {selectedBooking.status !== "checked-in" && (
              <div>
                <Label htmlFor="change_reason">Change Reason</Label>
                <Textarea
                  id="change_reason"
                  name="change_reason"
                  placeholder="Reason for status change (will be included in email)"
                  rows={3}
                  disabled={saving}
                />
              </div>
              )}
              {selectedBooking && (() => {
                const currentStatus = selectedStatusInForm || selectedBooking.status
                
                // Show deposit verification section for paid_deposit status
                // Always show when booking status is paid_deposit, regardless of action selection
                if (selectedBooking.status === "paid_deposit") {
                  return (
                    <div className="space-y-4 border-t pt-4">
                      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                        <p className="text-sm text-yellow-800">
                          ⚠️ <strong>Deposit Verification Required:</strong> Please verify or reject the deposit evidence below. Accept and Postpone actions are disabled to prevent flow disruption. You can still reject the entire booking if needed.
                        </p>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded p-4">
                        <h4 className="font-semibold text-purple-900 mb-2">Deposit Verification</h4>
                        {selectedBooking.deposit_evidence_url ? (
                      <div className="space-y-3">
                            <div>
                              <Label>Deposit Evidence</Label>
                              <a 
                                href={selectedBooking.deposit_evidence_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline block mt-1"
                              >
                                View Deposit Evidence
                              </a>
                          </div>
                            {selectedBooking.deposit_verified_at ? (
                              <div className="bg-green-50 border border-green-200 rounded p-3">
                                <p className="text-sm text-green-800">
                                  ✓ Verified by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                        </p>
                      </div>
                            ) : (
                              <div className="space-y-3">
                          <div>
                                  <Label htmlFor={`deposit_verified_by_${selectedBooking.id}`}>Verified By *</Label>
                            <Input
                                    id={`deposit_verified_by_${selectedBooking.id}`}
                                    name="deposit_verified_by"
                                    placeholder="Admin name/email"
                              disabled={saving}
                                    required={currentStatus === "checked-in"}
                                    data-booking-id={selectedBooking.id}
                            />
                          </div>
                                <input type="hidden" name="verify_deposit" value="true" />
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    onClick={async () => {
                                      if (!selectedBooking || saving) return
                                      setSaving(true)
                                      
                                      // Get form values - use more reliable selectors
                                      // Use booking-specific ID to avoid conflicts with multiple open dialogs
                                      const depositVerifiedByInput = document.querySelector(
                                        `#deposit_verified_by_${selectedBooking.id}, input[data-booking-id="${selectedBooking.id}"][name="deposit_verified_by"]`
                                      ) as HTMLInputElement || 
                                      document.getElementById("deposit_verified_by") as HTMLInputElement
                                      
                                      // Fallback: scope to the current dialog
                                      const currentDialog = !depositVerifiedByInput 
                                        ? (document.querySelector('[role="dialog"]:not([aria-hidden="true"])') as HTMLElement)
                                        : null
                                      
                                      const finalDepositVerifiedByInput = depositVerifiedByInput || 
                                        (currentDialog 
                                          ? (currentDialog.querySelector('#deposit_verified_by') as HTMLInputElement)
                                          : null)
                                      
                                      if (!finalDepositVerifiedByInput) {
                                        toast.error("Could not find 'Verified By' input field. Please refresh the page.")
                                        console.error("Deposit verification: deposit_verified_by input not found", {
                                          bookingId: selectedBooking.id,
                                          hasCurrentDialog: !!currentDialog,
                                          allInputs: Array.from(document.querySelectorAll('[name="deposit_verified_by"]')).length
                                        })
                                        setSaving(false)
                                        return
                                      }
                                      
                                      const depositVerifiedBy = finalDepositVerifiedByInput.value?.trim() || ""
                                      
                                      if (!depositVerifiedBy) {
                                        toast.error("Please enter 'Verified By' field before verifying deposit")
                                        setSaving(false)
                                        return
                                      }
                                      
                                      // Get change reason and admin notes from the form
                                      // Use the form with data attribute or closest form, scoped to current dialog
                                      const form = currentDialog
                                        ? (currentDialog.querySelector('form[data-booking-form="true"]') as HTMLFormElement ||
                                           finalDepositVerifiedByInput.closest('form') as HTMLFormElement ||
                                           currentDialog.querySelector('form') as HTMLFormElement)
                                        : (document.querySelector('form[data-booking-form="true"]') as HTMLFormElement ||
                                           finalDepositVerifiedByInput.closest('form') as HTMLFormElement ||
                                           document.querySelector('form') as HTMLFormElement)
                                      
                                      const changeReasonInput = form?.querySelector('[name="change_reason"]') as HTMLTextAreaElement
                                      const changeReason = changeReasonInput?.value?.trim() || "Deposit verified and booking checked in"
                                      const adminNotesInput = form?.querySelector('[name="admin_notes"]') as HTMLTextAreaElement
                                      const adminNotes = adminNotesInput?.value?.trim() || ""
                                      
                                      try {
                                        const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({
                                            status: "checked-in",
                                            changeReason: changeReason || "Deposit verified and booking checked in",
                                            adminNotes: adminNotes || null,
                                            proposedDate: null,
                                            depositVerifiedBy: depositVerifiedBy,
                                          }),
                                        })
                                        
                                        const json = await response.json()
                                        
                                        if (json.success) {
                                          toast.success("Deposit verified and booking checked in successfully. Email notification sent.")
                                          setStatusDialogOpen(false)
                                          setSelectedStatusInForm("")
                                          fetchBookings()
                                          if (viewDialogOpen) {
                                            fetchBookingDetails(selectedBooking.id)
                                          }
                                        } else {
                                          // Extract detailed error message
                                          const errorMessage = json.error?.message || json.error || "Failed to verify deposit and check in"
                                          const errorDetails = json.error?.errors ? ` Errors: ${Array.isArray(json.error.errors) ? json.error.errors.join(', ') : JSON.stringify(json.error.errors)}` : ""
                                          toast.error(`${errorMessage}${errorDetails}`)
                                          console.error("Deposit verification failed:", json)
                                        }
                                      } catch (error) {
                                        const errorMessage = error instanceof Error ? error.message : "Failed to verify deposit and check in"
                                        toast.error(errorMessage)
                                        console.error("Deposit verification error:", error)
                                      } finally {
                                        setSaving(false)
                                      }
                                    }}
                                    className="flex-1"
                                disabled={saving}
                                  >
                                    <CheckCircle2 className="w-4 h-4 mr-2" />
                                    Verify Deposit & Check In
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={async () => {
                                      if (!selectedBooking || saving) return
                                      
                                      // Confirm rejection
                                      if (!confirm("Are you sure you want to reject this deposit evidence? The user will need to upload a new deposit.")) {
                                        return
                                      }
                                      
                                      setSaving(true)
                                      
                                      // Get form values - use more reliable selectors
                                      // Scope to the current dialog to avoid conflicts with multiple open dialogs
                                      const currentDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])') as HTMLElement
                                      const form = currentDialog
                                        ? (currentDialog.querySelector('form[data-booking-form="true"]') as HTMLFormElement ||
                                           currentDialog.querySelector('form') as HTMLFormElement)
                                        : (document.querySelector('form[data-booking-form="true"]') as HTMLFormElement ||
                                           document.querySelector('form') as HTMLFormElement)
                                      
                                      const changeReasonInput = form?.querySelector('[name="change_reason"]') as HTMLTextAreaElement
                                      const changeReason = changeReasonInput?.value?.trim() || "Deposit evidence rejected by admin"
                                      const adminNotesInput = form?.querySelector('[name="admin_notes"]') as HTMLTextAreaElement
                                      const adminNotes = adminNotesInput?.value?.trim() || ""
                                      
                                      try {
                                        const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({
                                            status: "pending_deposit",
                                            changeReason: changeReason,
                                            adminNotes: adminNotes || null,
                                            proposedDate: null,
                                            depositVerifiedBy: null,
                                          }),
                                        })
                                        
                                        const json = await response.json()
                                        
                                        if (json.success) {
                                          toast.success("Deposit rejected. User will receive a new deposit upload link.")
                                          setStatusDialogOpen(false)
                                          setSelectedStatusInForm("")
                                          fetchBookings()
                                          if (viewDialogOpen) {
                                            fetchBookingDetails(selectedBooking.id)
                                          }
                                        } else {
                                          const errorMessage = json.error?.message || "Failed to reject deposit"
                                          toast.error(errorMessage)
                                        }
                                      } catch (error) {
                                        toast.error("Failed to reject deposit")
                                        console.error(error)
                                      } finally {
                                        setSaving(false)
                                      }
                                    }}
                                    variant="destructive"
                                    className="flex-1"
                                    disabled={saving}
                                  >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Reject Deposit
                                  </Button>
                                </div>
                            </div>
                          )}
                          </div>
                        ) : (
                          <p className="text-sm text-purple-800">No deposit evidence uploaded yet.</p>
                        )}
                          </div>
                      {selectedBooking.deposit_verified_at && (
                        <input type="hidden" name="check_in" value="true" />
                      )}
                    </div>
                  )
                }
                
                // Show info for postpone action
                if (selectedAction === "postpone") {
                  return (
                    <div className="bg-orange-50 border border-orange-200 rounded p-4">
                      <p className="text-sm text-orange-800">
                        When you select "Postpone", the user will be asked to propose a new date. Admin no longer proposes dates.
                        {selectedBooking.status === "postponed" && (
                          <span className="block mt-2 font-semibold">
                            ⚠️ This will clear the user's current proposal and request a new one.
                          </span>
                        )}
                      </p>
                    </div>
                  )
                }
                
                return null
              })()}
              {/* Admin Notes - Hide for checked-in bookings */}
              {selectedBooking.status !== "checked-in" && (
              <div>
                <Label htmlFor="admin_notes">Admin Notes (internal only)</Label>
                <Textarea
                  id="admin_notes"
                  name="admin_notes"
                  placeholder="Internal notes (not sent to user)"
                  rows={3}
                  defaultValue={selectedBooking.admin_notes || ""}
                  disabled={saving}
                />
              </div>
              )}
              <div className="flex flex-col sm:flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStatusDialogOpen(false)
                    setSelectedAction(null)
                    setSelectedStatusInForm("")
                  }}
                  disabled={saving}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              {(selectedBooking.status as string) !== "checked-in" && (
                <Button 
                  type="submit" 
                  disabled={
                    saving || 
                    !selectedAction || 
                    (selectedBooking.status === "paid_deposit" && selectedAction !== "reject")
                  }
                  className="w-full sm:w-auto"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : selectedAction ? (
                    `Confirm ${selectedAction === "accept" ? "Accept" : selectedAction === "reject" ? "Reject" : "Postpone"}`
                  ) : (
                    "Select Action First"
                  )}
                </Button>
              )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Action Confirmation Dialog */}
      <ActionConfirmationDialog
        open={confirmationDialogOpen}
        onOpenChange={setConfirmationDialogOpen}
        action={pendingAction}
        booking={selectedBooking}
        validation={pendingValidation}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          setConfirmationDialogOpen(false)
          setPendingAction(null)
          setPendingValidation(null)
        }}
        isLoading={saving || actionLoading}
      />
    </div>
  )
}

