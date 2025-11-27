/**
 * Booking Action Validation
 * 
 * Pre-action validation utilities to check dates, overlaps, and user activity
 * before allowing admin actions.
 */

import { 
  calculateStartTimestamp, 
  CHECK_IN_GRACE_PERIOD 
} from "./booking-validations"
// checkBookingOverlap is imported dynamically to avoid bundling database code in client components
import { getBangkokTime, isPastInBangkok } from "./timezone"
import { TZDate } from '@date-fns/tz'
import { logError } from "./logger"

export interface Booking {
  id: string
  status: string
  start_date: number
  end_date: number | null
  start_time: string | null
  end_time: string | null
  proposed_date: number | null
  proposed_end_date: number | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
}

export interface ValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
  overlappingBookings?: Array<{ id: string; name: string }>
}

/**
 * Validate action before execution
 */
export async function validateAction(
  action: string,
  booking: Booking,
  targetStatus: string
): Promise<ValidationResult> {
  const warnings: string[] = []
  const errors: string[] = []
  let overlappingBookings: Array<{ id: string; name: string }> | undefined

  // Use GMT+7 (Bangkok time) for all date comparisons
  const now = getBangkokTime()

  // Check if dates are in the past (for accept/verify_deposit actions)
  if (action === "accept" || action === "verify_deposit") {
    // Check original dates
    const startTimestamp = calculateStartTimestamp(
      booking.start_date,
      booking.start_time || null
    )
    
    if (startTimestamp < now) {
      errors.push(
        "Booking start date is in the past. This booking will be auto-cancelled if accepted."
      )
    } else {
      // Check if start date is within grace period
      const gracePeriodEnd = startTimestamp + CHECK_IN_GRACE_PERIOD
      if (now > startTimestamp && now <= gracePeriodEnd) {
        warnings.push(
          "Booking start date has passed."
        )
      }
    }
  }

  // Check for overlaps (for accept/verify_deposit actions)
  if (action === "accept" || action === "verify_deposit") {
    try {
      // Dynamically import checkBookingOverlap to avoid bundling database code
      // This function requires database access and should only run server-side
      const { checkBookingOverlap } = await import("./booking-validations")
      
      // Check overlaps with original dates
      const checkStartDate = booking.start_date
      const checkEndDate = booking.end_date || null
      
      const overlapCheck = await checkBookingOverlap(
        booking.id,
        checkStartDate,
        checkEndDate,
        booking.start_time || null,
        booking.end_time || null
      )
      
      if (overlapCheck.overlaps) {
        overlappingBookings = overlapCheck.overlappingBookings?.map((b: any) => ({
          id: b.id,
          name: b.name || "Unknown",
        })) || []
        
        const overlappingNames = overlappingBookings
          .map((b) => b.name)
          .join(", ")
        
        warnings.push(
          `This booking overlaps with existing confirmed booking(s): ${overlappingNames}. Please verify this is intentional.`
        )
      }
    } catch (error) {
      // Fire-and-forget logging
      logError("Error checking overlaps", { bookingId: booking.id }, error instanceof Error ? error : new Error(String(error))).catch(() => {})
      warnings.push("Could not verify booking overlaps. Please check manually.")
    }
  }

  // Check user activity (warn if user recently accessed pages)
  if (booking.response_date) {
    const responseTime = booking.response_date * 1000 // Convert to milliseconds
    const fiveMinutesAgo = (now * 1000) - 5 * 60 * 1000 // Use GMT+7 time
    
    if (responseTime > fiveMinutesAgo) {
      warnings.push(
        "User recently responded. Changing status now might disrupt their current action."
      )
    }
  }

  // Check deposit evidence for verify_deposit action
  if (action === "verify_deposit" && !booking.deposit_evidence_url) {
    errors.push("No deposit evidence found. Cannot verify deposit without evidence.")
  }

  // Check if booking is already in target status
  if (booking.status === targetStatus) {
    warnings.push(`Booking is already in "${targetStatus}" status.`)
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    overlappingBookings,
  }
}

/**
 * Check if booking will auto-update
 * 
 * Valid statuses: pending, pending_deposit, paid_deposit, confirmed, cancelled, finished
 */
export function willAutoUpdate(booking: Booking): {
  willUpdate: boolean
  targetStatus?: string
  reason?: string
} {
  // Use GMT+7 (Bangkok time) for all date comparisons
  const now = getBangkokTime()
  const startTimestamp = calculateStartTimestamp(
    booking.start_date,
    booking.start_time || null
  )

  // Check if booking will auto-cancel (pending/pending_deposit/paid_deposit past start date)
  if (
    (booking.status === "pending" || 
     booking.status === "pending_deposit" || 
     booking.status === "paid_deposit") &&
    startTimestamp < now
  ) {
    return {
      willUpdate: true,
      targetStatus: "cancelled",
      reason: "Start date has passed without confirmation",
    }
  }

  // Check if booking will auto-finish (past end date)
  // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
  let endTimestamp: number | null = null
  if (booking.end_date) {
    endTimestamp = booking.end_date
    if (booking.end_time) {
      // Calculate end timestamp with time
      try {
        const BANGKOK_TIMEZONE = 'Asia/Bangkok'
        const [hours, minutes] = booking.end_time.split(":").map(Number)
        const utcDate = new Date(booking.end_date * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
        const tzDateWithTime = new TZDate(year, month, day, hours, minutes, 0, BANGKOK_TIMEZONE)
        endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
      } catch {
        // Use date only
      }
    }
  } else if (booking.end_time) {
    // Single day booking - use start date with end time
    try {
      const BANGKOK_TIMEZONE = 'Asia/Bangkok'
      const [hours, minutes] = booking.end_time?.split(":").map(Number) || [23, 59]
      const utcDate = new Date(booking.start_date * 1000)
      const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
      const year = tzDate.getFullYear()
      const month = tzDate.getMonth()
      const day = tzDate.getDate()
      const tzDateWithTime = new TZDate(year, month, day, hours, minutes, 0, BANGKOK_TIMEZONE)
      endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
    } catch {
      endTimestamp = booking.start_date
    }
  }

  // Only confirmed bookings can auto-finish
  if (
    endTimestamp &&
    endTimestamp < now &&
    booking.status === "confirmed"
  ) {
    return {
      willUpdate: true,
      targetStatus: "finished",
      reason: "End date has passed",
    }
  }

  return { willUpdate: false }
}

/**
 * Format validation result for display
 */
export function formatValidationResult(result: ValidationResult): {
  message: string
  type: "error" | "warning" | "success"
} {
  if (result.errors.length > 0) {
    return {
      message: result.errors.join("\n"),
      type: "error",
    }
  }
  
  if (result.warnings.length > 0) {
    return {
      message: result.warnings.join("\n"),
      type: "warning",
    }
  }
  
  return {
    message: "Action is valid",
    type: "success",
  }
}

