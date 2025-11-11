"use client"

import { useState, useEffect } from "react"
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
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in"
  admin_notes: string | null
  response_token: string | null
  token_expires_at: number | null
  proposed_date: number | null
  proposed_end_date: number | null
  user_response: string | null
  response_date: number | null
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
  const [lastCheckedAt, setLastCheckedAt] = useState<number>(Date.now())
  const [newResponsesCount, setNewResponsesCount] = useState<number>(0)
  const [seenResponseIds, setSeenResponseIds] = useState<Set<string>>(new Set())

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
      const data = await response.json()
      if (data.success) {
        setBookings(data.bookings)
      } else {
        toast.error(data.error || "Failed to load bookings")
      }
    } catch (error) {
      toast.error("Failed to load bookings")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchBookings()
      setLastCheckedAt(Date.now())
    }
  }, [session, statusFilter, emailFilter])

  // Poll for new user responses every 30 seconds
  useEffect(() => {
    if (!session) return

    const pollInterval = setInterval(async () => {
      try {
        // Check for bookings with new user responses
        const params = new URLSearchParams()
        params.append("limit", "1000")
        const response = await fetch(`/api/admin/bookings?${params.toString()}`)
        const data = await response.json()
        
        if (data.success && data.bookings) {
          const currentBookings = data.bookings as Booking[]
          
          // Find bookings with new user responses (response_date after lastCheckedAt)
          const newResponses = currentBookings.filter(booking => {
            if (!booking.user_response || !booking.response_date) return false
            
            // Check if this response is new (response_date is after lastCheckedAt)
            const responseTime = booking.response_date * 1000 // Convert to milliseconds
            const isNew = responseTime > lastCheckedAt
            
            // Check if we've already seen this response
            const responseId = `${booking.id}-${booking.response_date}`
            const alreadySeen = seenResponseIds.has(responseId)
            
            return isNew && !alreadySeen
          })

          if (newResponses.length > 0) {
            // Mark responses as seen
            const newSeenIds = new Set(seenResponseIds)
            newResponses.forEach(booking => {
              if (booking.response_date) {
                const responseId = `${booking.id}-${booking.response_date}`
                newSeenIds.add(responseId)
              }
            })
            setSeenResponseIds(newSeenIds)

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
            
            // Refresh bookings list to show updated data
            fetchBookings()
          }

          // Update last checked time
          setLastCheckedAt(Date.now())
        }
      } catch (error) {
        console.error("Error polling for new responses:", error)
      }
    }, 30000) // Poll every 30 seconds

    return () => clearInterval(pollInterval)
  }, [session, lastCheckedAt, seenResponseIds])

  // Fetch booking details and history
  const fetchBookingDetails = async (bookingId: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`)
      const data = await response.json()
      if (data.success) {
        setSelectedBooking(data.booking)
        setStatusHistory(data.statusHistory || [])
        // Reset postpone mode when opening dialog
        setPostponeMode("user-propose")
        setProposedDateRange("single")
        setSelectedStatusInForm(data.booking.status)
      } else {
        toast.error(data.error || "Failed to load booking details")
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
    } else if (booking?.status === "accepted" || booking?.status === "checked-in") {
      statusText = "A cancellation email will be sent to the user, and admin will be notified."
    } else {
      statusText = "A rejection email will be sent to the user, and admin will be notified."
    }
    
    if (!confirm(`Are you sure you want to delete this booking? This action cannot be undone. ${statusText}`)) {
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: "DELETE",
      })

      const data = await response.json()
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

  // Handle status update
  const handleStatusUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedBooking) return

    // Prevent status updates for checked-in bookings
    if ((selectedBooking.status as string) === "checked-in") {
      toast.error("Cannot update status for checked-in bookings. Only deletion is allowed.")
      return
    }

    setSaving(true)
    const formData = new FormData(e.currentTarget)
    const status = formData.get("status") as string
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string
    const proposedStartDate = formData.get("proposed_start_date") as string
    const proposedEndDate = formData.get("proposed_end_date") as string
    const proposedStartTime = formData.get("proposed_start_time") as string
    const proposedEndTime = formData.get("proposed_end_time") as string
    const proposedDateRange = formData.get("proposed_date_range") as string
    const postponeModeValue = formData.get("postpone_mode") as string

    // For postponed status, handle two modes:
    // 1. "user-propose": Admin doesn't propose dates (set to null)
    // 2. "admin-propose": Admin proposes dates (validate and set)
    let proposedDate: string | null = null
    let finalProposedEndDate: string | null = null
    
    if (status === "postponed") {
      if (postponeModeValue === "admin-propose") {
        // Admin proposes: validate that dates are provided
        if (!proposedStartDate) {
          toast.error("Proposed start date is required when admin proposes dates")
          setSaving(false)
          return
        }
        if (!proposedStartTime) {
          toast.error("Proposed start time is required when admin proposes dates")
          setSaving(false)
          return
        }
        if (!proposedEndTime) {
          toast.error("Proposed end time is required when admin proposes dates")
          setSaving(false)
          return
        }
        proposedDate = proposedStartDate
        if (proposedDateRange === "multiple") {
          if (!proposedEndDate) {
            toast.error("Proposed end date is required for multiple day proposals")
            setSaving(false)
            return
          }
          finalProposedEndDate = proposedEndDate
        }
      } else {
        // User proposes: set dates to null
        proposedDate = null
        finalProposedEndDate = null
      }
    }

    try {
      const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: proposedDate,
          proposedStartDate: status === "postponed" && postponeModeValue === "admin-propose" && proposedStartDate ? proposedStartDate : null,
          proposedEndDate: status === "postponed" && postponeModeValue === "admin-propose" ? finalProposedEndDate : null,
          proposedStartTime: status === "postponed" && postponeModeValue === "admin-propose" && proposedStartTime ? proposedStartTime : null,
          proposedEndTime: status === "postponed" && postponeModeValue === "admin-propose" && proposedEndTime ? proposedEndTime : null,
        }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Booking status updated successfully. Email notification sent.")
        setStatusDialogOpen(false)
        setPostponeMode("user-propose")
        setProposedDateRange("single")
        fetchBookings()
        if (viewDialogOpen) {
          fetchBookingDetails(selectedBooking.id)
        }
      } else {
        toast.error(data.error || "Failed to update booking status")
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
      pending: "outline",
      accepted: "default",
      rejected: "destructive",
      postponed: "secondary",
      cancelled: "destructive",
      finished: "default",
      "checked-in": "default",
    }
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
      accepted: "bg-green-100 text-green-800 border-green-300",
      rejected: "bg-red-100 text-red-800 border-red-300",
      postponed: "bg-blue-100 text-blue-800 border-blue-300",
      cancelled: "bg-gray-100 text-gray-800 border-gray-300",
      finished: "bg-gray-100 text-gray-800 border-gray-300",
      "checked-in": "bg-emerald-100 text-emerald-800 border-emerald-300",
    }
    return (
      <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
        {status === "checked-in" ? "Checked In" : status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const formatTimestamp = (timestamp: number | null | undefined) => {
    if (timestamp === null || timestamp === undefined || timestamp === 0) return "N/A"
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const date = timestamp > 1000000000000 
        ? new Date(timestamp) // Already in milliseconds
        : new Date(timestamp * 1000) // Convert from seconds to milliseconds
      return format(date, "MMM dd, yyyy 'at' h:mm a")
    } catch (error) {
      console.error("Error formatting timestamp:", timestamp, error)
      return "N/A"
    }
  }

  const formatDate = (timestamp: number | null | undefined) => {
    if (timestamp === null || timestamp === undefined || timestamp === 0) return "N/A"
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const date = timestamp > 1000000000000 
        ? new Date(timestamp) // Already in milliseconds
        : new Date(timestamp * 1000) // Convert from seconds to milliseconds
      return format(date, "MMM dd, yyyy")
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Reservation Management</h1>
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
      <div className="mb-6 flex gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
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
          className="w-64"
        />
      </div>

      {/* Bookings Table */}
      {bookings.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No bookings found</p>
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
                    Proposed Date
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
                {bookings.map((booking) => {
                  const hasNewResponse = booking.user_response && booking.response_date && 
                    (booking.response_date * 1000) > lastCheckedAt - 300000 // New if within last 5 minutes
                  
                  return (
                  <tr 
                    key={booking.id} 
                    className={`hover:bg-gray-50 ${hasNewResponse ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
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
                        {booking.start_time} - {booking.end_time}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {booking.proposed_date ? (
                        <div className="text-sm text-gray-900">
                          {formatDate(booking.proposed_date)}
                          {booking.proposed_end_date && booking.proposed_end_date !== booking.proposed_date && (
                            <span> - {formatDate(booking.proposed_end_date)}</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">-</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(booking.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestamp(booking.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
      )}

      {/* View Booking Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              View and manage booking information
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-6">
              {/* Status and Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusBadge(selectedBooking.status)}
                  {selectedBooking.proposed_date && selectedBooking.status === "postponed" && (
                    <div className="text-sm text-gray-600">
                      Proposed Date: {formatDate(selectedBooking.proposed_date)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setStatusDialogOpen(true)
                    }}
                  >
                    Update Status
                  </Button>
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

              {/* Contact Information */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Contact Information</h3>
                <div className="grid grid-cols-2 gap-4">
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
                <div className="grid grid-cols-2 gap-4">
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
                      {selectedBooking.start_time} - {selectedBooking.end_time}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Update Booking Status</DialogTitle>
            <DialogDescription>
              Update the booking status and send notification email to the user
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <form onSubmit={handleStatusUpdate} className="space-y-4">
              {(selectedBooking.status as string) === "checked-in" ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded">
                  <p className="font-medium">This booking is checked-in and cannot have its status changed. Only deletion is allowed for edge cases.</p>
                </div>
              ) : (
                <div>
                  <Label htmlFor="status">New Status *</Label>
                  <Select 
                    name="status" 
                    value={selectedStatusInForm || selectedBooking.status} 
                    onValueChange={(value) => {
                      setSelectedStatusInForm(value)
                      if (value !== "postponed") {
                        setPostponeMode("user-propose")
                        setProposedDateRange("single")
                      }
                    }}
                    disabled={saving || (selectedBooking.status as string) === "checked-in"}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="postponed">Postponed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                // Check if selected status is postponed
                const currentStatus = selectedStatusInForm || selectedBooking.status
                if (currentStatus === "postponed") {
                  return (
                    <>
                      <div className="space-y-3">
                        <Label>Postpone Mode *</Label>
                        <RadioGroup
                          name="postpone_mode"
                          value={postponeMode}
                          onValueChange={(value) => {
                            setPostponeMode(value as "user-propose" | "admin-propose")
                            if (value === "user-propose") {
                              setProposedDateRange("single")
                            }
                          }}
                          disabled={saving}
                          className="flex gap-6"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="user-propose" id="user-propose" />
                            <Label htmlFor="user-propose" className="font-normal cursor-pointer">
                              Let User Propose Date
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="admin-propose" id="admin-propose" />
                            <Label htmlFor="admin-propose" className="font-normal cursor-pointer">
                              Admin Proposes Date
                            </Label>
                          </div>
                        </RadioGroup>
                        <p className="text-sm text-gray-500">
                          {postponeMode === "user-propose"
                            ? "User will be asked to propose an alternative date or cancel"
                            : "You must provide specific dates and times for the user to accept"}
                        </p>
                      </div>

                      {postponeMode === "admin-propose" && (
                        <>
                          <div>
                            <Label htmlFor="proposed_date_range">
                              Date Range Type * <span className="text-red-500">(required)</span>
                            </Label>
                            <Select
                              name="proposed_date_range"
                              value={proposedDateRange}
                              onValueChange={(value) => setProposedDateRange(value as "single" | "multiple")}
                              disabled={saving}
                              required
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
                          <div>
                            <Label htmlFor="proposed_start_date">
                              Proposed Start Date * <span className="text-red-500">(required)</span>
                            </Label>
                            <Input
                              id="proposed_start_date"
                              name="proposed_start_date"
                              type="date"
                              disabled={saving}
                              required
                            />
                          </div>
                          {proposedDateRange === "multiple" && (
                            <div>
                              <Label htmlFor="proposed_end_date">
                                Proposed End Date * <span className="text-red-500">(required)</span>
                              </Label>
                              <Input
                                id="proposed_end_date"
                                name="proposed_end_date"
                                type="date"
                                disabled={saving}
                                required
                              />
                            </div>
                          )}
                          <div>
                            <Label htmlFor="proposed_start_time">
                              Proposed Start Time * <span className="text-red-500">(required)</span>
                            </Label>
                            <Input
                              id="proposed_start_time"
                              name="proposed_start_time"
                              type="text"
                              placeholder="e.g., 9:00 AM"
                              disabled={saving}
                              required
                            />
                          </div>
                          <div>
                            <Label htmlFor="proposed_end_time">
                              Proposed End Time * <span className="text-red-500">(required)</span>
                            </Label>
                            <Input
                              id="proposed_end_time"
                              name="proposed_end_time"
                              type="text"
                              placeholder="e.g., 5:00 PM"
                              disabled={saving}
                              required
                            />
                          </div>
                        </>
                      )}
                    </>
                  )
                }
                return null
              })()}
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
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStatusDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
              {(selectedBooking.status as string) !== "checked-in" && (
                <Button type="submit" disabled={saving}>
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
    </div>
  )
}

