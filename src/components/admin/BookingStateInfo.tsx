"use client"

import { AlertCircle, Clock, Calendar, CheckCircle2, XCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { willAutoUpdate } from "@/lib/booking-action-validation"
import { calculateStartTimestamp } from "@/lib/booking-validations"
import { getBangkokTime } from "@/lib/timezone-client"
import { format } from "date-fns"
import type { BookingStatus } from "@/lib/booking-state-machine"
import { API_PATHS } from "@/lib/api-config"

interface Booking {
  id: string
  status: BookingStatus
  start_date: number
  end_date: number | null
  start_time: string | null
  end_time: string | null
  proposed_date: number | null
  proposed_end_date: number | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
  deposit_verified_by: string | null
  fee_amount?: number | null
  fee_amount_original?: number | null
  fee_currency?: string | null
  fee_conversion_rate?: number | null
}

interface BookingStateInfoProps {
  booking: Booking
}

export function BookingStateInfo({ booking }: BookingStateInfoProps) {
  const autoUpdateInfo = willAutoUpdate(booking)
  // CRITICAL: Use Bangkok time for all date comparisons to match server-side logic
  const now = getBangkokTime()
  
  // Calculate start timestamp including time component (CRITICAL: Use calculateStartTimestamp to include start_time)
  const startTimestamp = calculateStartTimestamp(
    booking.start_date,
    booking.start_time || null
  )
  const startDate = new Date(startTimestamp * 1000)
  
  // Check if start date has passed (using Bangkok timezone for consistency)
  const startDatePassed = startTimestamp < now
  
  // Format dates
  const formatTimestamp = (timestamp: number) => {
    return format(new Date(timestamp * 1000), "MMM dd, yyyy 'at' h:mm a")
  }
  
  const formatDate = (timestamp: number) => {
    return format(new Date(timestamp * 1000), "MMM dd, yyyy")
  }

  return (
    <div className="space-y-3">
      {/* Status badges are now shown in the header row, not here */}
      
      {/* Date Warnings */}
      {startDatePassed && booking.status !== "finished" && booking.status !== "cancelled" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Start Date Has Passed</AlertTitle>
          <AlertDescription>
            Booking start date ({formatDate(booking.start_date)}) has passed.
            {booking.status === "pending" || booking.status === "pending_deposit" || booking.status === "paid_deposit"
              ? " This booking will be auto-cancelled if not confirmed."
              : ""}
          </AlertDescription>
        </Alert>
      )}

      {/* Proposed Date Info - Only show if proposed_date exists (for historical data or edge cases) */}
      {booking.proposed_date && (
        <Alert variant="default">
          <Calendar className="h-4 w-4" />
          <AlertTitle>Proposed Date</AlertTitle>
          <AlertDescription>
            User has proposed: {formatDate(booking.proposed_date)}
            {booking.proposed_end_date && booking.proposed_end_date !== booking.proposed_date && (
              <span> - {formatDate(booking.proposed_end_date)}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Auto-update Info */}
      {autoUpdateInfo.willUpdate && (
        <Alert variant="default" className="bg-yellow-50 border-yellow-200 text-yellow-800">
          <Clock className="h-4 w-4" />
          <AlertTitle>Auto-Update Scheduled</AlertTitle>
          <AlertDescription>
            This booking will automatically update to "{autoUpdateInfo.targetStatus}" 
            {autoUpdateInfo.reason && ` (${autoUpdateInfo.reason})`}
          </AlertDescription>
        </Alert>
      )}

      {/* User Activity */}
      {booking.response_date && (
        <div className="text-sm text-gray-600 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span>
            User last responded: {formatTimestamp(booking.response_date)}
          </span>
        </div>
      )}

      {/* Deposit Info */}
      {booking.status === "paid_deposit" && booking.deposit_evidence_url && (
        <Alert variant="default">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Deposit Evidence Uploaded</AlertTitle>
          <AlertDescription>
            Deposit evidence is available. Please verify before confirming the booking.{" "}
            <a 
              href={API_PATHS.adminDepositImage(booking.id)}
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              View Deposit Evidence
            </a>
          </AlertDescription>
        </Alert>
      )}

      {booking.status === "pending_deposit" && booking.deposit_evidence_url && (
        <Alert variant="default" className="bg-orange-50 border-orange-200 text-orange-800">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Deposit Rejected</AlertTitle>
          <AlertDescription>
            Previous deposit evidence was rejected. User must upload a new deposit.
          </AlertDescription>
        </Alert>
      )}
      
      {booking.status === "pending_deposit" && !booking.deposit_evidence_url && (
        <Alert variant="default" className="bg-blue-50 border-blue-200 text-blue-800">
          <Clock className="h-4 w-4" />
          <AlertTitle>Deposit Required</AlertTitle>
          <AlertDescription>
            Booking has been accepted. Waiting for user to upload deposit evidence.
          </AlertDescription>
        </Alert>
      )}

      {/* Fee Information */}
      {(booking.status === "confirmed" || booking.status === "finished") && (() => {
        // Handle both snake_case (from API) and camelCase (from formatBooking)
        const feeAmount = (booking as any).fee_amount ?? (booking as any).feeAmount
        const feeAmountOriginal = (booking as any).fee_amount_original ?? (booking as any).feeAmountOriginal
        const feeCurrency = (booking as any).fee_currency ?? (booking as any).feeCurrency
        const hasFee = feeAmount != null && feeAmount !== undefined && Number(feeAmount) > 0
        
        return (
          <Alert variant="default" className={hasFee ? "bg-green-50 border-green-200 text-green-800" : "bg-yellow-50 border-yellow-200 text-yellow-800"}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Fee Status</AlertTitle>
            <AlertDescription>
              {hasFee ? (
                <div>
                  <div className="font-medium">
                    Fee Recorded: {Number(feeAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
                    {feeCurrency && feeCurrency.toUpperCase() !== "THB" && feeAmountOriginal && (
                      <span className="text-sm font-normal">
                        {" "}({Number(feeAmountOriginal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {feeCurrency})
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-medium">Fee not recorded yet</div>
                  <div className="text-sm mt-1">Click "Record Fee" to add fee information</div>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )
      })()}
    </div>
  )
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    accepted: "default",
    paid_deposit: "secondary",
    pending_deposit: "outline",
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
  
  const labels: Record<string, string> = {
    "checked-in": "Checked In",
    "paid_deposit": "Paid Deposit",
    "pending_deposit": "Pending Deposit",
  }
  
  return (
    <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
      {labels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

