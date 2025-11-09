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
} from "lucide-react"
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
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled"
  admin_notes: string | null
  response_token: string | null
  proposed_date: number | null
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
    }
  }, [session, statusFilter, emailFilter])

  // Fetch booking details and history
  const fetchBookingDetails = async (bookingId: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}`)
      const data = await response.json()
      if (data.success) {
        setSelectedBooking(data.booking)
        setStatusHistory(data.statusHistory || [])
      } else {
        toast.error(data.error || "Failed to load booking details")
      }
    } catch (error) {
      toast.error("Failed to load booking details")
      console.error(error)
    }
  }

  // Handle status update
  const handleStatusUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedBooking) return

    setSaving(true)
    const formData = new FormData(e.currentTarget)
    const status = formData.get("status") as string
    const changeReason = formData.get("change_reason") as string
    const adminNotes = formData.get("admin_notes") as string
    const proposedDate = formData.get("proposed_date") as string

    try {
      const response = await fetch(`/api/admin/bookings/${selectedBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          changeReason: changeReason || null,
          adminNotes: adminNotes || null,
          proposedDate: proposedDate || null,
        }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Booking status updated successfully. Email notification sent.")
        setStatusDialogOpen(false)
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
    }
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
      accepted: "bg-green-100 text-green-800 border-green-300",
      rejected: "bg-red-100 text-red-800 border-red-300",
      postponed: "bg-blue-100 text-blue-800 border-blue-300",
      cancelled: "bg-gray-100 text-gray-800 border-gray-300",
    }
    return (
      <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return "N/A"
    return format(new Date(timestamp * 1000), "MMM dd, yyyy 'at' h:mm a")
  }

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return "N/A"
    return format(new Date(timestamp * 1000), "MMM dd, yyyy")
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
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Reservation Management</h1>
        <p className="text-gray-600">Manage booking requests and status updates</p>
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
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="postponed">Postponed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
                        {booking.start_time} - {booking.end_time}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(booking.status)}
                      {booking.proposed_date && booking.status === "postponed" && (
                        <div className="text-xs text-gray-500 mt-1">
                          Proposed: {formatDate(booking.proposed_date)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestamp(booking.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
                <Button
                  onClick={() => {
                    setStatusDialogOpen(true)
                  }}
                >
                  Update Status
                </Button>
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
              <div>
                <Label htmlFor="status">New Status *</Label>
                <Select name="status" defaultValue={selectedBooking.status} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="postponed">Postponed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
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
                <Label htmlFor="proposed_date">Proposed Date (for postponed status)</Label>
                <Input
                  id="proposed_date"
                  name="proposed_date"
                  type="date"
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
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStatusDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
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
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

