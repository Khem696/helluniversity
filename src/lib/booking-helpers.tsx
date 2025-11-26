import React from "react"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { Badge } from "@/components/ui/badge"
import type { Booking as BookingType } from "@/hooks/useInfiniteAdminBookings"

type Booking = BookingType

/**
 * Helper function to add AM/PM to 24-hour time format for display
 * Converts "13:00" -> "13:00 PM", "09:30" -> "09:30 AM", "00:00" -> "00:00 AM"
 */
export function formatTimeForDisplay(time24: string | null | undefined): string {
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

/**
 * Helper function to get booking reference number
 * Returns "N/A" if reference_number is missing (indicates data integrity issue)
 */
export function getBookingReferenceNumber(booking: Booking): string {
  if (booking.reference_number) {
    return booking.reference_number
  }
  // If reference_number is missing, return "N/A" instead of generating a fallback
  // This indicates a data integrity issue that should be fixed, not masked
  return "N/A"
}

/**
 * Format timestamp for display (with time)
 */
export function formatTimestamp(timestamp: number | null | undefined): string {
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

/**
 * Format date for display (date only)
 */
export function formatDate(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === 0) return "N/A"
  try {
    // Handle both Unix timestamp (seconds) and milliseconds
    const timestampMs = timestamp > 1000000000000 
      ? timestamp // Already in milliseconds
      : timestamp * 1000 // Convert from seconds to milliseconds
    
    // Convert UTC timestamp to Bangkok timezone for display
    // Timestamps in DB are UTC but represent Bangkok time
    const utcDate = new Date(timestampMs)
    const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
    
    return format(bangkokDate, "MMM dd, yyyy")
  } catch (error) {
    console.error("Error formatting date:", timestamp, error)
    return "N/A"
  }
}

/**
 * Format fee for display
 */
export function formatFee(booking: Booking): React.ReactNode {
  // Handle both snake_case (from API) and camelCase (from formatBooking)
  const feeAmount = (booking as any).fee_amount ?? (booking as any).feeAmount
  const feeAmountOriginal = (booking as any).fee_amount_original ?? (booking as any).feeAmountOriginal
  const feeCurrency = (booking as any).fee_currency ?? (booking as any).feeCurrency
  
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
  
  if (feeNum === null || isNaN(feeNum) || feeNum <= 0) {
    return <span className="text-gray-400 italic">Not recorded</span>
  }
  
  const baseAmount = feeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (feeCurrency && feeCurrency.toUpperCase() !== "THB" && feeAmountOriginal) {
    const originalAmount = Number(feeAmountOriginal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return (
      <div className="text-sm">
        <div className="font-medium text-gray-900">{baseAmount} THB</div>
        <div className="text-gray-500 text-xs">{originalAmount} {feeCurrency}</div>
      </div>
    )
  }
  return <span className="text-sm font-medium text-gray-900">{baseAmount} THB</span>
}

/**
 * Get status badge component
 */
export function getStatusBadge(status: string): React.ReactNode {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    pending_deposit: "secondary",
    confirmed: "default",
    cancelled: "destructive",
    finished: "default",
  }
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
    pending_deposit: "bg-orange-100 text-orange-800 border-orange-300",
    confirmed: "bg-green-100 text-green-800 border-green-300",
    cancelled: "bg-gray-100 text-gray-800 border-gray-300",
    finished: "bg-gray-100 text-gray-800 border-gray-300",
  }
  return (
    <Badge className={colors[status] || ""} variant={variants[status] || "default"}>
      {status === "pending_deposit" ? "Pending Deposit" : status === "confirmed" ? "Confirmed" : status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

