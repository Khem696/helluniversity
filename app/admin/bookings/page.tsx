"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  MessageCircle,
  AlertTriangle,
  Download,
  X,
  Bookmark,
  Calendar as CalendarIcon,
  Filter,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { BookingStateInfo } from "@/components/admin/BookingStateInfo"
import { ActionConfirmationDialog } from "@/components/admin/ActionConfirmationDialog"
import { DeleteConfirmationDialog } from "@/components/admin/DeleteConfirmationDialog"
import { BookingExportDialog } from "@/components/admin/BookingExportDialog"
import { SearchHighlight } from "@/components/admin/SearchHighlight"
import { SearchInputWithHistory } from "@/components/admin/SearchInputWithHistory"
import { FilterPresetsDialog } from "@/components/admin/FilterPresetsDialog"
import { AdvancedBookingFilters } from "@/components/admin/AdvancedBookingFilters"
import { useBookingActions } from "@/hooks/useBookingActions"
import { useActionLocksSSE } from "@/hooks/useActionLocksSSE"
import { getAvailableActions, mapActionToStatus, type ActionDefinition } from "@/lib/booking-state-machine"
import { calculateStartTimestamp } from "@/lib/booking-validations"
import { getBangkokTime } from "@/lib/timezone"
import { useInfiniteAdminBookings, type Booking as BookingType } from "@/hooks/useInfiniteAdminBookings"
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll"
import { useAdminBookingsSSE, type BookingUpdateEvent } from "@/hooks/useAdminBookingsSSE"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { TimePicker } from "@/components/ui/time-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { dateToBangkokDateString } from "@/lib/timezone-client"
import { BookingTable } from "@/components/admin/BookingTable"
import {
  formatTimeForDisplay,
  formatDate,
  formatTimestamp,
  formatFee,
  getStatusBadge,
  getBookingReferenceNumber,
} from "@/lib/booking-helpers"

// Use Booking type from hook to ensure consistency
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

export default function BookingsPage() {
  const { data: session, status } = useSession()
  const [saving, setSaving] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  // Ref to track current booking ID for fee history updates (avoids stale closures)
  const selectedBookingIdRef = useRef<string | null>(null)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([])
  const [feeHistory, setFeeHistory] = useState<Array<{
    id: string
    oldFeeAmount: number | null
    newFeeAmount: number | null
    oldFeeAmountOriginal: number | null
    newFeeAmountOriginal: number | null
    oldFeeCurrency: string | null
    newFeeCurrency: string | null
    oldFeeConversionRate: number | null
    newFeeConversionRate: number | null
    changedBy: string
    changeReason: string | null
    bookingStatusAtChange: string
    isRestorationChange: boolean
    createdAt: number
  }>>([])
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
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [loadingBookingDetails, setLoadingBookingDetails] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [feeDialogOpen, setFeeDialogOpen] = useState(false)
  const [feeAmountOriginal, setFeeAmountOriginal] = useState<string>("")
  const [feeCurrency, setFeeCurrency] = useState<string>("THB")
  const [feeConversionRate, setFeeConversionRate] = useState<string>("")
  const [feeAmount, setFeeAmount] = useState<string>("")
  const [feeNotes, setFeeNotes] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [statusFilters, setStatusFilters] = useState<string[]>([]) // Multiple status selection
  const [emailFilter, setEmailFilter] = useState("")
  const [referenceNumberFilter, setReferenceNumberFilter] = useState("")
  const [nameFilter, setNameFilter] = useState("")
  const [phoneFilter, setPhoneFilter] = useState("")
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all")
  const [depositStatusFilter, setDepositStatusFilter] = useState<string>("all")
  
  // Debounced filter values for API calls (prevents refetch on every keystroke)
  const [debouncedEmailFilter, setDebouncedEmailFilter] = useState("")
  const [debouncedReferenceNumberFilter, setDebouncedReferenceNumberFilter] = useState("")
  const [debouncedNameFilter, setDebouncedNameFilter] = useState("")
  const [debouncedPhoneFilter, setDebouncedPhoneFilter] = useState("")
  const [showOverlappingOnly, setShowOverlappingOnly] = useState(false)
  const [sortBy, setSortBy] = useState<"created_at" | "start_date" | "name" | "updated_at">("created_at")
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC")
  const [startDateFrom, setStartDateFrom] = useState("")
  const [startDateTo, setStartDateTo] = useState("")
  const [useDateRange, setUseDateRange] = useState(false)
  const [presetsDialogOpen, setPresetsDialogOpen] = useState(false)
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [pageSize, setPageSize] = useState(25)
  const [postponeMode, setPostponeMode] = useState<"user-propose" | "admin-propose">("user-propose")
  const [selectedStatusInForm, setSelectedStatusInForm] = useState<string>("")
  const [selectedAction, setSelectedAction] = useState<"accept" | "reject" | "accept_deposit" | "accept_deposit_other_channel" | "reject_deposit" | "cancel" | "change_date" | "confirm_other_channel" | null>(null)
  // Date change state
  const [newStartDate, setNewStartDate] = useState<Date | null>(null)
  const [newEndDate, setNewEndDate] = useState<Date | null>(null)
  const [newStartTime, setNewStartTime] = useState<string>("")
  const [newEndTime, setNewEndTime] = useState<string>("")
  const [showPastDateWarning, setShowPastDateWarning] = useState(false)
  // Date range toggle for date change (controls whether end date is shown)
  const [dateRangeToggle, setDateRangeToggle] = useState<"single" | "multiple">("single")
  // Unavailable dates for date change calendar (excludes current booking's dates)
  const [unavailableDatesForDateChange, setUnavailableDatesForDateChange] = useState<Set<string>>(new Set())
  const [unavailableTimeRangesForDateChange, setUnavailableTimeRangesForDateChange] = useState<Array<{
    date: string
    startTime: string | null
    endTime: string | null
    startDate: number
    endDate: number
  }>>([])
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date())
  const [newResponsesCount, setNewResponsesCount] = useState<number>(0)
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<ActionDefinition | null>(null)
  const [pendingValidation, setPendingValidation] = useState<any>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null)
  const [otherChannelConfirmText, setOtherChannelConfirmText] = useState("")
  const [otherChannelDialogOpen, setOtherChannelDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  
  // Track SSE connection status for fallback polling
  const [sseError, setSseError] = useState<Error | null>(null)
  const [sseConnected, setSseConnected] = useState<boolean>(false)
  
  // Use refs to track current values without causing dependency array changes
  // These refs are used in SSE callbacks to avoid stale closure issues
  const selectedBookingRef = useRef<Booking | null>(null)
  const selectedActionRef = useRef<string | null>(null)
  const viewDialogOpenRef = useRef<boolean>(false)
  const statusDialogOpenRef = useRef<boolean>(false)
  const confirmationDialogOpenRef = useRef<boolean>(false)
  const feeDialogOpenRef = useRef<boolean>(false)
  const deleteDialogOpenRef = useRef<boolean>(false)
  const otherChannelDialogOpenRef = useRef<boolean>(false)
  const bookingsRef = useRef<Booking[]>([])
  const lastCheckedAtRef = useRef<number>(0) // Initialize to 0 so useEffect can properly initialize it
  const seenResponseIdsRef = useRef<Set<string>>(new Set())
  const unavailableDatesAbortControllerRef = useRef<AbortController | null>(null)
  const feeHistoryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Update refs when values change
  useEffect(() => {
    selectedBookingRef.current = selectedBooking
    selectedActionRef.current = selectedAction
    // Sync booking ID ref for fee history updates
    selectedBookingIdRef.current = selectedBooking?.id || null
  }, [selectedBooking, selectedAction])
  
  useEffect(() => {
    viewDialogOpenRef.current = viewDialogOpen
    statusDialogOpenRef.current = statusDialogOpen
    confirmationDialogOpenRef.current = confirmationDialogOpen
    feeDialogOpenRef.current = feeDialogOpen
    deleteDialogOpenRef.current = deleteDialogOpen
    otherChannelDialogOpenRef.current = otherChannelDialogOpen
  }, [viewDialogOpen, statusDialogOpen, confirmationDialogOpen, feeDialogOpen, deleteDialogOpen, otherChannelDialogOpen])
  
  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (feeHistoryTimeoutRef.current) {
        clearTimeout(feeHistoryTimeoutRef.current)
        feeHistoryTimeoutRef.current = null
      }
    }
  }, [])
  
  // CRITICAL: Refetch booking details when dialog opens to ensure fresh data
  // This prevents stale status from being displayed when opening dialog after status change
  // Use a ref to track the last fetched booking ID to prevent unnecessary refetches
  const lastFetchedBookingIdRef = useRef<string | null>(null)
  // Ref to track when we're intentionally fetching a booking (via onViewBooking)
  // This allows fetchBookingDetails to update even when selectedBooking is null
  const intentionalFetchRef = useRef<string | null>(null)
  useEffect(() => {
    // Capture booking ID at start to avoid stale closure
    const currentBookingId = selectedBooking?.id
    
    if (viewDialogOpen && currentBookingId) {
      // Only refetch if this is a different booking or if we haven't fetched this one yet
      // This prevents infinite loops while ensuring fresh data when dialog opens
      if (lastFetchedBookingIdRef.current !== currentBookingId) {
        lastFetchedBookingIdRef.current = currentBookingId
        // Always refetch when dialog opens to ensure we have the latest data
        // This is especially important after status changes
        // Add small delay to ensure backend cache invalidation completes
        const fetchFreshData = async () => {
          // Small delay to ensure cache invalidation from previous status update completes
          await new Promise(resolve => setTimeout(resolve, 50))
          // Verify booking ID still matches before fetching (prevents race conditions)
          if (selectedBookingIdRef.current === currentBookingId) {
            await fetchBookingDetails(currentBookingId)
          }
        }
        fetchFreshData()
      }
    } else if (!viewDialogOpen) {
      // Reset ref when dialog closes
      lastFetchedBookingIdRef.current = null
    }
  }, [viewDialogOpen, selectedBooking?.id]) // Depend on both to refetch when booking changes
  
  // Fix accessibility issue: When nested dialogs open, blur focused elements in underlying dialogs
  // This prevents aria-hidden violation when a dialog is hidden behind another dialog
  useEffect(() => {
    // Check if any nested dialog is open (confirmation, delete, other channel)
    const hasNestedDialog = confirmationDialogOpen || deleteDialogOpen || otherChannelDialogOpen
    const hasParentDialog = viewDialogOpen || statusDialogOpen
    
    if (hasNestedDialog && hasParentDialog) {
      // When nested dialog opens, blur any focused elements in the parent dialog
      // This prevents the accessibility violation where aria-hidden is set on a dialog with focused elements
      const blurFocusedElements = () => {
        // Find all dialogs
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        if (dialogs.length > 1) {
          // The parent dialog should be the one before the nested dialog
          // Blur focused elements in all dialogs except the last one (the topmost dialog)
          for (let i = 0; i < dialogs.length - 1; i++) {
            const dialog = dialogs[i] as HTMLElement
            if (dialog) {
              const focusedElement = dialog.querySelector(':focus') as HTMLElement
              if (focusedElement && focusedElement.blur) {
                focusedElement.blur()
              }
            }
          }
        }
      }
      // Use setTimeout to ensure the nested dialog has rendered and set aria-hidden
      const timeoutId = setTimeout(blurFocusedElements, 0)
      return () => clearTimeout(timeoutId)
    }
  }, [confirmationDialogOpen, deleteDialogOpen, otherChannelDialogOpen, viewDialogOpen, statusDialogOpen])
  
  // Search handlers - trigger search immediately on Enter key
  const handleReferenceNumberSearch = (value: string) => {
    console.log('[BookingsPage] Reference number search triggered (Enter):', value)
    setDebouncedReferenceNumberFilter(value)
  }

  // Debounced search handlers - trigger search automatically while typing
  const handleReferenceNumberDebouncedSearch = (value: string) => {
    console.log('[BookingsPage] Reference number debounced search triggered:', value)
    setDebouncedReferenceNumberFilter(value)
  }

  const handleEmailSearch = (value: string) => {
    console.log('[BookingsPage] Email search triggered (Enter):', value)
    setDebouncedEmailFilter(value)
  }

  const handleEmailDebouncedSearch = (value: string) => {
    console.log('[BookingsPage] Email debounced search triggered:', value)
    setDebouncedEmailFilter(value)
  }

  const handleNameSearch = (value: string) => {
    console.log('[BookingsPage] Name search triggered (Enter):', value)
    setDebouncedNameFilter(value)
  }

  const handleNameDebouncedSearch = (value: string) => {
    console.log('[BookingsPage] Name debounced search triggered:', value)
    setDebouncedNameFilter(value)
  }

  const handlePhoneSearch = (value: string) => {
    console.log('[BookingsPage] Phone search triggered (Enter):', value)
    setDebouncedPhoneFilter(value)
  }

  const handlePhoneDebouncedSearch = (value: string) => {
    console.log('[BookingsPage] Phone debounced search triggered:', value)
    setDebouncedPhoneFilter(value)
  }
  
  // Event types for filter dropdown
  const eventTypes = [
    { value: "all", label: "All Event Types" },
    { value: "Arts & Design Coaching", label: "Arts & Design Coaching Workshop" },
    { value: "Seminar & Workshop", label: "Seminar & Workshop" },
    { value: "Family Gathering", label: "Family Gathering" },
    { value: "Holiday Festive", label: "Holiday Festive" },
    { value: "Other", label: "Other" },
  ]

  // Available statuses for active bookings (exclude finished and cancelled - those are in archive)
  const availableStatuses = [
    { value: "pending", label: "Pending" },
    { value: "pending_deposit", label: "Pending Deposit" },
    { value: "paid_deposit", label: "Paid Deposit" },
    { value: "confirmed", label: "Confirmed" },
  ]
  
  // Build base endpoint with filters (without limit/offset for infinite scroll)
  // Use debounced values for search inputs to prevent refetch on every keystroke
  const baseEndpoint = useMemo(() => {
    console.log('[BookingsPage] baseEndpoint recalculating:', {
      debouncedReferenceNumberFilter,
      debouncedEmailFilter,
      debouncedNameFilter,
      debouncedPhoneFilter,
      statusFilter,
      statusFilters,
    })
    const params = new URLSearchParams()
    // Use multiple status filters if selected, otherwise fall back to single status filter
    if (statusFilters.length > 0) {
      // Send statuses as comma-separated string for v1 API
      params.append("statuses", statusFilters.join(","))
    } else if (statusFilter !== "all") {
      params.append("status", statusFilter)
    }
    if (debouncedEmailFilter) {
      params.append("email", debouncedEmailFilter)
    }
    if (debouncedReferenceNumberFilter) {
      console.log('[BookingsPage] Adding referenceNumber to params:', debouncedReferenceNumberFilter)
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
    if (showOverlappingOnly) {
      params.append("showOverlappingOnly", "true")
    }
    if (useDateRange) {
      if (startDateFrom) {
        // Convert YYYY-MM-DD to Unix timestamp (Bangkok timezone)
        const fromDate = new Date(startDateFrom + "T00:00:00+07:00")
        params.append("startDateFrom", Math.floor(fromDate.getTime() / 1000).toString())
      }
      if (startDateTo) {
        const toDate = new Date(startDateTo + "T23:59:59+07:00")
        params.append("startDateTo", Math.floor(toDate.getTime() / 1000).toString())
      }
    }
    params.append("sortBy", sortBy)
    params.append("sortOrder", sortOrder)
    return buildApiUrl(API_PATHS.adminBookings, Object.fromEntries(params))
  }, [statusFilter, statusFilters, debouncedEmailFilter, debouncedReferenceNumberFilter, debouncedNameFilter, debouncedPhoneFilter, eventTypeFilter, showOverlappingOnly, sortBy, sortOrder, startDateFrom, startDateTo, useDateRange])
  
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
    // Enable fallback polling if SSE is not connected OR has an error (60 seconds interval - reduced frequency)
    // When SSE is connected and working, polling is disabled for efficiency
    refetchInterval: (!sseConnected || sseError) ? 60000 : false,
    enabled: !!session,
    isDialogOpen: () => viewDialogOpen || statusDialogOpen || confirmationDialogOpen || deleteDialogOpen || feeDialogOpen || otherChannelDialogOpen,
  })
  
  // Update bookingsRef when bookings changes (must be after bookings is defined)
  useEffect(() => {
    bookingsRef.current = bookings
  }, [bookings])
  
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
  
  // Initialize booking actions hook
  const {
    isLoading: actionLoading,
    validationResult,
    getActions,
    validateActionBeforeExecution,
    executeAction,
  } = useBookingActions({
    onSuccess: (updatedBooking) => {
      // CRITICAL: Use refs to avoid stale closure issues
      // Capture current booking from ref at start of callback
      const currentBooking = selectedBookingRef.current
      const currentBookingId = selectedBookingIdRef.current
      
      // CRITICAL: Close ALL dialogs when booking is cancelled or restored
      // This prevents showing stale data in modals after status changes
      const newStatus = updatedBooking?.status || currentBooking?.status
      const isCancelled = newStatus === "cancelled"
      const isRestoration = currentBooking?.status === "cancelled" && 
        (newStatus === "pending_deposit" || newStatus === "paid_deposit" || newStatus === "confirmed")
      
      setStatusDialogOpen(false)
      setSelectedAction(null)
      // Reset date change state
      setNewStartDate(null)
      setNewEndDate(null)
      setNewStartTime("")
      setNewEndTime("")
      setShowPastDateWarning(false)
      setSelectedStatusInForm("")
      setPostponeMode("user-propose")
      setProposedDateRange("single")
      // Invalidate bookings cache to trigger refetch
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('invalidateAdminBookings')
        window.dispatchEvent(event)
      }
      fetchBookings()
      
      // Close view dialog if booking is cancelled or restored
      // This ensures user sees updated booking list immediately without stale modal data
      // Use captured booking ID to prevent race conditions
      if (isCancelled || isRestoration) {
        setViewDialogOpen(false)
        setSelectedBooking(null)
      } else if (viewDialogOpenRef.current && currentBookingId) {
        // For other status changes, refresh booking details in view dialog
        // CRITICAL: Add delay to ensure cache is invalidated and database is updated
        // This prevents stale status from being displayed
        // Capture booking ID before setTimeout to avoid stale closure
        const targetBookingId = currentBookingId
        setTimeout(() => {
          // Double-check that the booking still matches before fetching
          // This prevents race conditions where user switches bookings before setTimeout executes
          if (selectedBookingIdRef.current === targetBookingId && viewDialogOpenRef.current) {
            fetchBookingDetails(targetBookingId)
          }
        }, 100) // Small delay to ensure backend cache invalidation completes
      }
    },
  })

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // Initialize last checked time when bookings load
  useEffect(() => {
    if (bookings.length > 0 && lastCheckedAtRef.current === 0) {
      lastCheckedAtRef.current = Date.now()
    }
  }, [bookings.length])

  // Clear seen response IDs on component unmount to prevent memory leaks
  // Also clear periodically to handle deleted/recreated bookings with same IDs
  useEffect(() => {
    // Clear the Set every hour to prevent unbounded growth and handle edge cases
    // where bookings are deleted and recreated with the same ID
    const intervalId = setInterval(() => {
      seenResponseIdsRef.current.clear()
    }, 3600000) // 1 hour

    return () => {
      clearInterval(intervalId)
      // Also clear on unmount
      seenResponseIdsRef.current.clear()
    }
  }, [])

  // Real-time booking updates via SSE (replaces polling)
  // Combined hook handles both list updates and dialog updates to avoid React Hooks violation
  const sseHookResult = useAdminBookingsSSE({
    // Enable when session exists - keep SSE connection active regardless of dialog state
    // Callbacks will check dialog state before deciding whether to refresh dialog details
    // This ensures the list always receives real-time updates even when dialogs are open
    enabled: !!session,
    // Don't filter by bookingId - we need all updates for the list, even when dialog is open
    bookingId: undefined,
    onStatusChange: (event: BookingUpdateEvent) => {
      // Handle status change events
      const booking = event.booking
      const previousStatus = event.metadata?.previousStatus
      
      if (!booking) return
      
      // Always update the list first to ensure data is fresh
      updateItem(booking.id, {
        status: booking.status as any,
        name: booking.name,
        email: booking.email,
        event_type: booking.event_type,
        start_date: booking.start_date,
        end_date: booking.end_date ?? null,
        start_time: booking.start_time ?? '',
        end_time: booking.end_time ?? '',
        updated_at: booking.updated_at,
        user_response: booking.user_response ?? null,
        response_date: booking.response_date ?? null,
        deposit_evidence_url: booking.deposit_evidence_url ?? null,
        deposit_verified_at: booking.deposit_verified_at ?? null,
        proposed_date: booking.proposed_date ?? null,
        proposed_end_date: booking.proposed_end_date ?? null,
      })
      
      // If dialog is open and this is the selected booking, refresh dialog details
      // But only if no nested dialogs are open (to avoid interrupting user workflow)
      // Use refs to avoid stale closure issues
      if (viewDialogOpenRef.current && selectedBookingRef.current?.id === booking.id && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current) {
        fetchBookingDetails(booking.id)
      }
      
      // Show notification only when no dialogs are open (to avoid disrupting user workflow)
      // Use refs to avoid stale closure issues
      const noDialogsOpen = !viewDialogOpenRef.current && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current
      if (noDialogsOpen && previousStatus && previousStatus !== booking.status) {
        // Include previous status in toast ID to allow multiple status change notifications to coexist
        // This prevents newer notifications from replacing older ones when status changes multiple times quickly
        toast.info(`Booking status updated: ${booking.name}`, {
          id: `booking-status-${booking.id}-${previousStatus}-${booking.status}`,
          description: `Status changed from "${previousStatus}" to "${booking.status}"`,
          action: {
            label: "View",
            onClick: async () => {
              // Find booking from list (has all fields) - only use if it exists
              // If not in list yet, set to null to avoid incomplete data
              // fetchBookingDetails will load complete data immediately
              // Use refs to avoid stale closure issues
              const fullBooking = bookingsRef.current.find(b => b.id === booking.id)
              if (fullBooking) {
                setSelectedBooking(fullBooking)
                // Update ref immediately to ensure fetchBookingDetails can check it correctly
                // (state updates are async, but ref updates are synchronous)
                selectedBookingRef.current = fullBooking
                selectedBookingIdRef.current = fullBooking.id
              } else {
                // If booking not in list yet, set to null to prevent rendering with incomplete data
                // The dialog will show loading state until fetchBookingDetails completes
                setSelectedBooking(null)
                selectedBookingRef.current = null
                selectedBookingIdRef.current = null
                // Set flag to indicate intentional fetch (allows update even when ref is null)
                intentionalFetchRef.current = booking.id
              }
              setLoadingBookingDetails(true)
              setViewDialogOpen(true)
              await fetchBookingDetails(booking.id)
              // Clear intentional fetch flag after fetch completes
              if (intentionalFetchRef.current === booking.id) {
                intentionalFetchRef.current = null
              }
            },
          },
          duration: 5000,
        })
      }
    },
    onUserResponse: (event: BookingUpdateEvent) => {
      // Handle user response events
      const booking = event.booking
      
      if (booking && booking.user_response && booking.response_date) {
        // Check if we've already seen this response
        const responseId = `${booking.id}-${booking.response_date}`
        if (seenResponseIdsRef.current.has(responseId)) {
          return // Already notified
        }
        
        // Update booking in list (use updateItem to preserve existing fields)
        updateItem(booking.id, {
          status: booking.status as any,
          name: booking.name,
          email: booking.email,
          event_type: booking.event_type,
          start_date: booking.start_date,
          end_date: booking.end_date ?? null,
          start_time: booking.start_time ?? '',
          end_time: booking.end_time ?? '',
          updated_at: booking.updated_at,
          user_response: booking.user_response ?? null,
          response_date: booking.response_date ?? null,
          deposit_evidence_url: booking.deposit_evidence_url ?? null,
          deposit_verified_at: booking.deposit_verified_at ?? null,
          proposed_date: booking.proposed_date ?? null,
          proposed_end_date: booking.proposed_end_date ?? null,
        })
        
        // Show notification only when no dialogs are open (to avoid disrupting user workflow)
        // Use refs to avoid stale closure issues
        const noDialogsOpen = !viewDialogOpenRef.current && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current
        if (noDialogsOpen) {
          // Only mark as seen after successfully showing the notification
          // This ensures that if dialogs are open, the response won't be marked as seen
          // and will be shown when dialogs close
          seenResponseIdsRef.current.add(responseId)
          
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
              onClick: async () => {
                // Find booking from list (has all fields) - only use if it exists
                // If not in list yet, set to null to avoid incomplete data
                // fetchBookingDetails will load complete data immediately
                // Use refs to avoid stale closure issues
                const fullBooking = bookingsRef.current.find(b => b.id === booking.id)
                if (fullBooking) {
                  setSelectedBooking(fullBooking)
                  // Update ref immediately to ensure fetchBookingDetails can check it correctly
                  // (state updates are async, but ref updates are synchronous)
                  selectedBookingRef.current = fullBooking
                  selectedBookingIdRef.current = fullBooking.id
                } else {
                  // If booking not in list yet, set to null to prevent rendering with incomplete data
                  // The dialog will show loading state until fetchBookingDetails completes
                  setSelectedBooking(null)
                  selectedBookingRef.current = null
                  selectedBookingIdRef.current = null
                  // Set flag to indicate intentional fetch (allows update even when ref is null)
                  intentionalFetchRef.current = booking.id
                }
                setLoadingBookingDetails(true)
                setViewDialogOpen(true)
                await fetchBookingDetails(booking.id)
                // Clear intentional fetch flag after fetch completes
                if (intentionalFetchRef.current === booking.id) {
                  intentionalFetchRef.current = null
                }
              },
            },
            duration: 5000,
          })
          
          // Update new responses count only when notification is shown
          // This ensures the badge count matches the number of notifications displayed
          setNewResponsesCount(prev => prev + 1)
        }
      }
    },
    onDepositUpload: (event: BookingUpdateEvent) => {
      // Handle deposit upload events
      const booking = event.booking
      
      if (!booking || !booking.deposit_evidence_url) return
      
      // Always update the list first to ensure data is fresh
      updateItem(booking.id, {
        status: booking.status as any,
        name: booking.name,
        email: booking.email,
        event_type: booking.event_type,
        start_date: booking.start_date,
        end_date: booking.end_date ?? null,
        start_time: booking.start_time ?? '',
        end_time: booking.end_time ?? '',
        updated_at: booking.updated_at,
        user_response: booking.user_response ?? null,
        response_date: booking.response_date ?? null,
        deposit_evidence_url: booking.deposit_evidence_url ?? null,
        deposit_verified_at: booking.deposit_verified_at ?? null,
        proposed_date: booking.proposed_date ?? null,
        proposed_end_date: booking.proposed_end_date ?? null,
      })
      
      // If dialog is open and this is the selected booking, refresh dialog details
      // But only if no nested dialogs are open (to avoid interrupting user workflow)
      // Use refs to avoid stale closure issues
      if (viewDialogOpenRef.current && selectedBookingRef.current?.id === booking.id && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current) {
        fetchBookingDetails(booking.id)
      }
      
      // Show notification only when no dialogs are open (to avoid disrupting user workflow)
      // Use refs to avoid stale closure issues
      const noDialogsOpen = !viewDialogOpenRef.current && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current
      if (noDialogsOpen) {
        toast.success(`Deposit Evidence Uploaded: ${booking.name}`, {
          id: `deposit-uploaded-${booking.id}`,
          description: "A deposit evidence has been uploaded and requires verification.",
          action: {
            label: "View",
            onClick: async () => {
              // Find booking from list (has all fields) - only use if it exists
              // If not in list yet, set to null to avoid incomplete data
              // fetchBookingDetails will load complete data immediately
              // Use refs to avoid stale closure issues
              const fullBooking = bookingsRef.current.find(b => b.id === booking.id)
              if (fullBooking) {
                setSelectedBooking(fullBooking)
                // Update ref immediately to ensure fetchBookingDetails can check it correctly
                // (state updates are async, but ref updates are synchronous)
                selectedBookingRef.current = fullBooking
                selectedBookingIdRef.current = fullBooking.id
              } else {
                // If booking not in list yet, set to null to prevent rendering with incomplete data
                // The dialog will show loading state until fetchBookingDetails completes
                setSelectedBooking(null)
                selectedBookingRef.current = null
                selectedBookingIdRef.current = null
                // Set flag to indicate intentional fetch (allows update even when ref is null)
                intentionalFetchRef.current = booking.id
              }
              setLoadingBookingDetails(true)
              setViewDialogOpen(true)
              await fetchBookingDetails(booking.id)
              // Clear intentional fetch flag after fetch completes
              if (intentionalFetchRef.current === booking.id) {
                intentionalFetchRef.current = null
              }
            },
          },
          duration: 8000,
        })
      }
    },
    onBookingUpdate: (event: BookingUpdateEvent) => {
      // Handle general booking updates (fallback for events without specific handlers)
      // Skip events that are already handled by specific callbacks to avoid duplicate operations
      if (
        event.type === 'booking:status_changed' ||
        event.type === 'booking:user_response' ||
        event.type === 'booking:deposit_uploaded'
      ) {
        // These events are handled by their specific callbacks (onStatusChange, onUserResponse, onDepositUpload)
        return
      }
      
      const booking = event.booking
      
      if (!booking) return
      
      // Always update the list first to ensure data is fresh
      updateItem(booking.id, {
        status: booking.status as any,
        name: booking.name,
        email: booking.email,
        event_type: booking.event_type,
        start_date: booking.start_date,
        end_date: booking.end_date ?? null,
        start_time: booking.start_time ?? '',
        end_time: booking.end_time ?? '',
        updated_at: booking.updated_at,
        user_response: booking.user_response ?? null,
        response_date: booking.response_date ?? null,
        deposit_evidence_url: booking.deposit_evidence_url ?? null,
        deposit_verified_at: booking.deposit_verified_at ?? null,
        proposed_date: booking.proposed_date ?? null,
        proposed_end_date: booking.proposed_end_date ?? null,
      })
      
      // If dialog is open and this is the selected booking, refresh dialog details
      // But only if no nested dialogs are open (to avoid interrupting user workflow)
      // Use refs to avoid stale closure issues
      if (viewDialogOpenRef.current && selectedBookingRef.current?.id === booking.id && !statusDialogOpenRef.current && !confirmationDialogOpenRef.current && !feeDialogOpenRef.current && !deleteDialogOpenRef.current && !otherChannelDialogOpenRef.current) {
        fetchBookingDetails(booking.id)
      }
    },
  })
  
  // Update SSE status state for fallback polling
  useEffect(() => {
    setSseError(sseHookResult.error)
    setSseConnected(sseHookResult.connected)
  }, [sseHookResult.error, sseHookResult.connected])

  // REMOVED: Old polling logic replaced by SSE above
  // Polling has been completely replaced with useAdminBookingsSSE hook for real-time updates

  // Fetch unavailable dates for date change calendar (excludes current booking's dates)
  const fetchUnavailableDatesForDateChange = useCallback(async (bookingId: string | null) => {
    // Abort previous request if still in flight
    if (unavailableDatesAbortControllerRef.current) {
      unavailableDatesAbortControllerRef.current.abort()
    }
    
    // Create new AbortController for this request
    const abortController = new AbortController()
    unavailableDatesAbortControllerRef.current = abortController
    
    try {
      const url = bookingId 
        ? buildApiUrl(API_PATHS.bookingAvailability, { bookingId })
        : API_PATHS.bookingAvailability
      
      const response = await fetch(url, { signal: abortController.signal })
      const json = await response.json()
      
      // Check if request was aborted before setting state
      if (abortController.signal.aborted) {
        return
      }
      
      if (json.success) {
        const unavailableDatesArray = json.data?.unavailableDates || json.unavailableDates || []
        const unavailableTimeRangesArray = json.data?.unavailableTimeRanges || json.unavailableTimeRanges || []
        setUnavailableDatesForDateChange(new Set(unavailableDatesArray))
        setUnavailableTimeRangesForDateChange(unavailableTimeRangesArray)
        console.log(`[Admin] Unavailable dates fetched for date change (excluding booking ${bookingId || 'none'}): ${unavailableDatesArray.length} dates`)
      } else {
        console.error("[Admin] Failed to fetch unavailable dates for date change:", json)
        setUnavailableDatesForDateChange(new Set())
        setUnavailableTimeRangesForDateChange([])
      }
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        console.error("Failed to fetch unavailable dates for date change:", error)
        // Only update state if request wasn't aborted
        if (!abortController.signal.aborted) {
          setUnavailableDatesForDateChange(new Set())
          setUnavailableTimeRangesForDateChange([])
        }
      } finally {
        // Clear ref if this was the current request
        if (unavailableDatesAbortControllerRef.current === abortController) {
          unavailableDatesAbortControllerRef.current = null
        }
      }
  }, [])

  // Fetch unavailable dates when date change dialog opens and initialize date range toggle
  useEffect(() => {
    // Capture values at start of effect to avoid stale closures
    const currentBookingId = selectedBooking?.id
    const currentStatus = selectedBooking?.status
    const currentEndDate = selectedBooking?.end_date
    const currentAction = selectedAction
    
    if (currentAction === "change_date" && currentBookingId && currentStatus === "confirmed") {
      // Fetch unavailable dates excluding current booking's dates
      fetchUnavailableDatesForDateChange(currentBookingId)
      // Initialize date range toggle based on current booking
      setDateRangeToggle(currentEndDate ? "multiple" : "single")
      } else {
        // Abort any in-flight requests when dialog closes
        if (unavailableDatesAbortControllerRef.current) {
          unavailableDatesAbortControllerRef.current.abort()
          unavailableDatesAbortControllerRef.current = null
        }
        // Clear unavailable dates when dialog closes
        setUnavailableDatesForDateChange(new Set())
        setUnavailableTimeRangesForDateChange([])
        // Reset date range toggle
        setDateRangeToggle("single")
      }
      
      // Cleanup: abort any in-flight requests when effect re-runs or component unmounts
      return () => {
        if (unavailableDatesAbortControllerRef.current) {
          unavailableDatesAbortControllerRef.current.abort()
          unavailableDatesAbortControllerRef.current = null
        }
      }
  }, [selectedAction, selectedBooking?.id, selectedBooking?.status, selectedBooking?.end_date, fetchUnavailableDatesForDateChange])

  // Polling integration: Refresh unavailable dates when date change dialog is open
  useEffect(() => {
    if (selectedAction === "change_date" && selectedBooking?.id && selectedBooking.status === "confirmed") {
      // Capture booking ID to avoid stale closure
      const targetBookingId = selectedBooking.id
      
      // Set up interval to refresh unavailable dates every 30 seconds while dialog is open
      const refreshInterval = setInterval(() => {
        // Verify booking ID still matches before fetching (prevents fetching for wrong booking)
        if (selectedBookingIdRef.current === targetBookingId) {
          fetchUnavailableDatesForDateChange(targetBookingId)
        }
      }, 30000) // Same interval as main polling

      return () => clearInterval(refreshInterval)
    }
  }, [selectedAction, selectedBooking?.id, selectedBooking?.status, fetchUnavailableDatesForDateChange])

  // Fetch booking details and history
  const fetchBookingDetails = useCallback(async (bookingId: string) => {
    // Clear any pending fee history timeout from previous fetch
    if (feeHistoryTimeoutRef.current) {
      clearTimeout(feeHistoryTimeoutRef.current)
      feeHistoryTimeoutRef.current = null
    }
    setLoadingBookingDetails(true)
    try {
      // Add cache-busting parameter to ensure fresh data
      const response = await fetch(buildApiUrl(API_PATHS.adminBooking(bookingId), { t: Date.now() }))
      const json = await response.json()
      
      if (json.success && json.data) {
        const booking = json.data.booking
        const statusHistory = (json.data.statusHistory || []).filter((h: StatusHistory) => 
          h.old_status && h.new_status && h.old_status.trim() !== '' && h.new_status.trim() !== ''
        )
        
        // Debug logging (remove in production if needed)
        if (process.env.NODE_ENV === 'development') {
          console.log('[fetchBookingDetails] Received booking data:', {
            bookingId,
            hasBooking: !!booking,
            status: booking?.status,
            oldStatus: selectedBooking?.status,
            statusChanged: selectedBooking?.status !== booking?.status,
            fee_amount: booking?.fee_amount,
            feeAmount: booking?.feeAmount,
            fee_currency: booking?.fee_currency,
            feeCurrency: booking?.feeCurrency,
            bookingKeys: booking ? Object.keys(booking) : [],
          })
        }
        
        if (booking) {
          // Only update selectedBooking if this response is for the currently selected booking
          // This prevents race conditions where an earlier API response overwrites state after user switches bookings
          // Check current state using ref (synced with state via useEffect) to avoid side effects in updater
          const currentBooking = selectedBookingRef.current
          // Update if:
          // 1. A booking is selected AND its ID matches, OR
          // 2. This is an intentional fetch (via onViewBooking) - allows update when booking was cleared before fetch
          const shouldUpdate = (currentBooking && currentBooking.id === bookingId) || 
                               (intentionalFetchRef.current === bookingId)
          
          // Update booking if condition is met (pure state update, no side effects)
          if (shouldUpdate) {
            setSelectedBooking(booking)
          }
          
          // Update related state only if the booking update was actually applied
          // This must be outside the updater function to maintain React's purity requirements
          // and ensure proper batching of related state updates
          if (shouldUpdate) {
            setStatusHistory(statusHistory)
            setOverlappingBookings(json.data.overlappingBookings || [])
            setHasConfirmedOverlap(json.data.hasConfirmedOverlap || false)
            // Reset postpone mode when opening dialog
            setPostponeMode("user-propose")
            setProposedDateRange("single")
            setSelectedStatusInForm(booking.status)
            // Update ref to track current booking ID
            selectedBookingIdRef.current = bookingId
          }
          
          // Fetch fee history only when the booking update was actually applied
          // This prevents fetching fee history for a booking that was rejected due to race conditions
          // Use setTimeout to ensure this happens after the state update completes, and verify the booking ID matches
          if (shouldUpdate) {
            // Capture bookingId in a const to avoid closure issues
            const targetBookingId = bookingId
            // Clear any existing timeout
            if (feeHistoryTimeoutRef.current) {
              clearTimeout(feeHistoryTimeoutRef.current)
            }
            feeHistoryTimeoutRef.current = setTimeout(async () => {
              // Double-check that the selected booking still matches before fetching fee history
              // This prevents race conditions where user switches bookings before the setTimeout executes
              // Fetch fee history asynchronously - check state outside updater to maintain React purity
              fetch(buildApiUrl(API_PATHS.adminBookingFeeHistory(targetBookingId), { t: Date.now() }))
                .then((feeHistoryResponse) => feeHistoryResponse.json())
                .then((feeHistoryJson) => {
                  if (feeHistoryJson.success && feeHistoryJson.data) {
                    // Verify booking still matches before setting fee history
                    // Check ref outside state updater to maintain React purity
                    if (selectedBookingIdRef.current === targetBookingId) {
                      // Booking still matches - set fee history outside state updater
                      setFeeHistory(feeHistoryJson.data.history || [])
                    }
                  } else {
                    // API returned non-success response - clear fee history to prevent stale data
                    // Only clear if booking still matches
                    if (selectedBookingIdRef.current === targetBookingId) {
                      setFeeHistory([])
                    }
                  }
                })
                .catch((feeError) => {
                  console.error("Failed to load fee history:", feeError)
                  // Only clear fee history if booking still matches
                  // Check ref outside state updater to maintain React purity
                  if (selectedBookingIdRef.current === targetBookingId) {
                    // Booking still matches - clear fee history outside state updater
                    setFeeHistory([])
                  }
                })
            }, 0)
            // Clear ref after timeout is set (will be cleared on next fetch or unmount)
          }
        } else {
          toast.error("Booking data not found in response")
          // Only clear selectedBooking and close dialog if the error is for the currently selected booking
          // If the current booking doesn't match bookingId, the user has moved on to a different booking,
          // so we should ignore this error to prevent race conditions from clearing the wrong booking
          // Read current state using functional update, then check and close outside updater
          let shouldClose = false
          setSelectedBooking((current) => {
            // Check if this error is for the currently selected booking
            if (current && current.id === bookingId) {
              shouldClose = true
            }
            // Return unchanged to just read the state
            return current
          })
          // Close dialog outside state updater if booking matches
          if (shouldClose) {
            setSelectedBooking(null)
            setViewDialogOpen(false)
          }
          // Clear intentional fetch flag on error
          if (intentionalFetchRef.current === bookingId) {
            intentionalFetchRef.current = null
          }
        }
      } else {
        const errorMessage = json.error?.message || "Failed to load booking details"
        toast.error(errorMessage)
        // Only clear selectedBooking and close dialog if the error is for the currently selected booking
        // If the current booking doesn't match bookingId, the user has moved on to a different booking,
        // so we should ignore this error to prevent race conditions from clearing the wrong booking
        // Read current state using functional update, then check and close outside updater
        let shouldClose = false
        setSelectedBooking((current) => {
          // Check if this error is for the currently selected booking
          if (current && current.id === bookingId) {
            shouldClose = true
          }
          // Return unchanged to just read the state
          return current
        })
        // Close dialog outside state updater if booking matches
        if (shouldClose) {
          setSelectedBooking(null)
          setViewDialogOpen(false)
        }
        // Clear intentional fetch flag on error
        if (intentionalFetchRef.current === bookingId) {
          intentionalFetchRef.current = null
        }
      }
    } catch (error) {
      toast.error("Failed to load booking details")
      console.error(error)
      // Only clear selectedBooking and close dialog if the error is for the currently selected booking
      // If the current booking doesn't match bookingId, the user has moved on to a different booking,
      // so we should ignore this error to prevent race conditions from clearing the wrong booking
      // Read current state using functional update, then check and close outside updater
      let shouldClose = false
      setSelectedBooking((current) => {
        // Check if this error is for the currently selected booking
        if (current && current.id === bookingId) {
          shouldClose = true
        }
        // Return unchanged to just read the state
        return current
      })
      // Close dialog outside state updater if booking matches
      if (shouldClose) {
        setSelectedBooking(null)
        setViewDialogOpen(false)
      }
      // Clear intentional fetch flag on error
      if (intentionalFetchRef.current === bookingId) {
        intentionalFetchRef.current = null
      }
    } finally {
      setLoadingBookingDetails(false)
    }
  }, [])
  
  // Helper function to refresh booking details dialog after admin actions
  // This ensures the dialog always shows the latest status and data
  const refreshBookingDetailsDialog = useCallback(async (bookingId: string) => {
    // Use ref to avoid stale closure issues
    if (!viewDialogOpenRef.current || !bookingId) return
    
    // Verify booking ID still matches before fetching (prevents fetching for wrong booking)
    if (selectedBookingIdRef.current !== bookingId) {
      return
    }
    
    // Reset the ref to force refetch
    lastFetchedBookingIdRef.current = null
    
    // Add small delay to ensure backend cache invalidation completes
    await new Promise(resolve => setTimeout(resolve, 150))
    
    // Double-check booking ID still matches after delay (prevents race conditions)
    if (selectedBookingIdRef.current !== bookingId || !viewDialogOpenRef.current) {
      return
    }
    
    // Fetch fresh data
    await fetchBookingDetails(bookingId)
  }, [fetchBookingDetails])

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
        // Optimistically remove from list
        removeItem(bookingToDelete.id)
        const message = json.data?.message || "Booking deleted successfully. Notifications sent if applicable."
        toast.success(message, {
          id: `delete-success-${bookingToDelete.id}`,
        })
        setViewDialogOpen(false)
        setStatusDialogOpen(false)
        setDeleteDialogOpen(false)
        setBookingToDelete(null)
      } else {
        // Rollback on error
        fetchBookings()
        const errorMessage = json.error?.message || "Failed to delete booking"
        toast.error(errorMessage, {
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

  // Map admin action to status (using state machine)
  const mapActionToStatusLocal = (action: string, currentStatus: string): string => {
    // Use state machine to get target status
    return mapActionToStatus(action as any, currentStatus as any) || currentStatus
  }

  // Check action locks for selected booking and action (real-time via SSE)
  const { 
    lockStatus: actionLockStatus, 
    isLockedByOther: isActionLockedByOther,
    isLockedByMe: isActionLockedByMe,
  } = useActionLocksSSE({
    resourceType: 'booking',
    resourceId: selectedBooking?.id,
    action: selectedAction || undefined,
    enabled: !!selectedBooking && !!selectedAction && statusDialogOpen,
  })

  // Handle action update with validation
  const handleActionUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedBooking) return

    if (!selectedAction) {
      toast.error("Please select an action")
      return
    }

    // CRITICAL: Check if action is locked by another admin
    if (isActionLockedByOther) {
      const lockedBy = actionLockStatus.lockedBy || "another admin"
      toast.error(`This action is currently being performed by ${lockedBy}. Please wait a moment and try again.`, {
        duration: 5000,
      })
      return
    }

    // Check if booking date is in the past
    const now = getBangkokTime()
    const startTimestamp = calculateStartTimestamp(selectedBooking.start_date, selectedBooking.start_time || null)
    const isDateInPast = startTimestamp < now

    // Get available actions from state machine
    const availableActions = getAvailableActions(
      selectedBooking.status as any,
      Boolean(selectedBooking.deposit_evidence_url),
      isDateInPast
    )
    
    // Find the selected action definition
    const actionDef = availableActions.find((a) => a.id === selectedAction)

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

    // CRITICAL: Capture booking ID before any async operations to prevent race conditions
    // This ensures error handlers use the correct booking ID even if user switches bookings
    const targetBookingId = selectedBooking.id

    // CRITICAL: Double-check lock status before executing
    if (isActionLockedByOther) {
      const lockedBy = actionLockStatus.lockedBy || "another admin"
      toast.error(`This action is currently being performed by ${lockedBy}. Please wait a moment and try again.`, {
        duration: 5000,
      })
      return
    }

    setSaving(true)
    const form = document.querySelector('form[onSubmit]') as HTMLFormElement
    const formData = form ? new FormData(form) : new FormData()
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string
    
    // Map action to status
    const status = mapActionToStatusLocal(selectedAction!, selectedBooking.status)
    
    // Handle date change for confirmed bookings
    let dateChangePayload: any = {}
    if (selectedAction === "change_date" && selectedBooking.status === "confirmed") {
      if (!newStartDate) {
        toast.error("Please select a new start date")
        setSaving(false)
        return
      }
      
      // PRE-SUBMIT REFRESH: Refresh unavailable dates right before submission to minimize race condition window
      // Use captured booking ID to prevent race conditions
      try {
        await fetchUnavailableDatesForDateChange(targetBookingId)
        console.log("[Admin] Refreshed unavailable dates before submission")
      } catch (error) {
        console.error("[Admin] Failed to refresh unavailable dates before submission:", error)
        // Continue anyway - backend will catch overlaps
      }
      
      // Validate selected dates against latest unavailable dates
      // CRITICAL: Validate date range consistency (frontend validation matching backend)
      const startDateStr = dateToBangkokDateString(newStartDate)
      if (unavailableDatesForDateChange.has(startDateStr)) {
        toast.error("The selected start date is no longer available. Please choose a different date.")
        setSaving(false)
        return
      }
      if (newEndDate) {
        const endDateStr = dateToBangkokDateString(newEndDate)
        
        // Check if end date is unavailable
        if (unavailableDatesForDateChange.has(endDateStr)) {
          toast.error("The selected end date is no longer available. Please choose a different date.")
          setSaving(false)
          return
        }
        
        // Validate that end_date >= start_date
        if (endDateStr < startDateStr) {
          toast.error("End date must be after or equal to start date.")
          setSaving(false)
          return
        }
      }
      
      // CRITICAL: If end_date equals start_date, treat as single-day booking
      // This matches backend validation logic
      const isEffectivelySingleDay = !newEndDate || dateToBangkokDateString(newEndDate) === startDateStr
      
      // Validate time range for single-day bookings (including when end_date equals start_date)
      if (isEffectivelySingleDay) {
        const effectiveStartTime = newStartTime || selectedBooking.start_time || null
        const effectiveEndTime = newEndTime || selectedBooking.end_time || null
        
        if (effectiveStartTime && effectiveEndTime) {
          const parseTime = (timeStr: string): { hour24: number; minutes: number } | null => {
            const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
            if (match) {
              const hour24 = parseInt(match[1], 10)
              const minutes = parseInt(match[2] || '00', 10)
              if (hour24 >= 0 && hour24 <= 23 && minutes >= 0 && minutes <= 59) {
                return { hour24, minutes }
              }
            }
            return null
          }
          
          const startParsed = parseTime(effectiveStartTime)
          const endParsed = parseTime(effectiveEndTime)
          
          if (startParsed && endParsed) {
            const startTotal = startParsed.hour24 * 60 + startParsed.minutes
            const endTotal = endParsed.hour24 * 60 + endParsed.minutes
            
            if (endTotal <= startTotal) {
              toast.error("For single-day bookings, end time must be after start time.")
              setSaving(false)
              return
            }
          }
        }
      }
      
      // CRITICAL: Validate that end timestamp > start timestamp (accounts for dates + times)
      // Use createBangkokTimestamp to ensure correct timezone handling
      // Pattern: createBangkokTimestamp(dateString, null) then calculateStartTimestamp(timestamp, timeString)
      const { createBangkokTimestamp: createBangkokTimestampClient } = await import("@/lib/timezone-client")
      const startDateTimestamp = createBangkokTimestampClient(startDateStr, null)
      const startTimestamp = calculateStartTimestamp(
        startDateTimestamp,
        newStartTime || selectedBooking.start_time || null
      )
      
      let endTimestamp: number
      if (newEndDate) {
        const endDateStr = dateToBangkokDateString(newEndDate)
        const endDateTimestamp = createBangkokTimestampClient(endDateStr, null)
        const effectiveEndTime = newEndTime || selectedBooking.end_time || null
        
        // For multi-day bookings, calculate end timestamp from end_date + end_time
        if (effectiveEndTime) {
          const parseTime = (timeStr: string): { hour24: number; minutes: number } | null => {
            const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/)
            if (match) {
              const hour24 = parseInt(match[1], 10)
              const minutes = parseInt(match[2] || '00', 10)
              if (hour24 >= 0 && hour24 <= 23 && minutes >= 0 && minutes <= 59) {
                return { hour24, minutes }
              }
            }
            return null
          }
          
          const endParsed = parseTime(effectiveEndTime)
          if (endParsed) {
            try {
              const { TZDate } = await import('@date-fns/tz')
              const BANGKOK_TIMEZONE = 'Asia/Bangkok'
              const utcDate = new Date(endDateTimestamp * 1000)
              const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
              const year = tzDate.getFullYear()
              const month = tzDate.getMonth()
              const day = tzDate.getDate()
              const tzDateWithTime = new TZDate(year, month, day, endParsed.hour24, endParsed.minutes, 0, BANGKOK_TIMEZONE)
              endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
            } catch (error) {
              endTimestamp = endDateTimestamp
            }
          } else {
            endTimestamp = endDateTimestamp
          }
        } else {
          endTimestamp = endDateTimestamp
        }
      } else {
        // Single-day booking: calculate end timestamp from start_date + end_time
        const effectiveEndTime = newEndTime || selectedBooking.end_time || null
        endTimestamp = calculateStartTimestamp(
          startDateTimestamp,
          effectiveEndTime || null
        )
      }
      
      // Final validation: end timestamp must be > start timestamp
      if (endTimestamp <= startTimestamp) {
        toast.error("The booking end date and time must be after the start date and time.")
        setSaving(false)
        return
      }
      
      // Check for past date warning
      const bangkokNow = getBangkokTime()
      const isPast = startTimestamp < bangkokNow
      
      if (isPast && !showPastDateWarning) {
        toast.error("Please acknowledge the past date warning before proceeding")
        setSaving(false)
        return
      }

      // Simplified end date handling: if toggle is "single", send null to clear end_date
      // If toggle is "multiple" and newEndDate is set, send it; otherwise send undefined to keep existing
      const endDateValue = dateRangeToggle === "single" 
        ? null 
        : (newEndDate ? dateToBangkokDateString(newEndDate) : undefined)
      
      dateChangePayload = {
        newStartDate: dateToBangkokDateString(newStartDate),
        newEndDate: endDateValue,
        newStartTime: newStartTime || selectedBooking.start_time || undefined,
        newEndTime: newEndTime || selectedBooking.end_time || undefined,
      }
    }

    // No proposed dates in new flow (date changes handled separately for confirmed bookings)
    let proposedDate: string | null = null

    // Automatically use admin email for deposit verification when accepting deposit
    const adminEmail = session?.user?.email || session?.user?.name || "Admin"
    const shouldVerifyDeposit = (selectedAction === "accept_deposit" && status === "confirmed")
    const depositVerifiedBy = shouldVerifyDeposit ? adminEmail : undefined

    try {
      const response = await fetch(API_PATHS.adminBooking(selectedBooking.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: status,
          action: selectedAction, // Pass action to API to detect "other channel" actions
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          depositVerifiedBy: depositVerifiedBy, // Automatically use admin email
          proposedDate: proposedDate,
          proposedStartDate: null,
          proposedEndDate: null,
          proposedStartTime: null,
          proposedEndTime: null,
          ...dateChangePayload,
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        const updatedBooking = json.data?.booking || json.booking
        // Optimistically update the booking
        if (updatedBooking && selectedBooking) {
          replaceItem(selectedBooking.id, updatedBooking)
        }
        const actionLabels: Record<string, string> = {
          accept: "accepted",
          reject: "rejected",
          accept_deposit: "deposit accepted",
          accept_deposit_other_channel: "confirmed (other channel)",
          confirm_other_channel: "confirmed (other channel)",
          reject_deposit: "deposit rejected",
          cancel: "cancelled",
          change_date: "date changed"
        }
        const actionLabel = actionLabels[selectedAction || ""] || "updated"
        const emailMessage = selectedAction === "change_date" 
          ? "Email notification sent to user about date change."
          : "Email notification sent."
        toast.success(`Booking ${actionLabel} successfully. ${emailMessage}`)
        
        // Invalidate admin stats cache to update notification badges
        // This triggers automatic refetch of stats without manual polling
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminStats')
          window.dispatchEvent(event)
        }
        
        // Invalidate bookings cache to trigger refetch
        // This ensures the list updates immediately after action
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminBookings')
          window.dispatchEvent(event)
        }
        
        // Reset date change state
        setNewStartDate(null)
        setNewEndDate(null)
        setNewStartTime("")
        setNewEndTime("")
        setShowPastDateWarning(false)
        setDateRangeToggle("single")
        
        // Refresh unavailable dates if date was changed (to reflect new blocked dates)
        // Verify booking ID still matches before fetching (prevents fetching for wrong booking)
        if (selectedAction === "change_date" && selectedBookingIdRef.current === targetBookingId) {
          fetchUnavailableDatesForDateChange(targetBookingId)
        }
        
        // CRITICAL: Use ref to avoid stale closure issues
        // Capture current booking from ref at start of callback
        const currentBooking = selectedBookingRef.current
        
        // CRITICAL: Close ALL dialogs when booking is cancelled or restored
        // This prevents showing stale data in modals after status changes
        const newStatus = updatedBooking?.status || currentBooking?.status
        const isCancelled = newStatus === "cancelled"
        const isRestoration = currentBooking?.status === "cancelled" && 
          (newStatus === "pending_deposit" || newStatus === "paid_deposit" || newStatus === "confirmed")
        
        setStatusDialogOpen(false)
        setSelectedAction(null)
        setSelectedStatusInForm("")
        setPostponeMode("user-propose")
        setProposedDateRange("single")
        setConfirmationDialogOpen(false)
        setPendingAction(null)
        setPendingValidation(null)
        
        // Close view dialog if booking is cancelled or restored
        // This ensures user sees updated booking list immediately without stale modal data
        if (isCancelled || isRestoration) {
          setViewDialogOpen(false)
          setSelectedBooking(null)
        } else if (viewDialogOpenRef.current && selectedBookingIdRef.current) {
          // CRITICAL: Always refresh booking details after any admin update action
          // This ensures the dialog shows the latest status and data
          // Use captured booking ID to prevent race conditions
          await refreshBookingDetailsDialog(selectedBookingIdRef.current)
        }
      } else {
          // Rollback on error
          fetchBookings()
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
                  // Use captured booking ID to prevent race conditions
                  // Check if booking still matches before refreshing
                  if (selectedBookingIdRef.current === targetBookingId) {
                    await fetchBookingDetails(targetBookingId)
                  }
                  fetchBookings()
                },
              },
            })
            // Auto-refresh booking data only if booking still matches
            if (selectedBookingIdRef.current === targetBookingId) {
              await fetchBookingDetails(targetBookingId)
            }
          } else if (parsedError.type === 'transition') {
            // Show transition error with valid options
            toast.error(errorMessage)
          } else {
            toast.error(errorMessage)
          }
        }
      } catch (error) {
        // Rollback on error
        fetchBookings()
        const { parseBackendError, getErrorMessageWithGuidance } = await import("@/lib/error-parser")
        const parsedError = parseBackendError(error instanceof Error ? error : new Error(String(error)))
        const errorMessage = getErrorMessageWithGuidance(parsedError)
        
        // Check if error is due to optimistic locking conflict
        if (parsedError.type === 'conflict') {
          toast.error(parsedError.userMessage, {
            action: {
              label: "Refresh",
              onClick: async () => {
                // Use captured booking ID to prevent race conditions
                // Check if booking still matches before refreshing
                if (selectedBookingIdRef.current === targetBookingId) {
                  await fetchBookingDetails(targetBookingId)
                }
                fetchBookings()
              },
            },
          })
          // Auto-refresh booking data only if booking still matches
          if (selectedBookingIdRef.current === targetBookingId) {
            await fetchBookingDetails(targetBookingId)
          }
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

  // Handle fee update
  const handleFeeUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!selectedBooking) {
      toast.error("No booking selected")
      return
    }
    
    // Capture booking ID before any async operations to prevent race conditions
    const targetBookingId = selectedBooking.id

    // Validate status allows fee recording
    if (selectedBooking.status !== "confirmed" && selectedBooking.status !== "finished" && selectedBooking.status !== "cancelled") {
      toast.error("Fee can only be recorded for confirmed, finished, or cancelled bookings")
      return
    }

    // Parse and validate inputs
    const originalAmount = parseFloat(feeAmountOriginal)
    if (isNaN(originalAmount) || originalAmount < 0) {
      toast.error("Please enter a valid original amount")
      return
    }

    const currencyUpper = feeCurrency.toUpperCase()
    let conversionRate: number | null = null
    let baseAmount: number | null = null

    if (currencyUpper === "THB") {
      // THB: no conversion needed
      baseAmount = originalAmount
    } else {
      // Foreign currency: need conversion
      if (feeConversionRate && feeConversionRate.trim() !== "") {
        const rate = parseFloat(feeConversionRate)
        if (isNaN(rate) || rate < 0.01 || rate > 10000) {
          toast.error("Conversion rate must be between 0.01 and 10000")
          return
        }
        conversionRate = rate
        baseAmount = originalAmount * rate
      } else if (feeAmount && feeAmount.trim() !== "") {
        const amount = parseFloat(feeAmount)
        if (isNaN(amount) || amount < 0) {
          toast.error("Please enter a valid base amount (THB)")
          return
        }
        baseAmount = amount
        conversionRate = amount / originalAmount
        if (conversionRate < 0.01 || conversionRate > 10000) {
          toast.error("Calculated conversion rate is outside reasonable range")
          return
        }
      } else {
        toast.error("Either conversion rate or base amount (THB) must be provided for non-THB currency")
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl(API_PATHS.adminBooking(selectedBooking.id) + "/fee"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feeAmountOriginal: originalAmount,
          feeCurrency: currencyUpper,
          feeConversionRate: conversionRate,
          feeAmount: baseAmount,
          feeNotes: feeNotes.trim() || null,
        }),
      })

      const json = await response.json()

      if (json.success) {
        const hasFee = (selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount
        toast.success(hasFee ? "Fee updated successfully" : "Fee recorded successfully")
        setFeeDialogOpen(false)
        
        // Get updated booking from response
        const updatedBooking = json.data?.booking
        
        // Debug logging
        if (process.env.NODE_ENV === 'development') {
          console.log('[handleFeeUpdate] Fee update response:', {
            hasResponse: !!json.data,
            hasBooking: !!updatedBooking,
            bookingId: selectedBooking.id,
            fee_amount: updatedBooking?.fee_amount,
            feeAmount: updatedBooking?.feeAmount,
            fee_currency: updatedBooking?.fee_currency,
            feeCurrency: updatedBooking?.feeCurrency,
            updatedBookingKeys: updatedBooking ? Object.keys(updatedBooking) : [],
            fullBooking: updatedBooking,
          })
        }
        
        if (updatedBooking) {
          // Verify booking ID still matches before updating (prevents race conditions)
          if (selectedBookingIdRef.current === targetBookingId) {
            // Optimistically update the booking in the list
            replaceItem(targetBookingId, updatedBooking)
            // Also update selected booking for the detail view
            setSelectedBooking(updatedBooking)
          }
          
          // Debug logging after update
          if (process.env.NODE_ENV === 'development') {
            console.log('[handleFeeUpdate] Updated selectedBooking:', {
              fee_amount: updatedBooking.fee_amount,
              feeAmount: updatedBooking.feeAmount,
              fee_currency: updatedBooking.fee_currency,
            })
          }
        }
        
        // CRITICAL: Always refresh booking details after fee update
        // This ensures the dialog shows the latest fee data and status
        // Use captured booking ID to prevent race conditions
        // Use ref to avoid stale closure issues
        if (viewDialogOpenRef.current) {
          await refreshBookingDetailsDialog(targetBookingId)
        }
        
        // Invalidate and refetch bookings list to ensure fresh data
        // Trigger invalidation event for React Query cache
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminBookings')
          window.dispatchEvent(event)
        }
        await fetchBookings()
      } else {
        const errorMessage = json.error?.message || "Failed to update fee"
        toast.error(errorMessage)
      }
    } catch (error) {
      console.error("Error updating fee:", error)
      toast.error("Failed to update fee. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  // Auto-calculate fee amounts when values change
  useEffect(() => {
    if (!feeDialogOpen) return

    const original = parseFloat(feeAmountOriginal)
    const currencyUpper = feeCurrency.toUpperCase()

    if (isNaN(original) || original <= 0) {
      if (currencyUpper === "THB") {
        setFeeAmount("")
      } else {
        setFeeAmount("")
        setFeeConversionRate("")
      }
      return
    }

    if (currencyUpper === "THB") {
      // THB: base amount = original amount (always)
      setFeeAmount(original.toFixed(2))
      setFeeConversionRate("")
    } else {
      // Foreign currency: calculate based on what's provided
      // Priority: If rate is provided, calculate base amount
      // If base amount is provided, calculate rate
      if (feeConversionRate && feeConversionRate.trim() !== "") {
        const rate = parseFloat(feeConversionRate)
        if (!isNaN(rate) && rate > 0) {
          const calculated = original * rate
          setFeeAmount(calculated.toFixed(2))
        }
      } else if (feeAmount && feeAmount.trim() !== "") {
        const amount = parseFloat(feeAmount)
        if (!isNaN(amount) && amount > 0 && original > 0) {
          const calculated = amount / original
          setFeeConversionRate(calculated.toFixed(4))
        }
      }
    }
  }, [feeAmountOriginal, feeCurrency, feeConversionRate, feeAmount, feeDialogOpen])


  // Only show full-page loading on initial load (when there's no data yet)
  // When refetching with existing data, show content with a subtle loading indicator
  if (status === "loading" || (loading && bookings.length === 0)) {
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
                    lastCheckedAtRef.current = Date.now()
                  }}
                >
                  Mark as read
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setExportDialogOpen(true)}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Link href="/admin/bookings/archive" prefetch={false}>
              <Button variant="outline">
                <Archive className="w-4 h-4 mr-2" />
                View Archive
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Advanced Filters */}
      <AdvancedBookingFilters
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        statusFilters={statusFilters}
        onStatusFiltersChange={setStatusFilters}
        emailFilter={emailFilter}
        onEmailFilterChange={setEmailFilter}
        onEmailSearch={handleEmailSearch}
        onEmailDebouncedSearch={handleEmailDebouncedSearch}
        referenceNumberFilter={referenceNumberFilter}
        onReferenceNumberFilterChange={setReferenceNumberFilter}
        onReferenceNumberSearch={handleReferenceNumberSearch}
        onReferenceNumberDebouncedSearch={handleReferenceNumberDebouncedSearch}
        nameFilter={nameFilter}
        onNameFilterChange={setNameFilter}
        onNameSearch={handleNameSearch}
        onNameDebouncedSearch={handleNameDebouncedSearch}
        phoneFilter={phoneFilter}
        onPhoneFilterChange={setPhoneFilter}
        onPhoneSearch={handlePhoneSearch}
        onPhoneDebouncedSearch={handlePhoneDebouncedSearch}
        eventTypeFilter={eventTypeFilter}
        onEventTypeFilterChange={setEventTypeFilter}
        showOverlappingOnly={showOverlappingOnly}
        onShowOverlappingOnlyChange={(value) => setShowOverlappingOnly(value)}
        startDateFrom={startDateFrom}
        onStartDateFromChange={setStartDateFrom}
        startDateTo={startDateTo}
        onStartDateToChange={setStartDateTo}
        useDateRange={useDateRange}
        onUseDateRangeChange={(value) => setUseDateRange(value)}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        eventTypes={eventTypes}
        statuses={availableStatuses}
        depositStatusFilter={depositStatusFilter}
        onDepositStatusFilterChange={setDepositStatusFilter}
        onClearAll={() => {
          setStatusFilter("all")
          setStatusFilters([])
          setEmailFilter("")
          setReferenceNumberFilter("")
          setNameFilter("")
          setPhoneFilter("")
          // CRITICAL: Also clear debounced values to actually clear the filters
          setDebouncedEmailFilter("")
          setDebouncedReferenceNumberFilter("")
          setDebouncedNameFilter("")
          setDebouncedPhoneFilter("")
          setEventTypeFilter("all")
          setDepositStatusFilter("all")
          setShowOverlappingOnly(false)
          setStartDateFrom("")
          setStartDateTo("")
          setUseDateRange(false)
        }}
        hasActiveFilters={Boolean(
          statusFilter !== "all" || 
          statusFilters.length > 0 || 
          debouncedEmailFilter || 
          debouncedReferenceNumberFilter || 
          debouncedNameFilter ||
          depositStatusFilter !== "all" || 
          debouncedPhoneFilter || 
          eventTypeFilter !== "all" || 
          showOverlappingOnly ||
          (useDateRange && (startDateFrom || startDateTo))
        )}
      />
      
      {/* Results Count */}
      {!loading && (
        <div className="mb-4 text-sm text-gray-600">
          {displayTotal > 0 ? (
            <>
              Showing <span className="font-medium">{filteredBookings.length}</span> of <span className="font-medium">{displayTotal}</span> booking{displayTotal !== 1 ? 's' : ''}
              {(statusFilter !== "all" || statusFilters.length > 0 || debouncedEmailFilter || debouncedReferenceNumberFilter || debouncedNameFilter || debouncedPhoneFilter || eventTypeFilter !== "all" || depositStatusFilter !== "all" || showOverlappingOnly || (useDateRange && (startDateFrom || startDateTo))) && (
                <span className="ml-2 text-gray-500">(filtered)</span>
              )}
            </>
          ) : (
            <span>No bookings found</span>
          )}
        </div>
      )}

      {/* Bookings Table */}
      <BookingTable
        bookings={filteredBookings}
        total={displayTotal}
        loading={loading}
        hasMore={displayHasMore}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size)
          fetchBookings()
        }}
        onViewBooking={async (bookingId) => {
          // CRITICAL: Don't set selectedBooking from list - it might be stale
          // Clear any existing selectedBooking to prevent showing stale data
          // Wait for fresh data from API before opening dialog
          setSelectedBooking(null) // Clear stale data first
          // Update refs immediately to ensure fetchBookingDetails can check them correctly
          // (state updates are async, but ref updates are synchronous)
          selectedBookingRef.current = null
          selectedBookingIdRef.current = null
          // Set flag to indicate this is an intentional fetch (allows update even when ref is null)
          intentionalFetchRef.current = bookingId
          setLoadingBookingDetails(true)
          setViewDialogOpen(true)
          // Reset the ref so useEffect will refetch
          lastFetchedBookingIdRef.current = null
          await fetchBookingDetails(bookingId)
          // Clear the flag after fetch completes, but only if it still matches this booking
          // This prevents race conditions where rapid clicks clear the flag for an in-flight fetch
          if (intentionalFetchRef.current === bookingId) {
            intentionalFetchRef.current = null
          }
        }}
        onDeleteBooking={handleDeleteBooking}
        saving={saving}
        scrollSentinelRef={scrollSentinelRef}
        referenceNumberFilter={referenceNumberFilter}
        nameFilter={nameFilter}
        emailFilter={emailFilter}
        phoneFilter={phoneFilter}
        lastCheckedAt={lastCheckedAtRef.current}
      />

      {/* View Booking Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl xl:max-w-6xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              View and manage booking information
            </DialogDescription>
          </DialogHeader>
          {loadingBookingDetails ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-600">Loading booking details...</span>
            </div>
          ) : selectedBooking ? (
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
                  {false && selectedBooking && (
                    <div className="text-sm text-gray-600">
                      <div>
                      Proposed Date: {formatDate(selectedBooking?.proposed_date)}
                        {selectedBooking?.proposed_end_date && selectedBooking?.proposed_end_date !== selectedBooking?.proposed_date && selectedBooking && (
                          <span> - {formatDate(selectedBooking?.proposed_end_date)}</span>
                        )}
                      </div>
                      {/* Parse and display times from user_response */}
                      {selectedBooking?.user_response && (() => {
                        const startTimeMatch = selectedBooking?.user_response?.match(/Start Time: ([^,)]+)/)
                        const endTimeMatch = selectedBooking?.user_response?.match(/End Time: ([^,)]+)/)
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
                          const startTimeStr = startTimeMatch?.[1]
                          const endTimeStr = endTimeMatch?.[1]
                          const startTime = startTimeStr ? parseTime(String(startTimeStr).trim()) : null
                          const endTime = endTimeStr ? parseTime(String(endTimeStr).trim()) : null
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
                    disabled={
                      selectedBooking.status === "finished"
                    }
                    title={
                      selectedBooking.status === "finished" 
                        ? "Finished bookings cannot have their status changed" 
                        : hasConfirmedOverlap && selectedBooking.status !== "cancelled"
                        ? "This booking is blocked by a confirmed overlap. You can only cancel it."
                        : ""
                    }
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
                          Another booking with the same date/time is already CONFIRMED. You can only CANCEL this booking until the confirmed booking is cancelled.
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
                    <Label>Reference Number</Label>
                    <div className="text-sm text-gray-900 font-semibold text-blue-600">
                      {getBookingReferenceNumber(selectedBooking)}
                    </div>
                  </div>
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

              {/* Deposit Evidence Section - Show for paid_deposit and pending_deposit with evidence */}
              {(selectedBooking.status === "paid_deposit" || selectedBooking.status === "pending_deposit") && selectedBooking.deposit_evidence_url && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Deposit Evidence</h3>
                  <div className="bg-purple-50 border border-purple-200 rounded p-4">
                    <div className="space-y-3">
                      <div>
                        <Label>Deposit Evidence Image</Label>
                        <a 
                          href={API_PATHS.adminDepositImage(selectedBooking.id)}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline block mt-1 font-medium"
                        >
                          View Deposit Evidence →
                        </a>
                      </div>
                      {selectedBooking.deposit_verified_at && (
                        <div className="bg-green-50 border border-green-200 rounded p-3">
                          <p className="text-sm text-green-800">
                            ✓ Verified by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Fee Information */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Fee Information</h3>
                  {(selectedBooking.status === "confirmed" || selectedBooking.status === "finished") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // Initialize form with current fee values if updating
                        // Note: selectedBooking from fetchBookingDetails uses camelCase (formatBooking converts it)
                        // But useAdminBookings hook uses snake_case, so we need to check both
                        const currentFeeAmount = (selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount
                        if (currentFeeAmount) {
                          const feeAmountOrig = (selectedBooking as any).fee_amount_original ?? (selectedBooking as any).feeAmountOriginal
                          const feeCurr = (selectedBooking as any).fee_currency ?? (selectedBooking as any).feeCurrency
                          const feeConvRate = (selectedBooking as any).fee_conversion_rate ?? (selectedBooking as any).feeConversionRate
                          const feeNotesVal = (selectedBooking as any).fee_notes ?? (selectedBooking as any).feeNotes
                          
                          setFeeAmountOriginal(feeAmountOrig?.toString() || "")
                          setFeeCurrency(feeCurr || "THB")
                          setFeeConversionRate(feeConvRate?.toString() || "")
                          setFeeAmount(currentFeeAmount.toString())
                          setFeeNotes(feeNotesVal || "")
                        } else {
                          setFeeAmountOriginal("")
                          setFeeCurrency("THB")
                          setFeeConversionRate("")
                          setFeeAmount("")
                          setFeeNotes("")
                        }
                        setFeeDialogOpen(true)
                      }}
                      disabled={saving}
                    >
                      {((selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount) ? "Update Fee" : "Record Fee"}
                    </Button>
                  )}
                  {((selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount) && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        if (!selectedBooking) return
                        
                        if (!confirm("Are you sure you want to clear the fee for this booking? This action cannot be undone.")) {
                          return
                        }
                        
                        setSaving(true)
                        try {
                          const response = await fetch(buildApiUrl(API_PATHS.adminBooking(selectedBooking.id) + "/fee"), {
                            method: "PATCH",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              feeAmountOriginal: null,
                              feeCurrency: null,
                              changeReason: "Fee cleared by admin",
                            }),
                          })
                          
                          const json = await response.json()
                          
                          if (json.success) {
                            toast.success("Fee cleared successfully")
                            // Update selected booking with cleared fee
                            if (json.data?.booking) {
                              setSelectedBooking({
                                ...selectedBooking,
                                ...json.data.booking,
                              })
                            }
                            // Refresh bookings list
                            fetchBookings()
                          } else {
                            toast.error(json.error?.message || "Failed to clear fee")
                          }
                        } catch (error) {
                          toast.error("Failed to clear fee")
                          console.error(error)
                        } finally {
                          setSaving(false)
                        }
                      }}
                      disabled={saving}
                    >
                      Clear Fee
                    </Button>
                  )}
                </div>
                {(() => {
                  // Handle both camelCase (from formatBooking) and snake_case (from useAdminBookings)
                  const feeAmount = (selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount
                  const feeAmountOriginal = (selectedBooking as any).fee_amount_original ?? (selectedBooking as any).feeAmountOriginal
                  const feeCurrency = (selectedBooking as any).fee_currency ?? (selectedBooking as any).feeCurrency
                  const feeConversionRate = (selectedBooking as any).fee_conversion_rate ?? (selectedBooking as any).feeConversionRate
                  const feeRateDate = (selectedBooking as any).fee_rate_date ?? (selectedBooking as any).feeRateDate
                  const feeNotes = (selectedBooking as any).fee_notes ?? (selectedBooking as any).feeNotes
                  const feeRecordedAt = (selectedBooking as any).fee_recorded_at ?? (selectedBooking as any).feeRecordedAt
                  const feeRecordedBy = (selectedBooking as any).fee_recorded_by ?? (selectedBooking as any).feeRecordedBy
                  
                  // Debug logging (remove in production if needed)
                  if (process.env.NODE_ENV === 'development') {
                    console.log('[BookingDetail] Fee data:', {
                      bookingId: selectedBooking.id,
                      bookingReference: (selectedBooking as any).reference_number,
                      fee_amount: (selectedBooking as any).fee_amount,
                      feeAmount: (selectedBooking as any).feeAmount,
                      feeAmountResolved: feeAmount,
                      feeAmountType: typeof feeAmount,
                      feeCurrency,
                      feeAmountOriginal,
                      selectedBookingKeys: Object.keys(selectedBooking),
                      allFeeKeys: Object.keys(selectedBooking).filter(k => k.toLowerCase().includes('fee')),
                      fullSelectedBooking: selectedBooking,
                    })
                  }
                  
                  // Check if fee exists and is a valid positive number
                  // Handle both number and string types
                  let feeNum: number | null = null
                  if (feeAmount != null && feeAmount !== undefined) {
                    if (typeof feeAmount === 'string') {
                      feeNum = parseFloat(feeAmount)
                    } else if (typeof feeAmount === 'number') {
                      feeNum = feeAmount
                    } else {
                      feeNum = Number(feeAmount)
                    }
                  }
                  const hasFee = feeNum !== null && !isNaN(feeNum) && feeNum > 0
                  
                  if (process.env.NODE_ENV === 'development') {
                    console.log('[BookingDetail] Fee check result:', { hasFee, feeNum, feeAmount })
                  }
                  
                  return hasFee ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                      <div className="space-y-2">
                        <div>
                          <Label>Base Amount (THB)</Label>
                          <div className="text-sm font-medium text-gray-900">
                            {Number(feeAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
                          </div>
                        </div>
                        {feeCurrency && feeCurrency.toUpperCase() !== "THB" && feeAmountOriginal && (
                          <>
                            <div>
                              <Label>Original Amount</Label>
                              <div className="text-sm text-gray-900">
                                {feeAmountOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {feeCurrency}
                              </div>
                            </div>
                            {feeConversionRate && (
                              <div>
                                <Label>Conversion Rate</Label>
                                <div className="text-sm text-gray-900">
                                  {feeConversionRate.toFixed(4)}
                                </div>
                              </div>
                            )}
                            {feeRateDate && (
                              <div>
                                <Label>Rate Date</Label>
                                <div className="text-sm text-gray-500">
                                  {formatTimestamp(feeRateDate)}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {feeNotes && (
                          <div>
                            <Label>Notes</Label>
                            <div className="text-sm text-gray-900">{feeNotes}</div>
                          </div>
                        )}
                        {feeRecordedAt && (
                          <div>
                            <Label>Recorded</Label>
                            <div className="text-sm text-gray-500">
                              {formatTimestamp(feeRecordedAt)}
                              {feeRecordedBy && ` by ${feeRecordedBy}`}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded p-4">
                      <p className="text-sm text-gray-500 italic">No fee recorded yet</p>
                      {(selectedBooking.status === "confirmed" || selectedBooking.status === "finished" || selectedBooking.status === "cancelled") && (
                        <p className="text-xs text-gray-400 mt-2">Click "Record Fee" to add fee information</p>
                      )}
                      {(selectedBooking.status !== "confirmed" && selectedBooking.status !== "finished" && selectedBooking.status !== "cancelled") && (
                        <p className="text-xs text-yellow-600 mt-2">Fee can only be recorded when booking is confirmed, finished, or cancelled</p>
                      )}
                    </div>
                  )
                })()}
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

              {/* Fee History */}
              {feeHistory.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Fee History</h3>
                  <div className="space-y-2">
                    {feeHistory.map((history) => {
                      const formatFeeDisplay = (amount: number | null, original: number | null, currency: string | null, rate: number | null) => {
                        if (amount === null) return "Not recorded"
                        const baseAmount = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        if (currency && currency.toUpperCase() !== "THB" && original) {
                          const originalAmount = original.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          const rateDisplay = rate ? rate.toFixed(4) : "N/A"
                          return `${baseAmount} THB (${originalAmount} ${currency}, rate: ${rateDisplay})`
                        }
                        return `${baseAmount} THB`
                      }

                      const oldDisplay = formatFeeDisplay(history.oldFeeAmount, history.oldFeeAmountOriginal, history.oldFeeCurrency, history.oldFeeConversionRate)
                      const newDisplay = formatFeeDisplay(history.newFeeAmount, history.newFeeAmountOriginal, history.newFeeCurrency, history.newFeeConversionRate)

                      return (
                        <div key={history.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              {history.oldFeeAmount === null ? "Fee Recorded" : "Fee Updated"}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              {history.oldFeeAmount === null ? (
                                <span>→ {newDisplay}</span>
                              ) : (
                                <span>{oldDisplay} → {newDisplay}</span>
                              )}
                            </div>
                            {history.changeReason && (
                              <div className="text-xs text-gray-500 mt-1">{history.changeReason}</div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              {formatTimestamp(history.createdAt)}
                              {history.changedBy && ` by ${history.changedBy}`}
                              {history.isRestorationChange && (
                                <Badge variant="outline" className="ml-2 text-xs">Restoration</Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Status at change: {history.bookingStatusAtChange}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Update Action Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-2xl xl:max-w-4xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Admin Action</DialogTitle>
            <DialogDescription>
              {selectedBooking?.status === "finished" 
                ? "This booking is finished. Status changes are not allowed."
                : "Select an action to take on this booking. An email notification will be sent to the user."}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <form onSubmit={handleActionUpdate} className="space-y-4" data-booking-form="true">
              {/* Show warning if blocked by confirmed overlap */}
              {hasConfirmedOverlap && selectedBooking.status !== "cancelled" && (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-red-900">⚠️ Booking Blocked by Confirmed Overlap</AlertTitle>
                  <AlertDescription className="text-red-800">
                    Another booking with the same date/time is already CONFIRMED. You can only CANCEL this booking until the confirmed booking is cancelled or auto-cancelled.
                  </AlertDescription>
                </Alert>
              )}
              
              {/* Show lock status warning if action is locked by another admin */}
              {isActionLockedByOther && (
                <Alert variant="destructive" className="bg-orange-50 border-orange-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-orange-900">🔒 Action Locked by Another Admin</AlertTitle>
                  <AlertDescription className="text-orange-800">
                    This action is currently being performed by {actionLockStatus.lockedBy || "another admin"}. 
                    Please wait a moment and try again. The page will automatically update when the lock is released.
                  </AlertDescription>
                </Alert>
              )}
              
              {/* Show lock status info if action is locked by current admin */}
              {isActionLockedByMe && (
                <Alert variant="default" className="bg-blue-50 border-blue-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-blue-900">🔒 Action Locked by You</AlertTitle>
                  <AlertDescription className="text-blue-800">
                    You have an active lock on this action. You can proceed with the action.
                  </AlertDescription>
                </Alert>
              )}
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
              ) : (selectedBooking.status as string) === "pending_deposit" && selectedBooking.deposit_evidence_url ? (
                // Warning message is shown in the deposit verification section below, so we don't duplicate it here
                null
              ) : (
                <div>
                  <Label htmlFor="action">Select Action *</Label>
                  {(() => {
                    // Get available actions from state machine
                    // Check if booking date is in the past
                    const startTimestamp = calculateStartTimestamp(selectedBooking.start_date, selectedBooking.start_time || null)
                    const now = getBangkokTime()
                    const isDateInPast = startTimestamp < now

                    const availableActions = getAvailableActions(
                      selectedBooking.status as any,
                      Boolean(selectedBooking.deposit_evidence_url),
                      isDateInPast
                    )
                    const acceptAction = availableActions.find(a => a.id === "accept")
                    const rejectAction = availableActions.find(a => a.id === "reject")
                    const acceptDepositAction = availableActions.find(a => a.id === "accept_deposit")
                    const acceptDepositOtherChannelAction = availableActions.find(a => a.id === "accept_deposit_other_channel")
                    const confirmOtherChannelAction = availableActions.find(a => a.id === "confirm_other_channel")
                    const rejectDepositAction = availableActions.find(a => a.id === "reject_deposit")
                    const cancelAction = availableActions.find(a => a.id === "cancel")
                    
                    // If blocked by confirmed overlap, only show cancel button
                    // Always allow cancel when blocked by confirmed overlap, regardless of status
                    if (hasConfirmedOverlap && selectedBooking.status !== "cancelled") {
                      return (
                        <div className="space-y-4">
                          <Alert variant="destructive" className="bg-red-50 border-red-200">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle className="text-red-900">Actions Restricted</AlertTitle>
                            <AlertDescription className="text-red-800">
                              This booking is blocked by a confirmed overlap. Only cancellation is allowed.
                            </AlertDescription>
                          </Alert>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("cancel")
                                setSelectedStatusInForm("cancelled")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "cancel"
                                  ? "border-red-500 bg-red-50"
                                  : "border-gray-200 hover:border-red-300"
                              }`}
                              disabled={saving}
                            >
                              <Ban className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "cancel" ? "text-red-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Cancel</div>
                              <div className="text-xs text-gray-500 mt-1">Cancel booking</div>
                            </button>
                          </div>
                        </div>
                      )
                    }
                    
                    // Render action buttons based on current status
                    if (selectedBooking.status === "pending") {
                    return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAction("accept")
                              setSelectedStatusInForm("pending_deposit")
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
                            <div className="text-xs text-gray-500 mt-1">Approve booking (pending deposit)</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAction("reject")
                              setSelectedStatusInForm("cancelled")
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
                        </div>
                      )
                    } else if (selectedBooking.status === "pending_deposit") {
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                          {confirmOtherChannelAction && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("confirm_other_channel")
                                setSelectedStatusInForm("confirmed")
                                setOtherChannelDialogOpen(true)
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "confirm_other_channel"
                                  ? "border-amber-500 bg-amber-50"
                                  : "border-amber-300 hover:border-amber-400 bg-amber-50/50"
                              }`}
                              disabled={saving}
                            >
                              <Phone className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "confirm_other_channel" ? "text-amber-700" : "text-amber-600"}`} />
                              <div className="font-semibold text-sm text-amber-900">Confirm (Other Channel)</div>
                              <div className="text-xs text-amber-700 mt-1">Verified via phone/in-person</div>
                            </button>
                          )}
                          {availableActions.find(a => a.id === "cancel") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("cancel")
                                setSelectedStatusInForm("cancelled")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "cancel"
                                  ? "border-red-500 bg-red-50"
                                  : "border-gray-200 hover:border-red-300"
                              }`}
                              disabled={saving}
                            >
                              <Ban className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "cancel" ? "text-red-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Cancel</div>
                              <div className="text-xs text-gray-500 mt-1">Cancel booking</div>
                            </button>
                          )}
                      </div>
                    )
                    } else if (selectedBooking.status === "paid_deposit") {
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                          {acceptDepositAction && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("accept_deposit")
                                setSelectedStatusInForm("confirmed")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "accept_deposit"
                                  ? "border-green-500 bg-green-50"
                                  : "border-gray-200 hover:border-green-300"
                              }`}
                              disabled={saving}
                            >
                              <CheckCircle2 className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "accept_deposit" ? "text-green-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Accept Deposit</div>
                              <div className="text-xs text-gray-500 mt-1">Confirm booking</div>
                            </button>
                          )}
                          {acceptDepositOtherChannelAction && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("accept_deposit_other_channel")
                                setSelectedStatusInForm("confirmed")
                                setOtherChannelDialogOpen(true)
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "accept_deposit_other_channel"
                                  ? "border-amber-500 bg-amber-50"
                                  : "border-amber-300 hover:border-amber-400 bg-amber-50/50"
                              }`}
                              disabled={saving}
                            >
                              <Phone className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "accept_deposit_other_channel" ? "text-amber-700" : "text-amber-600"}`} />
                              <div className="font-semibold text-sm text-amber-900">Confirm (Verified via Other Channel)</div>
                              <div className="text-xs text-amber-700 mt-1">Verified via phone/in-person</div>
                            </button>
                          )}
                          {rejectDepositAction && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("reject_deposit")
                                setSelectedStatusInForm("pending_deposit")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "reject_deposit"
                                  ? "border-orange-500 bg-orange-50"
                                  : "border-gray-200 hover:border-orange-300"
                              }`}
                              disabled={saving}
                            >
                              <XCircle className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "reject_deposit" ? "text-orange-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Reject Deposit</div>
                              <div className="text-xs text-gray-500 mt-1">Request re-upload</div>
                            </button>
                          )}
                          {availableActions.find(a => a.id === "cancel") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("cancel")
                                setSelectedStatusInForm("cancelled")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "cancel"
                                  ? "border-red-500 bg-red-50"
                                  : "border-gray-200 hover:border-red-300"
                              }`}
                              disabled={saving}
                            >
                              <Ban className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "cancel" ? "text-red-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Cancel</div>
                              <div className="text-xs text-gray-500 mt-1">Cancel booking</div>
                            </button>
                          )}
                        </div>
                      )
                    } else if (selectedBooking.status === "confirmed") {
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                          {availableActions.find(a => a.id === "change_date") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("change_date")
                                setSelectedStatusInForm("confirmed")
                                // Initialize date change state with current booking dates
                                if (selectedBooking.start_date) {
                                  setNewStartDate(new Date(selectedBooking.start_date * 1000))
                                }
                                if (selectedBooking.end_date) {
                                  setNewEndDate(new Date(selectedBooking.end_date * 1000))
                                }
                                setNewStartTime(selectedBooking.start_time || "")
                                setNewEndTime(selectedBooking.end_time || "")
                                setShowPastDateWarning(false)
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "change_date"
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-200 hover:border-blue-300"
                              }`}
                              disabled={saving}
                            >
                              <Calendar className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "change_date" ? "text-blue-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Change Date</div>
                              <div className="text-xs text-gray-500 mt-1">Update booking date</div>
                            </button>
                          )}
                          {availableActions.find(a => a.id === "cancel") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAction("cancel")
                                setSelectedStatusInForm("cancelled")
                              }}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                selectedAction === "cancel"
                                  ? "border-red-500 bg-red-50"
                                  : "border-gray-200 hover:border-red-300"
                              }`}
                              disabled={saving}
                            >
                              <Ban className={`w-6 h-6 mx-auto mb-2 ${selectedAction === "cancel" ? "text-red-600" : "text-gray-400"}`} />
                              <div className="font-semibold text-sm">Cancel</div>
                              <div className="text-xs text-gray-500 mt-1">Cancel booking</div>
                            </button>
                          )}
                        </div>
                      )
                    }
                    return null
                  })()}
                  <input type="hidden" name="action" value={selectedAction || ""} />
                </div>
              )}
              {/* Date Change Section for Confirmed Bookings */}
              {selectedAction === "change_date" && selectedBooking.status === "confirmed" && (
                <div className="space-y-4 border-t pt-4">
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <p className="text-sm text-blue-800">
                      <strong>Change Booking Date:</strong> Update the booking date and time. The original date will be released and the new date will become the locked date.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
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
                            // Pre-fill end date from current booking
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
                      <Label htmlFor="new_start_date">New Start Date *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                            disabled={saving}
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {newStartDate ? format(newStartDate, "PPP") : "Select start date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <SimpleCalendar
                            selected={newStartDate || undefined}
                            month={calendarMonth}
                            onMonthChange={(date) => {
                              setCalendarMonth(date)
                              // Refresh unavailable dates when month changes
                              // Use ref to avoid stale closure
                              const currentBookingId = selectedBookingIdRef.current
                              if (currentBookingId) {
                                fetchUnavailableDatesForDateChange(currentBookingId)
                              }
                            }}
                            onSelect={(date) => {
                              setNewStartDate(date || null)
                              // If end date is before or equal to new start date, clear it
                              // Use Bangkok timezone date strings for proper date-only comparison
                              if (newEndDate && date && dateRangeToggle === "multiple") {
                                const startDateStr = dateToBangkokDateString(date)
                                const endDateStr = dateToBangkokDateString(newEndDate)
                                // Clear end date if it's before or equal to start date
                                if (endDateStr <= startDateStr) {
                                  setNewEndDate(null)
                                }
                              }
                            }}
                            disabled={(date) => {
                              // Check if date is unavailable (has confirmed booking)
                              // Convert date to Bangkok timezone for proper comparison
                              const dateStr = dateToBangkokDateString(date)
                              const isUnavailable = unavailableDatesForDateChange.has(dateStr)
                              if (isUnavailable) {
                                console.log(`[Admin] Start date ${dateStr} is unavailable (blocked by confirmed booking)`)
                              }
                              // CRITICAL: In multiple day mode, prevent selecting start date that equals end date
                              if (dateRangeToggle === "multiple" && newEndDate) {
                                const endDateStr = dateToBangkokDateString(newEndDate)
                                if (dateStr === endDateStr) {
                                  return true // Disable start date if it equals end date
                                }
                              }
                              return isUnavailable
                            }}
                            isOccupied={(date) => {
                              // Check if date is occupied (has confirmed booking)
                              const dateStr = dateToBangkokDateString(date)
                              return unavailableDatesForDateChange.has(dateStr)
                            }}
                            occupiedTimeRanges={unavailableTimeRangesForDateChange}
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
                              {newEndDate ? format(newEndDate, "PPP") : "Select end date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <SimpleCalendar
                              selected={newEndDate || undefined}
                              month={calendarMonth}
                              onMonthChange={(date) => {
                                setCalendarMonth(date)
                                // Refresh unavailable dates when month changes
                                // Use ref to avoid stale closure
                                const currentBookingId = selectedBookingIdRef.current
                                if (currentBookingId) {
                                  fetchUnavailableDatesForDateChange(currentBookingId)
                                }
                              }}
                              onSelect={(date) => {
                                setNewEndDate(date || null)
                              }}
                              disabled={(date) => {
                                if (!newStartDate) return true
                                // CRITICAL: Use Bangkok timezone date strings for proper date-only comparison
                                // This prevents selecting the same date for start and end in multiple day mode
                                const startDateStr = dateToBangkokDateString(newStartDate)
                                const dateStr = dateToBangkokDateString(date)
                                // End date must be after start date (not equal, not before)
                                if (dateStr <= startDateStr) return true
                                // Check if date is unavailable (has confirmed booking)
                                const isUnavailable = unavailableDatesForDateChange.has(dateStr)
                                if (isUnavailable) {
                                  console.log(`[Admin] End date ${dateStr} is unavailable (blocked by confirmed booking)`)
                                }
                                return isUnavailable
                              }}
                              isOccupied={(date) => {
                                // Check if date is occupied (has confirmed booking)
                                const dateStr = dateToBangkokDateString(date)
                                return unavailableDatesForDateChange.has(dateStr)
                              }}
                              occupiedTimeRanges={unavailableTimeRangesForDateChange}
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

                    {/* Past Date Warning */}
                    {newStartDate && (() => {
                      const bangkokNow = getBangkokTime()
                      const startTimestamp = calculateStartTimestamp(
                        Math.floor(newStartDate.getTime() / 1000),
                        newStartTime || selectedBooking.start_time || null
                      )
                      const isPast = startTimestamp < bangkokNow
                      
                      if (isPast && !showPastDateWarning) {
                        return (
                          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                            <p className="text-sm text-yellow-800">
                              ⚠️ <strong>Warning:</strong> The selected start date is in the past. This is allowed for historical corrections only.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() => setShowPastDateWarning(true)}
                            >
                              I understand, proceed
                            </Button>
                          </div>
                        )
                      }
                      return null
                    })()}
                  </div>
                </div>
              )}
              {/* Change Reason and Admin Notes */}
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
              {selectedBooking && (() => {
                const currentStatus = selectedStatusInForm || selectedBooking.status
                
                // Show deposit verification section for pending_deposit or paid_deposit status with deposit evidence
                // Always show when booking status is pending_deposit or paid_deposit and has deposit evidence
                if ((selectedBooking.status === "pending_deposit" || selectedBooking.status === "paid_deposit") && selectedBooking.deposit_evidence_url) {
                  return (
                    <div className="space-y-4 border-t pt-4">
                      {selectedBooking.status === "paid_deposit" ? (
                        <div className="bg-purple-50 border border-purple-200 rounded p-3 mb-4">
                          <p className="text-sm text-purple-800">
                            ℹ️ <strong>Deposit Evidence Available:</strong> User has uploaded deposit evidence. Please review the evidence using the link below, then use the action buttons above to accept or reject the deposit.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                          <p className="text-sm text-yellow-800">
                            ⚠️ <strong>Deposit Verification Required:</strong> Please review the deposit evidence using the link below, then use the action buttons above to accept or reject the deposit.
                          </p>
                        </div>
                      )}
                      <div className="bg-purple-50 border border-purple-200 rounded p-4">
                        <h4 className="font-semibold text-purple-900 mb-2">Deposit Verification</h4>
                        {selectedBooking.deposit_evidence_url ? (
                      <div className="space-y-3">
                            <div>
                              <Label>Deposit Evidence</Label>
                              <a 
                                href={`/api/admin/deposit/${selectedBooking.id}/image`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline block mt-1 font-medium"
                              >
                                View Deposit Evidence →
                              </a>
                          </div>
                            {selectedBooking.deposit_verified_at && (
                              <div className="bg-green-50 border border-green-200 rounded p-3">
                                <p className="text-sm text-green-800">
                                  ✓ Verified by {selectedBooking.deposit_verified_by || "Admin"} on {formatTimestamp(selectedBooking.deposit_verified_at)}
                                </p>
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
                
                // No postpone action in new flow
                if (false) {
                  return (
                    <div className="bg-orange-50 border border-orange-200 rounded p-4">
                      <p className="text-sm text-orange-800">
                        {/* Postpone removed from new flow */}
                        {false && (
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
              {/* Admin Notes */}
              {selectedBooking.status !== "finished" && (
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
              {(selectedBooking.status as string) !== "finished" && (
                <Button 
                  type="submit" 
                  disabled={
                    saving || 
                    !selectedAction || 
                    isActionLockedByOther || // Disable if locked by another admin
                    (selectedBooking.status === "pending_deposit" && selectedAction !== "reject_deposit" && selectedAction !== "cancel")
                  }
                  className="w-full sm:w-auto"
                  title={isActionLockedByOther ? `This action is locked by ${actionLockStatus.lockedBy || "another admin"}` : undefined}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : selectedAction ? (
                    `Confirm ${selectedAction === "accept" ? "Accept" : selectedAction === "reject" ? "Reject" : selectedAction === "accept_deposit" ? "Accept Deposit" : selectedAction === "reject_deposit" ? "Reject Deposit" : selectedAction === "cancel" ? "Cancel" : selectedAction === "change_date" ? "Change Date" : "Action"}`
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

      {/* Fee Recording/Update Dialog */}
      <Dialog 
        open={feeDialogOpen} 
        onOpenChange={(open) => {
          setFeeDialogOpen(open)
          if (!open) {
            // Reset form when dialog closes
            setFeeAmountOriginal("")
            setFeeCurrency("THB")
            setFeeConversionRate("")
            setFeeAmount("")
            setFeeNotes("")
          }
        }}
      >
        <DialogContent className="max-w-2xl w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>{selectedBooking?.fee_amount ? "Update Fee" : "Record Fee"}</DialogTitle>
            <DialogDescription>
              {selectedBooking?.fee_amount 
                ? "Update the fee for this booking. Changes will be logged in fee history."
                : "Record the fee for this booking. Fee can be recorded for confirmed, finished, or cancelled bookings."}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <form onSubmit={handleFeeUpdate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fee_amount_original">Original Amount *</Label>
                  <Input
                    id="fee_amount_original"
                    type="number"
                    step="0.01"
                    min="0"
                    value={feeAmountOriginal}
                    onChange={(e) => setFeeAmountOriginal(e.target.value)}
                    placeholder="0.00"
                    required
                    disabled={saving}
                  />
                </div>
                <div>
                  <Label htmlFor="fee_currency">Currency *</Label>
                  <Select value={feeCurrency} onValueChange={setFeeCurrency} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB (Thai Baht)</SelectItem>
                      <SelectItem value="USD">USD (US Dollar)</SelectItem>
                      <SelectItem value="EUR">EUR (Euro)</SelectItem>
                      <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                      <SelectItem value="JPY">JPY (Japanese Yen)</SelectItem>
                      <SelectItem value="CNY">CNY (Chinese Yuan)</SelectItem>
                      <SelectItem value="SGD">SGD (Singapore Dollar)</SelectItem>
                      <SelectItem value="MYR">MYR (Malaysian Ringgit)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {feeCurrency.toUpperCase() !== "THB" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="fee_conversion_rate">Conversion Rate</Label>
                    <Input
                      id="fee_conversion_rate"
                      type="number"
                      step="0.0001"
                      min="0.01"
                      max="10000"
                      value={feeConversionRate}
                      onChange={(e) => setFeeConversionRate(e.target.value)}
                      placeholder="Auto-calculated if base amount provided"
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Rate: 1 {feeCurrency} = ? THB
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="fee_amount">Base Amount (THB)</Label>
                    <Input
                      id="fee_amount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={feeAmount}
                      onChange={(e) => setFeeAmount(e.target.value)}
                      placeholder="Auto-calculated if rate provided"
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Calculated: {feeAmountOriginal && feeConversionRate 
                        ? (parseFloat(feeAmountOriginal) * parseFloat(feeConversionRate)).toFixed(2)
                        : feeAmount || "0.00"} THB
                    </p>
                  </div>
                </div>
              )}

              {feeCurrency.toUpperCase() === "THB" && (
                <div>
                  <Label htmlFor="fee_amount_thb">Base Amount (THB)</Label>
                  <Input
                    id="fee_amount_thb"
                    type="number"
                    step="0.01"
                    min="0"
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    placeholder="Same as original amount"
                    disabled
                    className="bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    For THB, base amount equals original amount
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="fee_notes">Notes (Optional)</Label>
                <Textarea
                  id="fee_notes"
                  value={feeNotes}
                  onChange={(e) => setFeeNotes(e.target.value)}
                  placeholder="Payment method, invoice number, etc."
                  rows={3}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFeeDialogOpen(false)
                    setFeeAmountOriginal("")
                    setFeeCurrency("THB")
                    setFeeConversionRate("")
                    setFeeAmount("")
                    setFeeNotes("")
                  }}
                  disabled={saving}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !feeAmountOriginal || parseFloat(feeAmountOriginal) <= 0}
                  className="w-full sm:w-auto"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {((selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount) ? "Updating..." : "Recording..."}
                    </>
                  ) : (
                    ((selectedBooking as any).fee_amount ?? (selectedBooking as any).feeAmount) ? "Update Fee" : "Record Fee"
                  )}
                </Button>
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
        isLoading={actionLoading}
      />

      {/* Export Dialog */}
      <BookingExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        filters={{
          status: statusFilter !== "all" ? statusFilter : undefined,
          email: debouncedEmailFilter || undefined,
          referenceNumber: debouncedReferenceNumberFilter || undefined,
          name: debouncedNameFilter || undefined,
          phone: debouncedPhoneFilter || undefined,
          eventType: eventTypeFilter !== "all" ? eventTypeFilter : undefined,
          sortBy,
          sortOrder,
          showOverlappingOnly,
        }}
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
          start_date: typeof bookingToDelete.start_date === 'number' ? bookingToDelete.start_date : 0,
          end_date: bookingToDelete.end_date ? (typeof bookingToDelete.end_date === 'number' ? bookingToDelete.end_date : null) : null,
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

      {/* Other Channel Confirmation Dialog */}
      <Dialog open={otherChannelDialogOpen} onOpenChange={setOtherChannelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Confirm Other Channel Verification
            </DialogTitle>
            <DialogDescription>
              This action confirms the booking was verified through other channels (phone, in-person, etc.), not through the system deposit upload.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="default" className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900">Warning</AlertTitle>
              <AlertDescription className="text-amber-800">
                You are confirming this booking without reviewing the deposit evidence in the system. 
                This should only be used when verification was completed through other channels (phone call, in-person meeting, etc.).
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="confirm-text" className="text-sm font-medium">
                Type <strong>CONFIRM</strong> to proceed:
              </Label>
              <Input
                id="confirm-text"
                value={otherChannelConfirmText}
                onChange={(e) => setOtherChannelConfirmText(e.target.value.toUpperCase())}
                placeholder="Type CONFIRM here"
                className="font-mono"
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOtherChannelDialogOpen(false)
                setOtherChannelConfirmText("")
                setSelectedAction(null)
                setSelectedStatusInForm("")
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={async () => {
                if (otherChannelConfirmText !== "CONFIRM") {
                  toast.error("Please type CONFIRM exactly to proceed")
                  return
                }

                // Proceed with the action
                if (!selectedBooking || !selectedAction) return

                const actionDef = getAvailableActions(
                  selectedBooking.status as any,
                  Boolean(selectedBooking.deposit_evidence_url),
                  false
                ).find(a => a.id === selectedAction)

                if (!actionDef) {
                  toast.error("Action not found")
                  return
                }

                setOtherChannelDialogOpen(false)
                setOtherChannelConfirmText("")
                await executeActionDirectly(actionDef)
              }}
              disabled={saving || otherChannelConfirmText !== "CONFIRM"}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm Action"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

