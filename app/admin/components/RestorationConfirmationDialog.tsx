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
import { AlertCircle, Info, Trash2, CheckCircle2, Clock } from "lucide-react"

interface RestorationConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetStatus: "pending_deposit" | "paid_deposit" | "confirmed"
  bookingHasDepositEvidence: boolean
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function RestorationConfirmationDialog({
  open,
  onOpenChange,
  targetStatus,
  bookingHasDepositEvidence,
  onConfirm,
  onCancel,
  loading = false,
}: RestorationConfirmationDialogProps) {
  const getStatusInfo = () => {
    switch (targetStatus) {
      case "pending_deposit":
        return {
          title: "Restore to Pending Deposit",
          description: bookingHasDepositEvidence
            ? "This will restore the booking to Pending Deposit status. Any existing deposit evidence will be deleted, and the user will need to upload a new deposit evidence."
            : "This will restore the booking to Pending Deposit status. The user will receive a deposit upload link and must upload deposit evidence before the booking start date.",
          icon: Clock,
          color: "text-yellow-600",
          bgColor: "bg-yellow-50",
          borderColor: "border-yellow-200",
          details: bookingHasDepositEvidence
            ? [
                "⚠️ Any existing deposit evidence will be DELETED",
                "A new deposit upload link will be generated and sent to the user",
                "The user must upload a new deposit evidence before the booking start date",
                "After upload, the booking will move to 'Paid Deposit' status",
                "Admin can then verify the deposit and confirm the booking",
              ]
            : [
                "A new deposit upload link will be generated and sent to the user",
                "The user must upload deposit evidence before the booking start date",
                "After upload, the booking will move to 'Paid Deposit' status",
                "Admin can then verify the deposit and confirm the booking",
              ],
          depositWarning: bookingHasDepositEvidence
            ? "⚠️ WARNING: Any existing deposit evidence will be DELETED. The user will need to upload a new deposit evidence."
            : "ℹ️ This booking has no previous deposit evidence. The user will need to upload deposit evidence for the first time.",
        }
      case "paid_deposit":
        return {
          title: "Restore to Paid Deposit",
          description: "This will restore the booking to Paid Deposit status. The existing deposit evidence (if any) will be preserved for admin verification.",
          icon: CheckCircle2,
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          details: [
            "The booking will be restored with existing deposit evidence (if available)",
            "Admin can verify the deposit evidence and confirm the booking",
            "If no deposit evidence exists, admin can request a new upload",
            "The user will receive an email notification about the restoration",
          ],
          depositWarning: bookingHasDepositEvidence
            ? "ℹ️ Existing deposit evidence will be preserved. Admin can verify it after restoration."
            : "ℹ️ No deposit evidence found. Admin may need to request a new deposit upload after restoration.",
        }
      case "confirmed":
        return {
          title: "Restore to Confirmed",
          description: bookingHasDepositEvidence
            ? "This will restore the booking directly to Confirmed status. The booking will be immediately active and confirmed. Existing deposit evidence will be preserved."
            : "This will restore the booking directly to Confirmed status. Use this when deposit was verified through other channels (phone, in-person, etc.). The booking will be immediately active and confirmed.",
          icon: CheckCircle2,
          color: "text-green-600",
          bgColor: "bg-green-50",
          borderColor: "border-green-200",
          details: bookingHasDepositEvidence
            ? [
                "The booking will be immediately confirmed and active",
                "Existing deposit evidence will be preserved",
                "Deposit will be marked as verified via other channel",
                "The user will receive a confirmation email",
                "The booking will appear in the active bookings list",
              ]
            : [
                "The booking will be immediately confirmed and active",
                "Deposit will be marked as verified via other channel (no evidence uploaded)",
                "Use this when deposit was paid/verified through phone, in-person, or other means",
                "The user will receive a confirmation email",
                "The booking will appear in the active bookings list",
              ],
          depositWarning: bookingHasDepositEvidence
            ? "ℹ️ Existing deposit evidence will be preserved and marked as verified via other channel. If you want to verify it manually first, restore to 'Paid Deposit' instead."
            : "ℹ️ No deposit evidence found. This restoration assumes deposit was verified through other channels (phone, in-person, etc.). The booking will be confirmed with 'other channel' verification flag.",
        }
      default:
        return null
    }
  }

  const statusInfo = getStatusInfo()
  if (!statusInfo) return null

  const Icon = statusInfo.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${statusInfo.color}`} />
            {statusInfo.title}
          </DialogTitle>
          <DialogDescription className="text-base mt-2">
            {statusInfo.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status Details */}
          <div className={`${statusInfo.bgColor} ${statusInfo.borderColor} border rounded-lg p-4`}>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Info className="h-4 w-4" />
              What this means:
            </h4>
            <ul className="space-y-1.5 text-sm">
              {statusInfo.details.map((detail, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-gray-500 mt-0.5">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Deposit Evidence Warning */}
          {statusInfo.depositWarning && (
            <Alert
              variant={targetStatus === "pending_deposit" && bookingHasDepositEvidence ? "destructive" : "default"}
              className={targetStatus === "pending_deposit" && bookingHasDepositEvidence ? "border-red-300 bg-red-50" : ""}
            >
              {targetStatus === "pending_deposit" && bookingHasDepositEvidence ? (
                <Trash2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle className="font-semibold">
                {targetStatus === "pending_deposit" && bookingHasDepositEvidence
                  ? "Deposit Evidence Will Be Deleted"
                  : "Deposit Evidence Status"}
              </AlertTitle>
              <AlertDescription className="text-sm mt-1">
                {statusInfo.depositWarning}
              </AlertDescription>
            </Alert>
          )}

          {/* Additional Warning for Pending Deposit */}
          {targetStatus === "pending_deposit" && bookingHasDepositEvidence && (
            <Alert variant="destructive" className="border-red-300 bg-red-50">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="font-semibold">Important Notice</AlertTitle>
              <AlertDescription className="text-sm mt-1">
                If this booking was previously in "Paid Deposit" or "Confirmed" status, all deposit verification records (including verification timestamp, verified by, and evidence URL) will be cleared. The user will need to upload a completely new deposit evidence.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={targetStatus === "pending_deposit" && bookingHasDepositEvidence ? "bg-red-600 hover:bg-red-700" : ""}
          >
            {loading ? "Processing..." : "Confirm Restoration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

