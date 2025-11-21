"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { redirect } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Loader2,
  Calendar,
  Mail,
  Phone,
  Users,
  Clock,
  Eye,
  Archive,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import Link from "next/link"
import { BookingStateInfo } from "@/components/admin/BookingStateInfo"
import { ActionConfirmationDialog } from "@/components/admin/ActionConfirmationDialog"
import { RestorationConfirmationDialog } from "../../components/RestorationConfirmationDialog"
import { DeleteConfirmationDialog } from "@/components/admin/DeleteConfirmationDialog"
import { useBookingActions } from "@/hooks/useBookingActions"
import { getAvailableActions, type ActionDefinition } from "@/lib/booking-state-machine"
import { isValidStatusTransition } from "@/lib/booking-validations"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { TimePicker } from "@/components/ui/time-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { useInfiniteAdminBookings, type Booking as BookingType } from "@/hooks/useInfiniteAdminBookings"
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll"
import { SearchInputWithHistory } from "@/components/admin/SearchInputWithHistory"

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

// Use Booking type from hook
type Booking = BookingType

interface StatusHistory {
  id: string
  booking_id: string
  old_status: string
  new_status: string
  changed_by: string | null
  change_reason: string | null
  created_at: number
}

export default function BookingsArchivePage() {
  const { data: session, status } = useSession()
  const [pageSize, setPageSize] = useState(25)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([])
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailFilter, setEmailFilter] = useState("")
  const [referenceNumberFilter, setReferenceNumberFilter] = useState("")
  const [nameFilter, setNameFilter] = useState("")
  const [phoneFilter, setPhoneFilter] = useState("")
  // Debounced search filters (used in API calls)
  const [debouncedEmailFilter, setDebouncedEmailFilter] = useState("")
  const [debouncedReferenceNumberFilter, setDebouncedReferenceNumberFilter] = useState("")
  const [debouncedNameFilter, setDebouncedNameFilter] = useState("")
  const [debouncedPhoneFilter, setDebouncedPhoneFilter] = useState("")
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all")
  const [depositStatusFilter, setDepositStatusFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"created_at" | "start_date" | "name" | "updated_at">("created_at")
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC")
  const [saving, setSaving] = useState(false)
  const [newStatus, setNewStatus] = useState<string>("")
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<ActionDefinition | null>(null)
  const [pendingValidation, setPendingValidation] = useState<any>(null)
  const [selectedAction, setSelectedAction] = useState<"accept" | "reject" | null>(null)
  // Date selection for restoration
  const [newStartDate, setNewStartDate] = useState<Date | null>(null)
  const [newEndDate, setNewEndDate] = useState<Date | null>(null)
  const [newStartTime, setNewStartTime] = useState<string>("")
  const [newEndTime, setNewEndTime] = useState<string>("")
  const [dateRangeToggle, setDateRangeToggle] = useState<"single" | "multiple">("single")
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date())
  // Unavailable dates for restoration calendar (excludes current booking's dates)
  const [unavailableDatesForRestoration, setUnavailableDatesForRestoration] = useState<Set<string>>(new Set())
  const [unavailableTimeRangesForRestoration, setUnavailableTimeRangesForRestoration] = useState<Array<{
    date: string
    startTime: string | null
    endTime: string | null
    startDate: number
    endDate: number
  }>>([])
  // Deposit verification
  const [verifyDeposit, setVerifyDeposit] = useState(false)
  // Restoration confirmation dialog
  const [restorationDialogOpen, setRestorationDialogOpen] = useState(false)
  const [pendingRestoreStatus, setPendingRestoreStatus] = useState<"pending_deposit" | "paid_deposit" | "confirmed" | null>(null)
  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null)
  
  // Initialize booking actions hook
  const {
    isLoading: actionLoading,
    validationResult,
    getActions,
    validateActionBeforeExecution,
    executeAction,
  } = useBookingActions({
    onSuccess: (updatedBooking) => {
      // CRITICAL: Close ALL dialogs when booking is cancelled or restored
      // This prevents showing stale data in modals after status changes
      const newStatus = updatedBooking?.status || selectedBooking?.status
      const isCancelled = newStatus === "cancelled"
      const isRestoration = selectedBooking?.status === "cancelled" && 
        (newStatus === "pending_deposit" || newStatus === "paid_deposit" || newStatus === "confirmed")
      
      setStatusDialogOpen(false)
      setRestorationDialogOpen(false)
      setPendingRestoreStatus(null)
      setNewStatus("")
      setProposedDateRange("single")
      setSelectedAction(null)
      fetchBookings()
      
      // Close view dialog if booking is cancelled or restored
      // This ensures user sees updated booking list immediately without stale modal data
      // Restored bookings move from archive to active list, so modal should close
      if (isCancelled || isRestoration) {
        setViewDialogOpen(false)
        setSelectedBooking(null)
      } else if (viewDialogOpen) {
        // For other status changes, refresh booking details in view dialog
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

  // Event types for filter dropdown
  const eventTypes = [
    { value: "all", label: "All Event Types" },
    { value: "Arts & Design Coaching", label: "Arts & Design Coaching Workshop" },
    { value: "Seminar & Workshop", label: "Seminar & Workshop" },
    { value: "Family Gathering", label: "Family Gathering" },
    { value: "Holiday Festive", label: "Holiday Festive" },
    { value: "Other", label: "Other" },
  ]

  // Search handlers - trigger search immediately on Enter key
  const handleReferenceNumberSearch = (value: string) => {
    setDebouncedReferenceNumberFilter(value)
  }

  // Debounced search handlers - trigger search automatically while typing
  const handleReferenceNumberDebouncedSearch = (value: string) => {
    setDebouncedReferenceNumberFilter(value)
  }

  const handleEmailSearch = (value: string) => {
    setDebouncedEmailFilter(value)
  }

  const handleEmailDebouncedSearch = (value: string) => {
    setDebouncedEmailFilter(value)
  }

  const handleNameSearch = (value: string) => {
    setDebouncedNameFilter(value)
  }

  const handleNameDebouncedSearch = (value: string) => {
    setDebouncedNameFilter(value)
  }

  const handlePhoneSearch = (value: string) => {
    setDebouncedPhoneFilter(value)
  }

  const handlePhoneDebouncedSearch = (value: string) => {
    setDebouncedPhoneFilter(value)
  }

  // Build base endpoint with filters (without limit/offset for infinite scroll)
  // Use debounced values for search inputs to prevent refetch on every keystroke
  const baseEndpoint = useMemo(() => {
    const params = new URLSearchParams()
    params.append("archive", "true") // Request archive bookings
    if (statusFilter !== "all") {
      params.append("status", statusFilter)
    }
    if (debouncedEmailFilter) {
      params.append("email", debouncedEmailFilter)
    }
    if (debouncedReferenceNumberFilter) {
      params.append("referenceNumber", debouncedReferenceNumberFilter)
    }
    if (debouncedNameFilter) {
      params.append("name", debouncedNameFilter)
    }
    if (debouncedPhoneFilter) {
      params.append("phone", debouncedPhoneFilter)
    }
    if (eventTypeFilter !== "all") {
      params.append("eventType", eventTypeFilter)
    }
    params.append("sortBy", sortBy)
    params.append("sortOrder", sortOrder)
    return buildApiUrl(API_PATHS.adminBookings, Object.fromEntries(params))
  }, [statusFilter, debouncedEmailFilter, debouncedReferenceNumberFilter, debouncedNameFilter, debouncedPhoneFilter, eventTypeFilter, sortBy, sortOrder])
  
  // Use infinite scroll hook for bookings
  const {
    bookings,
    total,
    loading,
    isFetching,
    hasMore,
    loadMore,
    refetch: fetchBookings,
    updateItem,
    removeItem,
    replaceItem
  } = useInfiniteAdminBookings({
    baseEndpoint,
    pageSize,
    refetchInterval: 60000, // Increase to 60 seconds to reduce request frequency
    enabled: !!session,
    isDialogOpen: () => viewDialogOpen || statusDialogOpen,
  })
  
  // Infinite scroll setup
  const { elementRef: scrollSentinelRef } = useInfiniteScroll({
    hasMore,
    loading,
    onLoadMore: loadMore,
    threshold: 200,
    enabled: !!session && !viewDialogOpen && !statusDialogOpen,
  })

  // Client-side filtering for deposit status (since API doesn't support it)
  // Note: This works with infinite scroll but may show fewer items per "page"
  // since filtering happens after loading
  const filteredBookings = useMemo(() => {
    if (depositStatusFilter === "all") {
      return bookings
    }
    return bookings.filter((booking) => {
      switch (depositStatusFilter) {
        case "no_deposit":
          return !booking.deposit_evidence_url && !booking.deposit_verified_at
        case "deposit_available":
          return booking.deposit_evidence_url && !booking.deposit_verified_at
        case "deposit_verified":
          return booking.deposit_evidence_url && booking.deposit_verified_at
        case "deposit_verified_other_channel":
          return !booking.deposit_evidence_url && booking.deposit_verified_at && booking.deposit_verified_from_other_channel
        default:
          return true
      }
    })
  }, [bookings, depositStatusFilter])
  
  // When deposit filter is active, we still load more but filter client-side
  // This means hasMore might be true even if filtered results are empty
  const displayTotal = depositStatusFilter === "all" ? total : filteredBookings.length
  const displayHasMore = depositStatusFilter === "all" ? hasMore : (filteredBookings.length < bookings.length || hasMore)

  // The hook automatically refetches when endpoint changes (which includes all filters)
  // No need for manual useEffect here

  // Fetch unavailable dates for restoration calendar (excludes current booking's dates)
  const fetchUnavailableDatesForRestoration = useCallback(async (bookingId: string | null) => {
    try {
      const url = bookingId 
        ? buildApiUrl(API_PATHS.bookingAvailability, { bookingId })
        : API_PATHS.bookingAvailability
      
      const response = await fetch(url)
      const json = await response.json()
      
      if (json.success) {
        const unavailableDatesArray = json.data?.unavailableDates || json.unavailableDates || []
        const unavailableTimeRangesArray = json.data?.unavailableTimeRanges || json.unavailableTimeRanges || []
        setUnavailableDatesForRestoration(new Set(unavailableDatesArray))
        setUnavailableTimeRangesForRestoration(unavailableTimeRangesArray)
        console.log(`[Archive] Unavailable dates fetched for restoration (excluding booking ${bookingId || 'none'}): ${unavailableDatesArray.length} dates`)
      } else {
        console.error("[Archive] Failed to fetch unavailable dates for restoration:", json)
        setUnavailableDatesForRestoration(new Set())
        setUnavailableTimeRangesForRestoration([])
      }
    } catch (error) {
      console.error("Failed to fetch unavailable dates for restoration:", error)
      setUnavailableDatesForRestoration(new Set())
      setUnavailableTimeRangesForRestoration([])
    }
  }, [])

  // Fetch unavailable dates when status dialog opens for cancelled bookings (restoration)
  useEffect(() => {
    if (statusDialogOpen && selectedBooking?.status === "cancelled" && selectedBooking?.id) {
      // Fetch unavailable dates excluding current booking's dates
      fetchUnavailableDatesForRestoration(selectedBooking.id)
    } else if (!statusDialogOpen) {
      // Clear unavailable dates when dialog closes
      setUnavailableDatesForRestoration(new Set())
      setUnavailableTimeRangesForRestoration([])
    }
  }, [statusDialogOpen, selectedBooking?.status, selectedBooking?.id, fetchUnavailableDatesForRestoration])

  // Fix accessibility issue: When restoration dialog opens, blur focused elements in status dialog
  // This prevents aria-hidden violation when status dialog is hidden behind restoration dialog
  useEffect(() => {
    if (restorationDialogOpen && statusDialogOpen) {
      // When restoration dialog opens, blur any focused elements in the status dialog
      // This prevents the accessibility violation where aria-hidden is set on a dialog with focused elements
      const blurFocusedElements = () => {
        // Find all dialogs that are not the restoration dialog (which is the last one)
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        if (dialogs.length > 1) {
          // The status dialog should be the one before the restoration dialog
          const statusDialog = dialogs[dialogs.length - 2] as HTMLElement
          if (statusDialog) {
            const focusedElement = statusDialog.querySelector(':focus') as HTMLElement
            if (focusedElement && focusedElement.blur) {
              focusedElement.blur()
            }
          }
        }
      }
      // Use setTimeout to ensure the restoration dialog has rendered and set aria-hidden
      const timeoutId = setTimeout(blurFocusedElements, 0)
      return () => clearTimeout(timeoutId)
    }
  }, [restorationDialogOpen, statusDialogOpen])

  // Overlapping bookings state (for display in booking details)
  const [overlappingBookings, setOverlappingBookings] = useState<Array<{
    id: string
    name: string
    email: string
    reference_number: string | null
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    status: string
    created_at: number
  }>>([])
  const [hasConfirmedOverlap, setHasConfirmedOverlap] = useState(false)

  // Fetch booking details and history
  const fetchBookingDetails = async (bookingId: string) => {
    try {
      const response = await fetch(API_PATHS.adminBooking(bookingId))
      const json = await response.json()
      
      if (json.success && json.data) {
        const booking = json.data.booking
        const statusHistory = json.data.statusHistory || []
        
        if (booking) {
          setSelectedBooking(booking)
          setStatusHistory(statusHistory)
          // Store overlapping bookings and confirmed overlap status
          setOverlappingBookings(json.data.overlappingBookings || [])
          setHasConfirmedOverlap(json.data.hasConfirmedOverlap || false)
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

  // Handle delete booking - open confirmation dialog
  const handleDeleteBooking = (bookingId: string) => {
    const booking = bookings.find(b => b.id === bookingId)
    if (booking) {
      setBookingToDelete(booking)
      setDeleteDialogOpen(true)
    }
  }

  // Confirm delete booking - actually perform the deletion
  const confirmDeleteBooking = async () => {
    if (!bookingToDelete) return

    setSaving(true)
    try {
      const response = await fetch(API_PATHS.adminBooking(bookingToDelete.id), {
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
        toast.error(errorMessage, {
          id: `delete-error-${bookingToDelete.id}`,
        })
        return
      }

      // Check if response has content before parsing JSON
      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        toast.error("Invalid response from server", {
          id: `delete-error-${bookingToDelete.id}`,
        })
        return
      }

      const text = await response.text()
      if (!text) {
        toast.error("Empty response from server", {
          id: `delete-error-${bookingToDelete.id}`,
        })
        return
      }

      const data = JSON.parse(text)
      if (data.success) {
        toast.success("Booking deleted successfully. Notifications sent if applicable.", {
          id: `delete-success-${bookingToDelete.id}`,
        })
        setViewDialogOpen(false)
        setStatusDialogOpen(false)
        setDeleteDialogOpen(false)
        setBookingToDelete(null)
        fetchBookings()
      } else {
        toast.error(data.error || "Failed to delete booking", {
          id: `delete-error-${bookingToDelete.id}`,
        })
      }
    } catch (error) {
      toast.error("Failed to delete booking", {
        id: `delete-error-${bookingToDelete.id}`,
      })
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Handle status update with state machine validation
  const handleStatusUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedBooking) return

    // Finished bookings cannot be re-opened
    if (selectedBooking.status === "finished") {
      toast.error("Finished bookings cannot be re-opened. The event has already completed.")
      return
    }

    setSaving(true)
    const formData = new FormData(e.currentTarget)
    const statusValue = formData.get("status") as string
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string

    // For archive restoration, check if transition is valid directly
    // (cancelled bookings don't have actions in state machine, but can be restored)
    const transitionCheck = isValidStatusTransition(selectedBooking.status, statusValue)
    
    if (!transitionCheck.valid) {
      toast.error(transitionCheck.reason || `Cannot transition from "${selectedBooking.status}" to "${statusValue}". This transition is not allowed.`)
      setSaving(false)
      return
    }

    // PAST DATE VALIDATION: Check if booking date is in the past
    // This applies to ALL archive bookings regardless of status
    try {
      const { calculateStartTimestamp } = await import("@/lib/booking-validations")
      const { getBangkokTime, createBangkokTimestamp } = await import("@/lib/timezone")
      
      // Determine which dates to check (new dates if provided, otherwise current booking dates)
      const checkStartDate = newStartDate 
        ? createBangkokTimestamp(dateToBangkokDateString(newStartDate))
        : selectedBooking.start_date
      const checkStartTime = newStartTime || selectedBooking.start_time || null
      
      // Calculate the actual start timestamp
      const startTimestamp = calculateStartTimestamp(checkStartDate, checkStartTime)
      const bangkokNow = getBangkokTime()
      const isPastDate = startTimestamp < bangkokNow
      
      if (isPastDate) {
        // For pending_deposit: Prevent restoration with past dates (token would be expired)
        if (statusValue === "pending_deposit") {
          toast.error("Cannot restore to Pending Deposit with a past booking date/time. The deposit upload token would expire immediately. Please either: (1) Restore to Paid Deposit or Confirmed instead, or (2) Change the booking date/time to a future date/time.", {
            duration: 8000,
          })
          setSaving(false)
          return
        }
        
        // For paid_deposit or confirmed: Warn but allow (for historical corrections)
        if (statusValue === "paid_deposit" || statusValue === "confirmed") {
          const warningMessage = `⚠️ Warning: This booking date/time is in the past (including today if the time has passed).\n\nThis is allowed for:\n• Historical record-keeping\n• Same-day bookings that were processed\n• Correcting booking dates\n\nAre you sure you want to proceed with this past date/time?`
          if (!confirm(warningMessage)) {
            setSaving(false)
            return
          }
        }
      }
    } catch (error) {
      console.error("Error checking past date validation:", error)
      // Continue anyway - backend will also validate
    }

    // Note: Overlap checking is handled server-side by the API endpoint
    // The API will validate overlaps when updating the booking status

    // Execute the action
    try {
      // Prepare date change payload if dates are provided
      const dateChangePayload: any = {}
      if (newStartDate) {
        dateChangePayload.newStartDate = dateToBangkokDateString(newStartDate)
      }
      if (dateRangeToggle === "multiple" && newEndDate) {
        dateChangePayload.newEndDate = dateToBangkokDateString(newEndDate)
      } else if (dateRangeToggle === "single") {
        dateChangePayload.newEndDate = null
      }
      if (newStartTime) {
        dateChangePayload.newStartTime = newStartTime
      }
      if (newEndTime) {
        dateChangePayload.newEndTime = newEndTime
      }

      // Prepare deposit verification payload
      // If deposit evidence exists and admin verifies it when restoring to confirmed/paid_deposit
      const depositPayload: any = {}
      if (selectedBooking.deposit_evidence_url && 
          verifyDeposit && 
          (statusValue === "confirmed" || statusValue === "paid_deposit")) {
        // Use admin email/name from session, or fallback to "Admin"
        depositPayload.depositVerifiedBy = session?.user?.email || session?.user?.name || "Admin"
      }

      const response = await fetch(API_PATHS.adminBooking(selectedBooking.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusValue,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: null, // Archive page doesn't propose dates
          ...dateChangePayload,
          ...depositPayload,
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        const updatedBooking = json.data?.booking || json.booking
        const newStatus = updatedBooking?.status || statusValue
        
        toast.success("Booking status updated successfully. Email notification sent.")
        
        // CRITICAL: Close ALL dialogs when booking is cancelled or restored
        // This prevents showing stale data in modals after status changes
        const isCancelled = newStatus === "cancelled"
        const isRestoration = selectedBooking?.status === "cancelled" && 
          (newStatus === "pending_deposit" || newStatus === "paid_deposit" || newStatus === "confirmed")
        
        setStatusDialogOpen(false)
        setConfirmationDialogOpen(false)
        setRestorationDialogOpen(false)
        setPendingAction(null)
        setPendingValidation(null)
        setPendingRestoreStatus(null)
        fetchBookings()
        
        // Close view dialog if booking is cancelled or restored
        // This ensures user sees updated booking list immediately without stale modal data
        // Restored bookings move from archive to active list, so modal should close
        if (isCancelled || isRestoration) {
          setViewDialogOpen(false)
          setSelectedBooking(null)
        } else if (viewDialogOpen) {
          // For other status changes, refresh booking details in view dialog
          fetchBookingDetails(selectedBooking.id)
        }
      } else {
        // Parse error for better user experience
        const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
        const errorText = json.error?.message || "Failed to update booking status"
        const parsedError = parseBackendError(errorText, response)
        const errorMessage = getErrorMessageWithGuidance(parsedError)
        
        // Check if error is due to booking overlap
        if (json.error?.code === 'BOOKING_OVERLAP' || errorText.toLowerCase().includes('overlap')) {
          const overlappingBookings = json.data?.overlappingBookings || []
          if (overlappingBookings.length > 0) {
            // Show detailed overlap error with booking information
            const overlapDetails = overlappingBookings.map((b: any, idx: number) => {
              const ref = b.reference_number || "N/A"
              const startDateStr = b.start_date ? formatDate(b.start_date) : "N/A"
              const endDateStr = b.end_date && b.end_date !== b.start_date ? ` - ${formatDate(b.end_date)}` : ""
              const timeStr = b.start_time ? `, ${formatTimeForDisplay(b.start_time)}${b.end_time ? ` - ${formatTimeForDisplay(b.end_time)}` : ""}` : ""
              return `${idx + 1}. ${ref} (${b.name || "Unknown"}) - ${startDateStr}${endDateStr}${timeStr}`
            }).join("\n")
            
            toast.error(
              `Cannot confirm booking: Overlaps with ${overlappingBookings.length} confirmed booking(s).\n\n${overlapDetails}`,
              {
                duration: 10000,
              }
            )
          } else {
            toast.error(errorText, { duration: 8000 })
          }
        } else if (parsedError.type === 'conflict') {
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

  // Handle confirmation dialog confirm (for warnings/overlaps)
  const handleConfirmAction = async () => {
    if (!selectedBooking) return

    const form = document.querySelector('form[onSubmit]') as HTMLFormElement
    const formData = form ? new FormData(form) : new FormData()
    const statusValue = formData.get("status") as string || (pendingAction?.targetStatus)
    const changeReason = formData.get("change_reason") as string

    // PAST DATE VALIDATION: Check if booking date is in the past
    // This applies to ALL archive bookings regardless of status
    try {
      const { calculateStartTimestamp } = await import("@/lib/booking-validations")
      const { getBangkokTime, createBangkokTimestamp } = await import("@/lib/timezone")
      
      // Determine which dates to check (new dates if provided, otherwise current booking dates)
      const checkStartDate = newStartDate 
        ? createBangkokTimestamp(dateToBangkokDateString(newStartDate))
        : selectedBooking.start_date
      const checkStartTime = newStartTime || selectedBooking.start_time || null
      
      // Calculate the actual start timestamp
      const startTimestamp = calculateStartTimestamp(checkStartDate, checkStartTime)
      const bangkokNow = getBangkokTime()
      const isPastDate = startTimestamp < bangkokNow
      
      if (isPastDate) {
        // For pending_deposit: Prevent restoration with past dates (token would be expired)
        if (statusValue === "pending_deposit") {
          toast.error("Cannot restore to Pending Deposit with a past booking date/time. The deposit upload token would expire immediately. Please either: (1) Restore to Paid Deposit or Confirmed instead, or (2) Change the booking date/time to a future date/time.", {
            duration: 8000,
          })
          setConfirmationDialogOpen(false)
          return
        }
        
        // For paid_deposit or confirmed: Warn but allow (for historical corrections)
        if (statusValue === "paid_deposit" || statusValue === "confirmed") {
          const warningMessage = `⚠️ Warning: This booking date/time is in the past (including today if the time has passed).\n\nThis is allowed for:\n• Historical record-keeping\n• Same-day bookings that were processed\n• Correcting booking dates\n\nAre you sure you want to proceed with this past date/time?`
          if (!confirm(warningMessage)) {
            setConfirmationDialogOpen(false)
            return
          }
        }
      }
    } catch (error) {
      console.error("Error checking past date validation:", error)
      // Continue anyway - backend will also validate
    }

    setSaving(true)
    const adminNotes = formData.get("admin_notes") as string

    if (!statusValue) {
      toast.error("Please select a status")
      setSaving(false)
      return
    }

    // Prepare date change payload if dates are provided
    const dateChangePayload: any = {}
    if (newStartDate) {
      dateChangePayload.newStartDate = dateToBangkokDateString(newStartDate)
    }
    if (dateRangeToggle === "multiple" && newEndDate) {
      dateChangePayload.newEndDate = dateToBangkokDateString(newEndDate)
    } else if (dateRangeToggle === "single") {
      dateChangePayload.newEndDate = null
    }
    if (newStartTime) {
      dateChangePayload.newStartTime = newStartTime
    }
    if (newEndTime) {
      dateChangePayload.newEndTime = newEndTime
    }

    // Prepare deposit verification payload
    // If deposit evidence exists and admin verifies it when restoring to confirmed/paid_deposit
    const depositPayload: any = {}
    if (selectedBooking?.deposit_evidence_url && 
        verifyDeposit && 
        (statusValue === "confirmed" || statusValue === "paid_deposit")) {
      // Use admin email/name from session, or fallback to "Admin"
      depositPayload.depositVerifiedBy = session?.user?.email || session?.user?.name || "Admin"
    }

    try {
      const response = await fetch(API_PATHS.adminBooking(selectedBooking.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusValue,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: null,
          ...dateChangePayload,
          ...depositPayload,
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        toast.success("Booking status updated successfully. Email notification sent.")
        setStatusDialogOpen(false)
        setConfirmationDialogOpen(false)
        setPendingAction(null)
        setPendingValidation(null)
        // Clear restoration status after successful update
        setPendingRestoreStatus(null)
        fetchBookings()
        
        // Invalidate admin stats cache to update notification badges
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminStats')
          window.dispatchEvent(event)
        }
        
        if (viewDialogOpen) {
          fetchBookingDetails(selectedBooking.id)
        }
      } else {
        const errorText = json.error?.message || "Failed to update booking status"
        if (errorText.includes("modified by another process")) {
          toast.error("Booking was modified by another process. Refreshing booking data...")
          await fetchBookingDetails(selectedBooking.id)
          fetchBookings()
        } else if (json.error?.code === 'BOOKING_OVERLAP' || errorText.toLowerCase().includes('overlap')) {
          // Handle overlap error with detailed information
          const overlappingBookings = json.data?.overlappingBookings || []
          if (overlappingBookings.length > 0) {
            const overlapDetails = overlappingBookings.map((b: any, idx: number) => {
              const ref = b.reference_number || "N/A"
              const startDateStr = b.start_date ? formatDate(b.start_date) : "N/A"
              const endDateStr = b.end_date && b.end_date !== b.start_date ? ` - ${formatDate(b.end_date)}` : ""
              const timeStr = b.start_time ? `, ${formatTimeForDisplay(b.start_time)}${b.end_time ? ` - ${formatTimeForDisplay(b.end_time)}` : ""}` : ""
              return `${idx + 1}. ${ref} (${b.name || "Unknown"}) - ${startDateStr}${endDateStr}${timeStr}`
            }).join("\n")
            
            toast.error(
              `Cannot confirm booking: Overlaps with ${overlappingBookings.length} confirmed booking(s).\n\n${overlapDetails}`,
              {
                duration: 10000,
              }
            )
          } else {
            toast.error(errorText, { duration: 8000 })
          }
        } else {
          toast.error(errorText)
        }
      }
    } catch (error) {
      toast.error("Failed to update booking status")
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      finished: "default",
      cancelled: "destructive",
    }
    const colors: Record<string, string> = {
      finished: "bg-gray-100 text-gray-800 border-gray-300",
      cancelled: "bg-orange-100 text-orange-800 border-orange-300",
    }
    return (
      <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
        {status === "pending_deposit" ? "Pending Deposit" : status === "confirmed" ? "Confirmed" : status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  function getBookingReferenceNumber(booking: Booking): string {
    if (booking.reference_number) {
      return booking.reference_number
    }
    // For old records without reference_number, generate a deterministic one based on ID
    const idPart = booking.id.replace(/-/g, '').slice(-8)
    const numValue = parseInt(idPart, 16) % 46656 // 36^3
    const deterministicPart = parseInt(idPart.slice(0, 2), 16) % 1296 // 36^2
    return `HU-${numValue.toString(36).toUpperCase().padStart(3, '0')}${deterministicPart.toString(36).toUpperCase().padStart(2, '0')}`
  }

  const getDepositStatusBadge = (booking: Booking) => {
    // Explicitly check for other channel verification first (most specific case)
    // This handles cancelled bookings that were previously verified via other channel
    // Handle both boolean true and truthy values (defensive check for API transformation edge cases)
    const depositVerifiedFromOtherChannel = booking.deposit_verified_from_other_channel === true || 
                                            Boolean(booking.deposit_verified_from_other_channel)
    
    const isOtherChannelVerified = booking.deposit_verified_at && 
                                   depositVerifiedFromOtherChannel &&
                                   !booking.deposit_evidence_url
    
    // Debug logging for troubleshooting
    if (booking.deposit_verified_at && !booking.deposit_evidence_url && booking.status === "cancelled") {
      console.log('[Deposit Badge Debug]', {
        bookingId: booking.id,
        reference: booking.reference_number,
        deposit_verified_at: booking.deposit_verified_at,
        deposit_verified_from_other_channel: booking.deposit_verified_from_other_channel,
        deposit_verified_from_other_channel_type: typeof booking.deposit_verified_from_other_channel,
        depositVerifiedFromOtherChannel_computed: depositVerifiedFromOtherChannel,
        isOtherChannelVerified,
        deposit_evidence_url: booking.deposit_evidence_url,
        status: booking.status,
      })
    }
    
    if (isOtherChannelVerified) {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-300">
          Deposit Verified from Other Channels
        </Badge>
      )
    }
    
    // If has deposit evidence but not verified
    if (booking.deposit_evidence_url && !booking.deposit_verified_at) {
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-800 border-yellow-300">
          Deposit Available
        </Badge>
      )
    }
    
    // If has deposit evidence and verified
    if (booking.deposit_evidence_url && booking.deposit_verified_at) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-800 border-green-300">
          Deposit Verified
        </Badge>
      )
    }
    
    // No deposit evidence and not verified
    return (
      <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-300">
        No deposit
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
      
      // CRITICAL: Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      
      return format(bangkokDate, "MMM dd, yyyy")
    } catch (error) {
      console.error("Error formatting date:", timestamp, error)
      return "N/A"
    }
  }

  // Only show full-page loading on initial load (when there's no data yet)
  // When refetching with existing data, show content with a subtle loading indicator
  if (status === "loading" || (loading && bookings.length === 0)) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/admin/bookings" prefetch={false}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Bookings
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Archive className="w-8 h-8 text-gray-600" />
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Booking Archive</h1>
            <p className="text-sm sm:text-base text-gray-600">View finished and cancelled reservations</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-4">
        {/* First Row: Status, Event Type, Sort By, Sort Order */}
        <div className="flex flex-col sm:flex-row gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="finished">Finished</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
          <Select value={depositStatusFilter} onValueChange={setDepositStatusFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by deposit status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Deposit Statuses</SelectItem>
              <SelectItem value="no_deposit">No deposit</SelectItem>
              <SelectItem value="deposit_available">Deposit Available</SelectItem>
              <SelectItem value="deposit_verified">Deposit Verified</SelectItem>
              <SelectItem value="deposit_verified_other_channel">Deposit Verified from Other Channels</SelectItem>
            </SelectContent>
          </Select>
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by event type" />
            </SelectTrigger>
            <SelectContent>
              {eventTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Created Date</SelectItem>
              <SelectItem value="start_date">Start Date</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="updated_at">Updated Date</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as typeof sortOrder)}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DESC">Descending</SelectItem>
              <SelectItem value="ASC">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Second Row: Search Fields */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-48">
            <SearchInputWithHistory
              value={referenceNumberFilter}
              onChange={setReferenceNumberFilter}
              onSearch={handleReferenceNumberSearch}
              debouncedOnSearch={handleReferenceNumberDebouncedSearch}
              placeholder="Search reference number..."
              storageKey="archive-search-ref"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-48">
            <SearchInputWithHistory
              value={nameFilter}
              onChange={setNameFilter}
              onSearch={handleNameSearch}
              debouncedOnSearch={handleNameDebouncedSearch}
              placeholder="Search name..."
              storageKey="archive-search-name"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-48">
            <SearchInputWithHistory
              value={phoneFilter}
              onChange={setPhoneFilter}
              onSearch={handlePhoneSearch}
              debouncedOnSearch={handlePhoneDebouncedSearch}
              placeholder="Search phone..."
              storageKey="archive-search-phone"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-64">
            <SearchInputWithHistory
              value={emailFilter}
              onChange={setEmailFilter}
              onSearch={handleEmailSearch}
              debouncedOnSearch={handleEmailDebouncedSearch}
              placeholder="Search email..."
              storageKey="archive-search-email"
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Bookings Table */}
      {filteredBookings.length === 0 ? (
        <div className="text-center py-12">
          <Archive className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No archived bookings found</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      No.
                    </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Booking Reference
                    </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event Details
                    </th>
                    <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                      Date/Time
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
                  {filteredBookings.map((booking, index) => (
                    <tr key={booking.id} className="hover:bg-gray-50">
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-sm text-gray-500">
                        {index + 1}
                      </td>
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {getBookingReferenceNumber(booking)}
                        </div>
                      </td>
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{booking.name}</div>
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
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getStatusBadge(booking.status)}
                          {getDepositStatusBadge(booking)}
                        </div>
                      </td>
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatTimestamp(booking.created_at)}
                      </td>
                      <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              setViewDialogOpen(true)
                              // Don't set selectedBooking from list - wait for fresh data from API
                              await fetchBookingDetails(booking.id)
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
                  ))}
                </tbody>
              </table>
            </div>
            {/* Page size selector and total count */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{filteredBookings.length}</span> of <span className="font-medium">{displayTotal}</span> bookings
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Items per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(parseInt(value))
                    fetchBookings()
                  }}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Infinite scroll sentinel */}
            {displayHasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!displayHasMore && filteredBookings.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
                No more bookings to load
              </div>
            )}
          </div>

          {/* Mobile/Tablet Card View */}
          <div className="lg:hidden space-y-4">
            {filteredBookings.map((booking, index) => (
              <div
                key={booking.id}
                className="bg-white rounded-lg shadow p-4 sm:p-6"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900">{booking.name}</h3>
                    </div>
                    <div className="mb-2">
                      <div className="text-xs font-medium text-gray-500 mb-0.5">Booking Reference</div>
                      <div className="text-sm font-medium text-gray-900">{getBookingReferenceNumber(booking)}</div>
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
                  <div className="ml-2 flex flex-col gap-2">
                    {getStatusBadge(booking.status)}
                    {getDepositStatusBadge(booking)}
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

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Created</div>
                    <div className="text-sm text-gray-500">{formatTimestamp(booking.created_at)}</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      setViewDialogOpen(true)
                      // Don't set selectedBooking from list - wait for fresh data from API
                      await fetchBookingDetails(booking.id)
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
            ))}
            {/* Page size selector and total count for mobile */}
            <div className="bg-white rounded-lg shadow px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{filteredBookings.length}</span> of <span className="font-medium">{displayTotal}</span>
              </div>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(parseInt(value))
                  fetchBookings()
                }}
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Infinite scroll sentinel */}
            {displayHasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!displayHasMore && filteredBookings.length > 0 && (
              <div className="bg-white rounded-lg shadow px-4 py-3 text-center text-sm text-gray-500">
                No more bookings to load
              </div>
            )}
          </div>
        </>
      )}

      {/* View Booking Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              View archived booking information
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-6">
              {/* Status and Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  {getStatusBadge(selectedBooking.status)}
                  {getDepositStatusBadge(selectedBooking)}
                </div>
                <div className="flex items-center gap-2">
                  {/* Only show Update Status for cancelled (can restore) */}
                  {selectedBooking.status !== "finished" && (
                    <Button
                      onClick={() => {
                        setSelectedBooking(selectedBooking)
                        setNewStatus(selectedBooking.status)
                        // Initialize date fields from current booking
                        setNewStartDate(selectedBooking.start_date ? new Date(selectedBooking.start_date * 1000) : null)
                        setNewEndDate(selectedBooking.end_date ? new Date(selectedBooking.end_date * 1000) : null)
                        setNewStartTime(selectedBooking.start_time || "")
                        setNewEndTime(selectedBooking.end_time || "")
                        setDateRangeToggle(selectedBooking.end_date && selectedBooking.end_date !== selectedBooking.start_date ? "multiple" : "single")
                        setVerifyDeposit(false) // Reset deposit verification
                        setStatusDialogOpen(true)
                      }}
                    >
                      Update Status
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteBooking(selectedBooking.id)}
                    disabled={saving}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Booking State Info - Shows warnings and state information */}
              <BookingStateInfo booking={selectedBooking as any} />

              {/* Overlap Warning - Show if there are overlapping bookings */}
              {overlappingBookings.length > 0 && (
                <Alert variant={hasConfirmedOverlap ? "destructive" : "default"} className={hasConfirmedOverlap ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className={hasConfirmedOverlap ? "text-red-900" : "text-yellow-900"}>
                    {hasConfirmedOverlap 
                      ? "⚠️ Booking Blocked by Confirmed Overlap" 
                      : "ℹ️ Overlapping Bookings Detected"}
                  </AlertTitle>
                  <AlertDescription className={hasConfirmedOverlap ? "text-red-800" : "text-yellow-800"}>
                    {hasConfirmedOverlap ? (
                      <div className="space-y-2">
                        <p className="font-semibold">
                          Another booking with the same date/time is already CONFIRMED. You cannot restore this booking to a status that conflicts with the confirmed booking. Please choose a different date range or wait until the confirmed booking is cancelled.
                        </p>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm font-medium">Overlapping bookings:</p>
                          <ul className="list-disc list-inside space-y-1 text-sm">
                            {overlappingBookings.map((overlap) => (
                              <li key={overlap.id}>
                                {overlap.status === "confirmed" && (
                                  <span className="font-bold text-red-700">[CONFIRMED - BLOCKING]</span>
                                )}{" "}
                                {overlap.reference_number ? `${overlap.reference_number} - ` : ""}
                                {overlap.name} ({overlap.status})
                                {" - "}
                                {formatDate(overlap.start_date)}
                                {overlap.end_date && overlap.end_date !== overlap.start_date && ` - ${formatDate(overlap.end_date)}`}
                                {overlap.start_time && `, ${formatTimeForDisplay(overlap.start_time)} - ${formatTimeForDisplay(overlap.end_time)}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p>
                          This booking overlaps with {overlappingBookings.length} other booking{overlappingBookings.length > 1 ? "s" : ""}. Please review carefully before confirming.
                        </p>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm font-medium">Overlapping bookings:</p>
                          <ul className="list-disc list-inside space-y-1 text-sm">
                            {overlappingBookings.map((overlap) => (
                              <li key={overlap.id}>
                                {overlap.reference_number ? `${overlap.reference_number} - ` : ""}
                                {overlap.name} ({overlap.status})
                                {" - "}
                                {formatDate(overlap.start_date)}
                                {overlap.end_date && overlap.end_date !== overlap.start_date && ` - ${formatDate(overlap.end_date)}`}
                                {overlap.start_time && `, ${formatTimeForDisplay(overlap.start_time)} - ${formatTimeForDisplay(overlap.end_time)}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <Label>Brief Your Desire</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.introduction}</div>
                    </div>
                  )}
                  {selectedBooking.biography && (
                    <div className="mb-3">
                      <Label>Background & Interests</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.biography}</div>
                    </div>
                  )}
                  {selectedBooking.special_requests && (
                    <div>
                      <Label>Special Requirements</Label>
                      <div className="text-sm text-gray-900 mt-1">{selectedBooking.special_requests}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Deposit Status */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Deposit Status</h3>
                {selectedBooking.deposit_evidence_url ? (
                  <div className="bg-purple-50 border border-purple-200 rounded p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <Label className="text-sm font-medium text-purple-900 mb-2 block">Deposit Evidence Available</Label>
                        <a
                          href={API_PATHS.adminDepositImage(selectedBooking.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium text-sm"
                        >
                          View Deposit Evidence →
                        </a>
                        {selectedBooking.deposit_verified_at && (
                          <div className="mt-3 text-sm text-purple-800">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>
                                Verified by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                                {selectedBooking.deposit_verified_from_other_channel && (
                                  <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                    (Verified via Other Channel)
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                        {!selectedBooking.deposit_verified_at && (
                          <div className="mt-3 text-sm text-orange-800">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              <span>Deposit not yet verified</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <Label className="text-sm font-medium text-gray-700 mb-2 block">No Deposit Evidence</Label>
                        <p className="text-sm text-gray-600">
                          This booking does not have any deposit evidence uploaded.
                        </p>
                        {selectedBooking.deposit_verified_at && (
                          <div className="mt-3 text-sm text-gray-700">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>
                                Deposit verified via other channel by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                                {selectedBooking.deposit_verified_from_other_channel && (
                                  <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                    (Other Channel)
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

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

      {/* Update Status Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Booking Status</DialogTitle>
            <DialogDescription>
              Update the booking status and send notification email to the user. This allows manual handling of edge cases for archived bookings.
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <form onSubmit={handleStatusUpdate} className="space-y-4">
              {/* Show info for finished bookings */}
              {selectedBooking.status === "finished" && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded">
                  <p className="font-medium">
                    Finished bookings cannot be re-opened. The event has already completed.
                  </p>
                </div>
              )}
              
              {/* Show status selection for archive restoration */}
              {selectedBooking.status !== "finished" && (() => {
                // Define valid restoration options based on current status
                // According to booking-validations.ts: cancelled can transition to pending_deposit, paid_deposit, confirmed
                let restorationOptions: Array<{ value: string; label: string }> = []
                
                if (selectedBooking.status === "cancelled") {
                  // Context-aware restoration options based on deposit evidence
                  const hasDepositEvidence = !!selectedBooking.deposit_evidence_url
                  
                  if (hasDepositEvidence) {
                    // Booking has deposit evidence - all restoration options available
                    restorationOptions = [
                      { value: "pending_deposit", label: "Restore to Pending Deposit" },
                      { value: "paid_deposit", label: "Restore to Paid Deposit" },
                      { value: "confirmed", label: "Restore to Confirmed" },
                    ]
                  } else {
                    // Booking has NO deposit evidence (was originally pending)
                    // Only allow: pending_deposit (user uploads) or confirmed (other channel)
                    restorationOptions = [
                      { value: "pending_deposit", label: "Restore to Pending Deposit" },
                      { value: "confirmed", label: "Restore to Confirmed (Other Channel)" },
                    ]
                  }
                } else {
                  // For other statuses, check valid transitions
                  const allOptions = [
                    { value: "pending_deposit", label: "Pending Deposit" },
                    { value: "paid_deposit", label: "Paid Deposit" },
                    { value: "confirmed", label: "Confirmed" },
                    { value: "cancelled", label: "Cancelled" },
                  ]
                  restorationOptions = allOptions.filter(option => {
                    const check = isValidStatusTransition(selectedBooking.status, option.value)
                    return check.valid && option.value !== selectedBooking.status
                  })
                }
                
                if (restorationOptions.length === 0) {
                  return (
                    <div className="bg-gray-50 border border-gray-200 text-gray-800 p-4 rounded">
                      <p className="font-medium">
                        No restoration options available for this status.
                      </p>
                    </div>
                  )
                }
                
                return (
                  <>
                    <div>
                      <Label htmlFor="status">New Status *</Label>
                      <Select 
                        name="status" 
                        value={newStatus} 
                        onValueChange={(value) => {
                          setNewStatus(value)
                          // Show restoration confirmation dialog for cancelled bookings restoring to specific statuses
                          // IMPORTANT: Don't close status dialog - user needs to be able to update dates after confirming restoration
                          if (selectedBooking.status === "cancelled" && 
                              (value === "pending_deposit" || value === "paid_deposit" || value === "confirmed")) {
                            setPendingRestoreStatus(value as "pending_deposit" | "paid_deposit" | "confirmed")
                            setRestorationDialogOpen(true)
                            // Keep status dialog open so user can update dates and submit
                            // Focus blur is handled by useEffect to prevent aria-hidden accessibility violation
                          }
                        }} 
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                          {restorationOptions.map((option) => (
                            <SelectItem 
                              key={option.value} 
                              value={option.value}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-gray-500 mt-1">
                        Available transitions: {restorationOptions.map(o => o.value).join(", ")}
                      </p>
                    </div>
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

                    {/* Date Selection for Restoration */}
                    {newStatus && newStatus !== selectedBooking.status && (
                      <div className="space-y-4 pt-4 border-t">
                        <div className="text-sm font-medium text-gray-900">Update Booking Dates (Optional)</div>
                        <p className="text-sm text-gray-500">
                          {selectedBooking.status === "cancelled" 
                            ? "You can optionally change the booking dates when restoring. Leave unchanged to keep existing dates. Dates with confirmed bookings will be blocked."
                            : "You can optionally change the booking dates. Leave unchanged to keep existing dates."}
                        </p>
                        
                        {/* Date Selection Guidelines */}
                        {(() => {
                          // Use the already imported dateToBangkokDateString from timezone-client
                          const todayStr = dateToBangkokDateString(new Date())
                          const isPendingDeposit = newStatus === "pending_deposit"
                          const isPaidDepositOrConfirmed = newStatus === "paid_deposit" || newStatus === "confirmed"
                          
                          return (
                            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
                              <p className="font-medium mb-2">📅 Date Selection Guidelines:</p>
                              <ul className="list-disc list-inside space-y-1">
                                <li>Today's date is allowed for all restoration statuses</li>
                                {isPendingDeposit && (
                                  <li className="text-amber-700 font-medium">
                                    ⚠️ For "Pending Deposit": The booking start time must be in the future (not today if time has passed). User needs time to upload deposit evidence.
                                  </li>
                                )}
                                {(isPaidDepositOrConfirmed) && (
                                  <li>
                                    ✓ For "Paid Deposit" or "Confirmed": Today's date is allowed even if the time has passed (useful for historical corrections or same-day bookings).
                                  </li>
                                )}
                                <li>Dates with existing confirmed bookings will be automatically blocked</li>
                              </ul>
                            </div>
                          )
                        })()}
                        
                        {selectedBooking.status === "cancelled" && newStatus === "confirmed" && !selectedBooking.deposit_evidence_url && (
                          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
                            <p className="font-medium mb-1">ℹ️ Other Channel Verification</p>
                            <p>Since this booking has no deposit evidence, restoring to "Confirmed" will automatically mark the deposit as verified via other channel (phone, in-person, etc.).</p>
                          </div>
                        )}
                        
                        {/* Date Range Selection */}
                        <div>
                          <Label>Date Range</Label>
                          <Select
                            value={dateRangeToggle}
                            onValueChange={(value: "single" | "multiple") => {
                              setDateRangeToggle(value)
                              if (value === "single") {
                                setNewEndDate(null)
                              } else if (!newEndDate && selectedBooking.end_date) {
                                const endDateTimestamp = selectedBooking.end_date
                                setNewEndDate(new Date(endDateTimestamp * 1000))
                              }
                            }}
                            disabled={saving}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">Single Day</SelectItem>
                              <SelectItem value="multiple">Multiple Days</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Start Date */}
                        <div>
                          <Label htmlFor="new_start_date">New Start Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                                disabled={saving}
                              >
                                <Calendar className="mr-2 h-4 w-4" />
                                {newStartDate ? format(newStartDate, "PPP") : "Select start date (optional)"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <SimpleCalendar
                                selected={newStartDate || undefined}
                                month={calendarMonth}
                                onMonthChange={(date) => {
                                  setCalendarMonth(date)
                                  // Refresh unavailable dates when month changes
                                  if (selectedBooking?.id) {
                                    fetchUnavailableDatesForRestoration(selectedBooking.id)
                                  }
                                }}
                                onSelect={(date) => {
                                  setNewStartDate(date || null)
                                  if (newEndDate && date && dateRangeToggle === "multiple") {
                                    const startDateStr = dateToBangkokDateString(date)
                                    const endDateStr = dateToBangkokDateString(newEndDate)
                                    if (endDateStr <= startDateStr) {
                                      setNewEndDate(null)
                                    }
                                  }
                                }}
                                disabled={(date) => {
                                  // Disable past dates
                                  const todayStr = dateToBangkokDateString(new Date())
                                  const dateStr = dateToBangkokDateString(date)
                                  if (dateStr < todayStr) return true
                                  
                                  // Check if date is unavailable (has confirmed booking)
                                  const isUnavailable = unavailableDatesForRestoration.has(dateStr)
                                  if (isUnavailable) {
                                    console.log(`[Archive] Date ${dateStr} is unavailable (blocked by confirmed booking)`)
                                  }
                                  return isUnavailable
                                }}
                                isOccupied={(date) => {
                                  // Check if date is occupied (has confirmed booking)
                                  const dateStr = dateToBangkokDateString(date)
                                  return unavailableDatesForRestoration.has(dateStr)
                                }}
                                occupiedTimeRanges={unavailableTimeRangesForRestoration}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* End Date (for multiple days) */}
                        {dateRangeToggle === "multiple" && (
                          <div>
                            <Label htmlFor="new_end_date">New End Date</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal"
                                  disabled={saving || !newStartDate}
                                  title={!newStartDate ? "Please select a start date first" : ""}
                                >
                                  <Calendar className="mr-2 h-4 w-4" />
                                  {newEndDate ? format(newEndDate, "PPP") : "Select end date (optional)"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <SimpleCalendar
                                  selected={newEndDate || undefined}
                                  month={calendarMonth}
                                  onMonthChange={(date) => {
                                    setCalendarMonth(date)
                                    // Refresh unavailable dates when month changes
                                    if (selectedBooking?.id) {
                                      fetchUnavailableDatesForRestoration(selectedBooking.id)
                                    }
                                  }}
                                  onSelect={(date) => {
                                    setNewEndDate(date || null)
                                  }}
                                  disabled={(date) => {
                                    if (!newStartDate) return true
                                    const startDateStr = dateToBangkokDateString(newStartDate)
                                    const dateStr = dateToBangkokDateString(date)
                                    
                                    // Disable dates before or equal to start date
                                    if (dateStr <= startDateStr) return true
                                    
                                    // Check if date is unavailable (has confirmed booking)
                                    const isUnavailable = unavailableDatesForRestoration.has(dateStr)
                                    if (isUnavailable) {
                                      console.log(`[Archive] Date ${dateStr} is unavailable (blocked by confirmed booking)`)
                                    }
                                    return isUnavailable
                                  }}
                                  isOccupied={(date) => {
                                    // Check if date is occupied (has confirmed booking)
                                    const dateStr = dateToBangkokDateString(date)
                                    return unavailableDatesForRestoration.has(dateStr)
                                  }}
                                  occupiedTimeRanges={unavailableTimeRangesForRestoration}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        )}

                        {/* Start Time */}
                        <div>
                          <Label htmlFor="new_start_time">New Start Time</Label>
                          <TimePicker
                            id="new_start_time"
                            value={newStartTime || selectedBooking.start_time || "09:00"}
                            onChange={(value) => setNewStartTime(value)}
                            disabled={saving}
                            className="w-full"
                          />
                        </div>

                        {/* End Time */}
                        <div>
                          <Label htmlFor="new_end_time">New End Time</Label>
                          <TimePicker
                            id="new_end_time"
                            value={newEndTime || selectedBooking.end_time || "17:00"}
                            onChange={(value) => setNewEndTime(value)}
                            disabled={saving}
                            className="w-full"
                          />
                        </div>
                      </div>
                    )}

                    {/* Deposit Verification */}
                    {selectedBooking.deposit_evidence_url && 
                     (newStatus === "confirmed" || newStatus === "paid_deposit") && 
                     newStatus !== selectedBooking.status && (
                      <div className="space-y-4 pt-4 border-t">
                        <div className="bg-purple-50 border border-purple-200 rounded p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Label className="text-sm font-medium text-purple-900">Deposit Evidence Available</Label>
                              </div>
                              <p className="text-sm text-purple-800 mb-3">
                                This booking has deposit evidence. You can verify the deposit during restoration.
                              </p>
                              <a
                                href={`/api/admin/deposit/${selectedBooking.id}/image`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline font-medium text-sm mb-3 inline-block"
                              >
                                View Deposit Evidence →
                              </a>
                              <div className="flex items-center gap-2 mt-3">
                                <input
                                  type="checkbox"
                                  id="verify_deposit"
                                  checked={verifyDeposit}
                                  onChange={(e) => setVerifyDeposit(e.target.checked)}
                                  disabled={saving}
                                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                />
                                <Label htmlFor="verify_deposit" className="text-sm text-purple-900 cursor-pointer">
                                  Verify deposit evidence (will mark as verified by {session?.user?.name || session?.user?.email || "Admin"})
                                </Label>
                              </div>
                              {selectedBooking.deposit_verified_at && (
                                <p className="text-xs text-purple-700 mt-2">
                                  Previously verified by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
              
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStatusDialogOpen(false)
                    setNewStatus(selectedBooking.status)
                    setSelectedAction(null)
                    // Reset date fields
                    setNewStartDate(null)
                    setNewEndDate(null)
                    setNewStartTime("")
                    setNewEndTime("")
                    setDateRangeToggle("single")
                    setVerifyDeposit(false)
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                {selectedBooking.status !== "finished" && (
                  <Button 
                    type="submit" 
                    disabled={saving || !newStatus || newStatus === selectedBooking.status}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Update Status"
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

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        booking={bookingToDelete ? {
          id: bookingToDelete.id,
          name: bookingToDelete.name,
          email: bookingToDelete.email,
          status: bookingToDelete.status,
          eventType: bookingToDelete.event_type,
          start_date: bookingToDelete.start_date,
          end_date: bookingToDelete.end_date,
          start_time: bookingToDelete.start_time,
          end_time: bookingToDelete.end_time,
          reference_number: bookingToDelete.reference_number,
          depositEvidenceUrl: bookingToDelete.deposit_evidence_url || null,
        } : null}
        onConfirm={confirmDeleteBooking}
        onCancel={() => {
          setDeleteDialogOpen(false)
          setBookingToDelete(null)
        }}
        isLoading={saving || actionLoading}
      />

      {/* Restoration Confirmation Dialog */}
      {pendingRestoreStatus && selectedBooking && (
        <RestorationConfirmationDialog
          open={restorationDialogOpen}
          onOpenChange={(open) => {
            setRestorationDialogOpen(open)
            if (!open) {
              // Only reset if user cancelled (not if they confirmed)
              // If they confirmed, keep the status selected so they can proceed with date updates
              if (!pendingRestoreStatus) {
                // Dialog was closed without confirmation - reset status
                if (selectedBooking.status === "cancelled") {
                  setNewStatus(selectedBooking.status)
                }
              }
              // Don't clear pendingRestoreStatus here - let onConfirm/onCancel handle it
            }
          }}
          targetStatus={pendingRestoreStatus}
          bookingHasDepositEvidence={!!selectedBooking.deposit_evidence_url}
          onConfirm={() => {
            setRestorationDialogOpen(false)
            // Keep pendingRestoreStatus set so status remains selected
            // User can now update dates and click "Update Status" to submit
            // Status dialog should remain open for date updates
          }}
          onCancel={() => {
            setRestorationDialogOpen(false)
            setPendingRestoreStatus(null)
            // Reset status selection
            setNewStatus(selectedBooking.status)
          }}
          loading={saving}
        />
      )}
    </div>
  )
}

