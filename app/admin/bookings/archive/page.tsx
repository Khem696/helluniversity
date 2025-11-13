"use client"

import { useState, useEffect } from "react"
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
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import Link from "next/link"
import { BookingStateInfo } from "@/components/admin/BookingStateInfo"
import { ActionConfirmationDialog } from "@/components/admin/ActionConfirmationDialog"
import { useBookingActions } from "@/hooks/useBookingActions"
import { getAvailableActions, type ActionDefinition } from "@/lib/booking-state-machine"

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
  status: "pending" | "pending_deposit" | "confirmed" | "cancelled" | "finished"
  admin_notes: string | null
  response_token: string | null
  token_expires_at: number | null
  proposed_date: number | null
  proposed_end_date: number | null
  user_response: string | null
  response_date: number | null
  deposit_evidence_url: string | null
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

export default function BookingsArchivePage() {
  const { data: session, status } = useSession()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([])
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailFilter, setEmailFilter] = useState("")
  const [referenceNumberFilter, setReferenceNumberFilter] = useState("")
  const [nameFilter, setNameFilter] = useState("")
  const [phoneFilter, setPhoneFilter] = useState("")
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"created_at" | "start_date" | "name" | "updated_at">("created_at")
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC")
  const [saving, setSaving] = useState(false)
  const [newStatus, setNewStatus] = useState<string>("")
  const [proposedDateRange, setProposedDateRange] = useState<"single" | "multiple">("single")
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<ActionDefinition | null>(null)
  const [pendingValidation, setPendingValidation] = useState<any>(null)
  const [selectedAction, setSelectedAction] = useState<"accept" | "reject" | null>(null)
  
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
      setNewStatus("")
      setProposedDateRange("single")
      setSelectedAction(null)
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

  // Event types for filter dropdown
  const eventTypes = [
    { value: "all", label: "All Event Types" },
    { value: "Arts & Design Coaching", label: "Arts & Design Coaching Workshop" },
    { value: "Seminar & Workshop", label: "Seminar & Workshop" },
    { value: "Family Gathering", label: "Family Gathering" },
    { value: "Holiday Festive", label: "Holiday Festive" },
    { value: "Other", label: "Other" },
  ]

  // Fetch bookings
  const fetchBookings = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append("archive", "true") // Request archive bookings
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }
      if (emailFilter) {
        params.append("email", emailFilter)
      }
      if (referenceNumberFilter) {
        params.append("referenceNumber", referenceNumberFilter)
      }
      if (nameFilter) {
        params.append("name", nameFilter)
      }
      if (phoneFilter) {
        params.append("phone", phoneFilter)
      }
      if (eventTypeFilter !== "all") {
        params.append("eventType", eventTypeFilter)
      }
      params.append("sortBy", sortBy)
      params.append("sortOrder", sortOrder)
      params.append("limit", "1000")

      const response = await fetch(`/api/admin/bookings?${params.toString()}`)
      const json = await response.json()
      
      if (json.success && json.data) {
        const bookings = json.data.bookings || []
        setBookings(Array.isArray(bookings) ? bookings : [])
      } else {
        const errorMessage = json.error?.message || "Failed to load archived bookings"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to load archived bookings")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchBookings()
    }
  }, [session, statusFilter, emailFilter, referenceNumberFilter, nameFilter, phoneFilter, eventTypeFilter, sortBy, sortOrder])

  // Fetch booking details and history
  const fetchBookingDetails = async (bookingId: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`)
      const json = await response.json()
      
      if (json.success && json.data) {
        const booking = json.data.booking
        const statusHistory = json.data.statusHistory || []
        
        if (booking) {
          setSelectedBooking(booking)
          setStatusHistory(statusHistory)
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
    const statusText = booking?.status === "cancelled" || booking?.status === "finished"
      ? booking?.status === "finished"
        ? "Only admin will be notified. No user email will be sent as the event has already finished."
        : "Only admin will be notified of this deletion."
      : "A cancellation email will be sent to the user, and admin will be notified."
    
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

      const text = await response.text()
      if (!text) {
        toast.error("Empty response from server")
        return
      }

      const data = JSON.parse(text)
      if (data.success) {
        toast.success("Booking deleted successfully. Notifications sent if applicable.")
        setViewDialogOpen(false)
        setStatusDialogOpen(false)
        fetchBookings()
      } else {
        toast.error(data.error || "Failed to delete booking")
      }
    } catch (error) {
      toast.error("Failed to delete booking")
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

    // Get available actions from state machine
    const availableActions = getAvailableActions(
      selectedBooking.status as any,
      Boolean(selectedBooking.deposit_evidence_url),
      false // isDateInPast - not relevant for archive restoration
    )
    
    // Find the action that matches the target status
    const actionDef = availableActions.find(
      (a) => a.targetStatus === statusValue
    )

    if (!actionDef) {
      toast.error(`Cannot transition from "${selectedBooking.status}" to "${statusValue}". This transition is not allowed.`)
      setSaving(false)
      return
    }

    // Validate action if required (especially for re-opening - check dates)
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
        setSaving(false)
        return
      }

      // If there are warnings, show confirmation dialog
      if (validation.warnings.length > 0 || validation.overlappingBookings) {
        setPendingAction(actionDef)
        setPendingValidation(validation)
        setConfirmationDialogOpen(true)
        setSaving(false)
        return
      }
    }

    // Execute the action
    try {
      const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusValue,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: null, // Archive page doesn't propose dates
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        toast.success("Booking status updated successfully. Email notification sent.")
        setStatusDialogOpen(false)
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
        const errorText = json.error?.message || "Failed to update booking status"
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

  // Handle confirmation dialog confirm
  const handleConfirmAction = async () => {
    if (!selectedBooking || !pendingAction) return

    setSaving(true)
    const form = document.querySelector('form[onSubmit]') as HTMLFormElement
    const formData = form ? new FormData(form) : new FormData()
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string

    try {
      const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: pendingAction.targetStatus,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: null,
        }),
      })

      const json = await response.json()
      
      if (json.success) {
        toast.success("Booking status updated successfully. Email notification sent.")
        setStatusDialogOpen(false)
        setConfirmationDialogOpen(false)
        setPendingAction(null)
        setPendingValidation(null)
        fetchBookings()
        if (viewDialogOpen) {
          fetchBookingDetails(selectedBooking.id)
        }
      } else {
        const errorText = json.error?.message || "Failed to update booking status"
        if (errorText.includes("modified by another process")) {
          toast.error("Booking was modified by another process. Refreshing booking data...")
          await fetchBookingDetails(selectedBooking.id)
          fetchBookings()
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
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
            <p className="text-gray-600">View finished and cancelled reservations</p>
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
          <Input
            placeholder="Search by reference number..."
            value={referenceNumberFilter}
            onChange={(e) => setReferenceNumberFilter(e.target.value)}
            className="w-full sm:w-48"
          />
          <Input
            placeholder="Search by name..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-full sm:w-48"
          />
          <Input
            placeholder="Search by phone..."
            value={phoneFilter}
            onChange={(e) => setPhoneFilter(e.target.value)}
            className="w-full sm:w-48"
          />
        <Input
          placeholder="Filter by email..."
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
            className="w-full sm:w-64"
        />
        </div>
      </div>

      {/* Bookings Table */}
      {bookings.length === 0 ? (
        <div className="text-center py-12">
          <Archive className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No archived bookings found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
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
                    <td className="px-6 py-4">
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
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {formatDate(booking.start_date)}
                        {booking.end_date && booking.end_date !== booking.start_date && (
                          <span> - {formatDate(booking.end_date)}</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeForDisplay(booking.start_time)} - {formatTimeForDisplay(booking.end_time)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(booking.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestamp(booking.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex gap-2 justify-end">
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
                          variant="default"
                          onClick={() => {
                            setSelectedBooking(booking)
                            setNewStatus(booking.status)
                            setStatusDialogOpen(true)
                            fetchBookingDetails(booking.id)
                          }}
                        >
                          Update Status
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
        </div>
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
                <div className="flex items-center gap-3">
                  {getStatusBadge(selectedBooking.status)}
                </div>
                <div className="flex items-center gap-2">
                  {/* Only show Update Status for cancelled (can restore) */}
                  {selectedBooking.status !== "finished" && (
                    <Button
                      onClick={() => {
                        setSelectedBooking(selectedBooking)
                        setNewStatus(selectedBooking.status)
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
              {statusHistory.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Status History</h3>
                  <div className="space-y-2">
                    {statusHistory.map((history) => (
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
                </div>
              )}
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
              
              {/* Show available actions for cancelled (archive restoration) */}
              {selectedBooking.status !== "finished" && (() => {
                const availableActions = getAvailableActions(
                  selectedBooking.status as any,
                  Boolean(selectedBooking.deposit_evidence_url),
                  false // isDateInPast - not relevant for archive restoration
                )
                
                if (availableActions.length === 0) {
                  return (
                    <div className="bg-gray-50 border border-gray-200 text-gray-800 p-4 rounded">
                      <p className="font-medium">
                        No actions available for this status. This booking is archived.
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
                        onValueChange={setNewStatus} 
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableActions.map((action) => (
                            <SelectItem 
                              key={action.id} 
                              value={action.targetStatus}
                              disabled={action.type === "destructive" && selectedBooking.status === "finished"}
                            >
                              {action.label} ({action.targetStatus})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {availableActions.length > 0 && (
                        <p className="text-sm text-gray-500 mt-1">
                          Available transitions: {availableActions.map(a => a.targetStatus).join(", ")}
                        </p>
                      )}
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
    </div>
  )
}

