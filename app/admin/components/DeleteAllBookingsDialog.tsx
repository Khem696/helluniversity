"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle, Trash2 } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toast } from "react-hot-toast"

interface DeleteAllBookingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type BookingType = "active" | "archive"

export function DeleteAllBookingsDialog({
  open,
  onOpenChange,
  onSuccess,
}: DeleteAllBookingsDialogProps) {
  const [bookingType, setBookingType] = useState<BookingType>("active")
  const [confirmationText, setConfirmationText] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const requiredText = "DELETE ALL"
  const isConfirmed = confirmationText === requiredText

  const handleDelete = async () => {
    if (!isConfirmed) {
      toast.error(`Please type "${requiredText}" to confirm`)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/admin/bookings/delete-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: bookingType,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = "Failed to delete bookings"
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = errorText || errorMessage
        }
        toast.error(errorMessage)
        return
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        toast.error("Invalid response from server")
        return
      }

      const data = await response.json()
      
      if (data.success) {
        const count = data.data?.deletedCount || 0
        toast.success(
          `Successfully deleted ${count} ${bookingType} booking${count !== 1 ? "s" : ""}`,
          { duration: 5000 }
        )
        onOpenChange(false)
        setConfirmationText("")
        setBookingType("active")
        onSuccess?.()
      } else {
        toast.error(data.error || "Failed to delete bookings")
      }
    } catch (error) {
      toast.error("Failed to delete bookings")
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false)
      setConfirmationText("")
    }
  }

  const bookingTypeLabel = bookingType === "active" ? "Active" : "Archive"
  const bookingTypeDescription =
    bookingType === "active"
      ? "All bookings with status: pending, pending_deposit, paid_deposit, or confirmed"
      : "All bookings with status: finished or cancelled"

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" />
            Delete All {bookingTypeLabel} Bookings
          </DialogTitle>
          <DialogDescription>
            This is a destructive action that cannot be undone. Please select the booking type and confirm carefully.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Dangerous Operation</AlertTitle>
            <AlertDescription>
              This will permanently delete all {bookingTypeLabel.toLowerCase()} bookings from the system. All associated data, including status history and deposit evidence, will be removed.
            </AlertDescription>
          </Alert>

          {/* Booking Type Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Select Booking Type to Delete</Label>
            <RadioGroup
              value={bookingType}
              onValueChange={(value) => {
                setBookingType(value as BookingType)
                setConfirmationText("") // Reset confirmation when type changes
              }}
              disabled={isLoading}
            >
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50">
                <RadioGroupItem value="active" id="active" />
                <Label htmlFor="active" className="flex-1 cursor-pointer">
                  <div>
                    <div className="font-medium">Active Bookings</div>
                    <div className="text-sm text-gray-600">
                      pending, pending_deposit, paid_deposit, confirmed
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50">
                <RadioGroupItem value="archive" id="archive" />
                <Label htmlFor="archive" className="flex-1 cursor-pointer">
                  <div>
                    <div className="font-medium">Archive Bookings</div>
                    <div className="text-sm text-gray-600">
                      finished, cancelled
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* What Will Be Deleted */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-semibold mb-2 text-yellow-900">What will be deleted:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-800">
              <li>All {bookingTypeLabel.toLowerCase()} bookings ({bookingTypeDescription})</li>
              <li>All status history records for these bookings</li>
              <li>All deposit evidence images from storage</li>
              <li>All admin action logs related to these bookings</li>
            </ul>
          </div>

          {/* Confirmation Input */}
          <div className="space-y-2">
            <Label htmlFor="confirmation" className="text-base font-semibold">
              Type <span className="font-mono bg-gray-100 px-2 py-1 rounded">{requiredText}</span> to confirm:
            </Label>
            <Input
              id="confirmation"
              type="text"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={requiredText}
              disabled={isLoading}
              className="font-mono"
            />
            {confirmationText && !isConfirmed && (
              <p className="text-sm text-red-600">
                Text does not match. Please type exactly "{requiredText}"
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || isLoading}
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
                Delete All {bookingTypeLabel} Bookings
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

