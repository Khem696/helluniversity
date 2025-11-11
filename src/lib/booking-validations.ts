/**
 * Booking Validation Utilities
 * 
 * Contains validation functions for booking status transitions, dates, and overlaps
 */

import { getTursoClient } from "./turso"

// Valid status transitions matrix
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["accepted", "rejected", "postponed", "cancelled"],
  accepted: ["postponed", "cancelled", "checked-in", "finished"],
  rejected: ["pending", "accepted"], // Allow re-opening rejected bookings
  postponed: ["accepted", "rejected", "cancelled", "pending"],
  cancelled: ["pending", "accepted"], // Allow re-opening cancelled bookings
  "checked-in": ["finished", "cancelled"], // Can only finish or cancel checked-in
  finished: [], // Finished bookings cannot be changed (except deletion)
}

// Grace period for check-in (in seconds) - default 1 hour
export const CHECK_IN_GRACE_PERIOD = 60 * 60 // 1 hour in seconds

/**
 * Validate if a status transition is valid
 */
export function isValidStatusTransition(
  fromStatus: string,
  toStatus: string
): { valid: boolean; reason?: string } {
  // Same status is always valid (no-op)
  if (fromStatus === toStatus) {
    return { valid: true }
  }

  const allowedTransitions = VALID_STATUS_TRANSITIONS[fromStatus] || []
  
  if (!allowedTransitions.includes(toStatus)) {
    return {
      valid: false,
      reason: `Cannot transition from "${fromStatus}" to "${toStatus}". Allowed transitions: ${allowedTransitions.join(", ")}`,
    }
  }

  return { valid: true }
}

/**
 * Validate if a date is in the past
 */
export function isDateInPast(date: string | null | undefined): boolean {
  if (!date) return false
  const dateTimestamp = Math.floor(new Date(date).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  return dateTimestamp < now
}

/**
 * Validate if a date is in the future
 */
export function isDateInFuture(date: string | null | undefined): boolean {
  if (!date) return false
  const dateTimestamp = Math.floor(new Date(date).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  return dateTimestamp > now
}

/**
 * Calculate start timestamp including time
 */
export function calculateStartTimestamp(
  startDate: number,
  startTime: string | null
): number {
  let startTimestamp = startDate

  if (startTime) {
    try {
      const [timePart, period] = startTime.trim().split(/\s+/)
      const [hours, minutes] = timePart.split(":").map(Number)
      
      let hour24 = hours
      if (period) {
        if (period.toUpperCase() === "PM" && hour24 !== 12) {
          hour24 += 12
        } else if (period.toUpperCase() === "AM" && hour24 === 12) {
          hour24 = 0
        }
      }

      const startDateObj = new Date(startTimestamp * 1000)
      startDateObj.setHours(hour24, minutes || 0, 0, 0)
      startTimestamp = Math.floor(startDateObj.getTime() / 1000)
    } catch (error) {
      console.warn(`Failed to parse start_time:`, error)
    }
  }

  return startTimestamp
}

/**
 * Check if check-in is allowed (within grace period)
 */
export function isCheckInAllowed(
  startDate: number,
  startTime: string | null,
  gracePeriod: number = CHECK_IN_GRACE_PERIOD
): { allowed: boolean; reason?: string } {
  const startTimestamp = calculateStartTimestamp(startDate, startTime)
  const now = Math.floor(Date.now() / 1000)
  const gracePeriodEnd = startTimestamp + gracePeriod

  // Check-in is allowed if:
  // 1. Before start date (early check-in)
  // 2. Within grace period after start date
  if (now <= gracePeriodEnd) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason: `Check-in is only allowed before or within ${gracePeriod / 60} minutes after the start date/time.`,
  }
}

/**
 * Check if bookings overlap in time
 */
export async function checkBookingOverlap(
  bookingId: string | null, // null for new bookings
  startDate: number,
  endDate: number | null,
  startTime: string | null,
  endTime: string | null
): Promise<{ overlaps: boolean; overlappingBookings?: any[] }> {
  const db = getTursoClient()
  
  // Calculate actual start and end timestamps
  const startTimestamp = calculateStartTimestamp(startDate, startTime)
  
  let endTimestamp: number
  if (endDate) {
    // Multiple day booking
    if (endTime) {
      try {
        const [timePart, period] = endTime.trim().split(/\s+/)
        const [hours, minutes] = timePart.split(":").map(Number)
        
        let hour24 = hours
        if (period) {
          if (period.toUpperCase() === "PM" && hour24 !== 12) {
            hour24 += 12
          } else if (period.toUpperCase() === "AM" && hour24 === 12) {
            hour24 = 0
          }
        }

        const endDateObj = new Date(endDate * 1000)
        endDateObj.setHours(hour24, minutes || 0, 0, 0)
        endTimestamp = Math.floor(endDateObj.getTime() / 1000)
      } catch (error) {
        endTimestamp = endDate
      }
    } else {
      endTimestamp = endDate
    }
  } else {
    // Single day booking - use start date with end time or start time
    if (endTime) {
      try {
        const [timePart, period] = endTime.trim().split(/\s+/)
        const [hours, minutes] = timePart.split(":").map(Number)
        
        let hour24 = hours
        if (period) {
          if (period.toUpperCase() === "PM" && hour24 !== 12) {
            hour24 += 12
          } else if (period.toUpperCase() === "AM" && hour24 === 12) {
            hour24 = 0
          }
        }

        const endDateObj = new Date(startDate * 1000)
        endDateObj.setHours(hour24, minutes || 0, 0, 0)
        endTimestamp = Math.floor(endDateObj.getTime() / 1000)
      } catch (error) {
        endTimestamp = startTimestamp
      }
    } else {
      endTimestamp = startTimestamp
    }
  }

  // Find overlapping bookings (only accepted or checked-in status)
  const query = bookingId
    ? `
      SELECT id, name, email, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE id != ?
        AND status IN ('accepted', 'checked-in')
        AND (
          (start_date <= ? AND (end_date >= ? OR end_date IS NULL))
          OR (start_date <= ? AND (end_date >= ? OR end_date IS NULL))
          OR (start_date >= ? AND (end_date <= ? OR end_date IS NULL))
        )
    `
    : `
      SELECT id, name, email, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE status IN ('accepted', 'checked-in')
        AND (
          (start_date <= ? AND (end_date >= ? OR end_date IS NULL))
          OR (start_date <= ? AND (end_date >= ? OR end_date IS NULL))
          OR (start_date >= ? AND (end_date <= ? OR end_date IS NULL))
        )
    `

  const args = bookingId
    ? [bookingId, startTimestamp, startTimestamp, endTimestamp, endTimestamp, startTimestamp, endTimestamp]
    : [startTimestamp, startTimestamp, endTimestamp, endTimestamp, startTimestamp, endTimestamp]

  const result = await db.execute({ sql: query, args })

  if (result.rows.length > 0) {
    return {
      overlaps: true,
      overlappingBookings: result.rows,
    }
  }

  return { overlaps: false }
}

/**
 * Validate proposed dates for postponed bookings
 */
export function validateProposedDates(
  proposedDate: string | null | undefined,
  proposedEndDate: string | null | undefined,
  originalStartDate: number
): { valid: boolean; reason?: string } {
  if (!proposedDate) {
    return { valid: true } // Admin doesn't propose dates
  }

  const proposedTimestamp = Math.floor(new Date(proposedDate).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)

  // Proposed date must be in the future
  if (proposedTimestamp <= now) {
    return {
      valid: false,
      reason: "Proposed date must be in the future.",
    }
  }

  // Proposed date should be after original start date (or allow override)
  if (proposedTimestamp < originalStartDate) {
    return {
      valid: false,
      reason: "Proposed date should be after the original start date.",
    }
  }

  // If multiple days, validate end date
  if (proposedEndDate) {
    const proposedEndTimestamp = Math.floor(new Date(proposedEndDate).getTime() / 1000)
    
    if (proposedEndTimestamp <= now) {
      return {
        valid: false,
        reason: "Proposed end date must be in the future.",
      }
    }

    if (proposedEndTimestamp < proposedTimestamp) {
      return {
        valid: false,
        reason: "Proposed end date must be after proposed start date.",
      }
    }
  }

  return { valid: true }
}


