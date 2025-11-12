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
import { AlertCircle, CheckCircle2, XCircle, Calendar, Users } from "lucide-react"
import type { ActionDefinition } from "@/lib/booking-state-machine"
import type { ValidationResult } from "@/lib/booking-action-validation"

interface ActionConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: ActionDefinition | null
  booking: {
    name: string
    email: string
    status: string
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    proposed_date: number | null
    proposed_end_date: number | null
  } | null
  validation: ValidationResult | null
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
}

export function ActionConfirmationDialog({
  open,
  onOpenChange,
  action,
  booking,
  validation,
  onConfirm,
  onCancel,
  isLoading = false,
}: ActionConfirmationDialogProps) {
  if (!action || !booking) return null

  const hasErrors = validation && validation.errors.length > 0
  const hasWarnings = validation && validation.warnings.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action.type === "destructive" ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            )}
            Confirm Action: {action.label}
          </DialogTitle>
          <DialogDescription>
            Review the details below before confirming this action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Booking Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Booking Details</h4>
            <div className="space-y-1 text-sm">
              <div>
                <span className="font-medium">Name:</span> {booking.name}
              </div>
              <div>
                <span className="font-medium">Email:</span> {booking.email}
              </div>
              <div>
                <span className="font-medium">Current Status:</span> {booking.status}
              </div>
              <div>
                <span className="font-medium">Target Status:</span> {action.targetStatus}
              </div>
            </div>
          </div>

          {/* Action Description */}
          <div>
            <h4 className="font-semibold mb-2">What will happen:</h4>
            <p className="text-sm text-gray-600">{action.description}</p>
          </div>

          {/* Errors - Block action */}
          {hasErrors && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Action Cannot Be Completed</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  {validation!.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Warnings - Allow with confirmation */}
          {hasWarnings && !hasErrors && (
            <Alert variant="default" className="bg-yellow-50 border-yellow-200 text-yellow-800">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  {validation!.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
                {validation!.overlappingBookings && validation!.overlappingBookings.length > 0 && (
                  <div className="mt-3">
                    <p className="font-medium">Overlapping Bookings:</p>
                    <ul className="list-disc list-inside mt-1">
                      {validation!.overlappingBookings.map((b) => (
                        <li key={b.id}>{b.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Email Notification Info */}
          <Alert variant="default" className="bg-blue-50 border-blue-200 text-blue-800">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Email Notification</AlertTitle>
            <AlertDescription>
              An email notification will be sent to {booking.email} with the status update
              {action.targetStatus === "accepted" || action.targetStatus === "postponed"
                ? " and a link to manage their reservation"
                : ""}
              .
            </AlertDescription>
          </Alert>

          {/* State Transition Info */}
          <div className="bg-gray-50 p-3 rounded text-sm">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-gray-600" />
              <span className="font-medium">Status Transition:</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-gray-200 rounded">{booking.status}</span>
              <span>→</span>
              <span className="px-2 py-1 bg-gray-200 rounded">{action.targetStatus}</span>
            </div>
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
            variant={action.type === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isLoading || hasErrors}
          >
            {isLoading ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Processing...
              </>
            ) : (
              `Confirm ${action.label}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

