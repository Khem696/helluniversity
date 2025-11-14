"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle, Trash2, Mail, User, Calendar } from "lucide-react"

interface DeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: {
    id: string
    name: string
    email: string
    status: string
    eventType: string
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    reference_number?: string | null
    depositEvidenceUrl?: string | null
  } | null
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  booking,
  onConfirm,
  onCancel,
  isLoading = false,
}: DeleteConfirmationDialogProps) {
  if (!booking) return null

  const isCancelledOrFinished = booking.status === "cancelled" || booking.status === "finished"
  const willSendUserEmail = !isCancelledOrFinished

  // Format date for display
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  }

  const formatTime = (time: string | null): string => {
    if (!time) return ""
    try {
      const [hours, minutes] = time.split(':')
      const hour = parseInt(hours, 10)
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const displayHour = hour % 12 || 12
      return `${displayHour}:${minutes} ${ampm}`
    } catch {
      return time
    }
  }

  const dateRange = booking.end_date && booking.end_date !== booking.start_date
    ? `${formatDate(booking.start_date)}${booking.start_time ? ` at ${formatTime(booking.start_time)}` : ''} - ${formatDate(booking.end_date)}${booking.end_time ? ` at ${formatTime(booking.end_time)}` : ''}`
    : `${formatDate(booking.start_date)}${booking.start_time ? ` at ${formatTime(booking.start_time)}` : ''}${booking.end_time ? ` - ${formatTime(booking.end_time)}` : ''}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" />
            Confirm Booking Deletion
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. Please review the details below before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Permanent Deletion</AlertTitle>
            <AlertDescription>
              This booking will be permanently deleted from the system. All associated data, including status history, will be removed.
            </AlertDescription>
          </Alert>

          {/* Booking Details */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold text-lg flex items-center gap-2">
              <User className="w-4 h-4" />
              Booking Details
            </h4>
            <div className="space-y-2 text-sm">
              {booking.reference_number && (
                <div>
                  <span className="font-medium">Reference Number:</span> {booking.reference_number}
                </div>
              )}
              <div>
                <span className="font-medium">Name:</span> {booking.name}
              </div>
              <div>
                <span className="font-medium">Email:</span> {booking.email}
              </div>
              <div>
                <span className="font-medium">Event Type:</span> {booking.eventType}
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium">Date & Time:</span> {dateRange}
                </div>
              </div>
              <div>
                <span className="font-medium">Current Status:</span>{" "}
                <span className="px-2 py-1 bg-gray-200 rounded text-xs font-medium">
                  {booking.status}
                </span>
              </div>
            </div>
          </div>

          {/* Email Notification Info */}
          {willSendUserEmail ? (
            <Alert variant="default" className="bg-blue-50 border-blue-200 text-blue-800">
              <Mail className="h-4 w-4" />
              <AlertTitle>Email Notification</AlertTitle>
              <AlertDescription>
                A cancellation email will be sent to <strong>{booking.email}</strong> notifying them that their booking has been deleted.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="default" className="bg-gray-50 border-gray-200 text-gray-700">
              <Mail className="h-4 w-4" />
              <AlertTitle>No User Email</AlertTitle>
              <AlertDescription>
                {booking.status === "finished"
                  ? "No user email will be sent as the event has already finished."
                  : "No user email will be sent as the booking was already cancelled."}
              </AlertDescription>
            </Alert>
          )}

          {/* Admin Notification Info */}
          <Alert variant="default" className="bg-purple-50 border-purple-200 text-purple-800">
            <Mail className="h-4 w-4" />
            <AlertTitle>Admin Notification</AlertTitle>
            <AlertDescription>
              An email notification will be sent to the admin team about this deletion.
            </AlertDescription>
          </Alert>

          {/* What Will Happen */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-semibold mb-2 text-yellow-900">What will happen:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-800">
              <li>The booking will be permanently removed from the database</li>
              <li>All status history will be deleted (cascade delete)</li>
              {booking.depositEvidenceUrl && (
                <li>Deposit evidence image will be deleted from storage</li>
              )}
              {willSendUserEmail && (
                <li>A cancellation email will be sent to the user</li>
              )}
              <li>An admin notification email will be sent</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin">⏳</span>
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete Booking
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

