/**
 * Booking Validation Utilities
 * 
 * Contains validation functions for booking status transitions, dates, and overlaps
 */

import { getTursoClient } from "./turso"
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { createBangkokTimestamp, getBangkokTime } from './timezone'

const BANGKOK_TIMEZONE = 'Asia/Bangkok' // GMT+7

/**
 * Convert UTC timestamp to Bangkok timezone date string (YYYY-MM-DD)
 */
function timestampToBangkokDateString(timestamp: number): string {
  const utcDate = new Date(timestamp * 1000)
  const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
  return format(tzDate, 'yyyy-MM-dd')
}

// Valid status transitions matrix
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["pending_deposit", "cancelled"], // Accept -> pending_deposit, Reject -> cancelled
  pending_deposit: ["paid_deposit", "confirmed", "cancelled"], // User uploads deposit -> paid_deposit, Admin confirms via other channel -> confirmed, Cancel -> cancelled
  paid_deposit: ["confirmed", "pending_deposit", "cancelled"], // Accept deposit -> confirmed, Reject deposit -> pending_deposit (user re-uploads), Cancel -> cancelled
  confirmed: ["finished", "cancelled"], // Past end date -> finished, Cancel -> cancelled (date change doesn't change status)
  cancelled: ["pending_deposit", "paid_deposit", "confirmed"], // Archive restoration: determined by deposit state
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

  // CRITICAL: Finished bookings are immutable (cannot be changed)
  // This prevents accidental modifications to completed bookings
  if (fromStatus === "finished") {
    return {
      valid: false,
      reason: `Cannot modify finished bookings. Finished bookings are immutable and cannot be changed.`,
    }
  }

  // Check if transition is allowed by the transition matrix
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
 * CRITICAL: Uses Bangkok timezone for business logic consistency
 * Note: This function assumes date is in YYYY-MM-DD format (Bangkok timezone)
 * For proper timezone handling, use createBangkokTimestamp() and getBangkokTime()
 */
export function isDateInPast(date: string | null | undefined): boolean {
  if (!date) return false
  // Use createBangkokTimestamp to properly handle Bangkok timezone
  try {
    const dateTimestamp = createBangkokTimestamp(date, null)
    const now = getBangkokTime()
    return dateTimestamp < now
  } catch {
    // Fallback to old method if date format is not YYYY-MM-DD
    const dateTimestamp = Math.floor(new Date(date).getTime() / 1000)
    const now = getBangkokTime()
    return dateTimestamp < now
  }
}

/**
 * Validate if a date is in the future
 * CRITICAL: Uses Bangkok timezone for business logic consistency
 * Note: This function assumes date is in YYYY-MM-DD format (Bangkok timezone)
 * For proper timezone handling, use createBangkokTimestamp() and getBangkokTime()
 */
export function isDateInFuture(date: string | null | undefined): boolean {
  if (!date) return false
  // Use createBangkokTimestamp to properly handle Bangkok timezone
  try {
    const dateTimestamp = createBangkokTimestamp(date, null)
    const now = getBangkokTime()
    return dateTimestamp > now
  } catch {
    // Fallback to old method if date format is not YYYY-MM-DD
    const dateTimestamp = Math.floor(new Date(date).getTime() / 1000)
    const now = getBangkokTime()
    return dateTimestamp > now
  }
}

/**
 * Helper function to parse 24-hour time string (HH:MM format)
 * Returns hour24 (0-23) and minutes (0-59)
 */
function parseTimeString(timeString: string | null): { hour24: number; minutes: number } | null {
  if (!timeString) return null
  
  try {
    const trimmed = timeString.trim()
    
    // Parse 24-hour format (HH:MM)
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/)
    if (match) {
      const hour24 = parseInt(match[1], 10)
      const minutes = parseInt(match[2] || '00', 10)
      
      if (hour24 >= 0 && hour24 <= 23 && minutes >= 0 && minutes <= 59) {
        return { hour24, minutes }
      }
    }
  } catch (error) {
    console.warn(`Failed to parse time string:`, error)
  }
  
  return null
}

/**
 * Calculate start timestamp including time
 * CRITICAL: Must use Bangkok timezone to avoid timezone conversion issues
 */
export function calculateStartTimestamp(
  startDate: number,
  startTime: string | null
): number {
  let startTimestamp = startDate

  if (startTime) {
    const parsed = parseTimeString(startTime)
    if (parsed) {
      try {
        // Convert timestamp to Bangkok timezone date string, then recreate with time
        // This ensures we're working in Bangkok timezone, not server local timezone
        const utcDate = new Date(startTimestamp * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        
        // Get date components in Bangkok timezone
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
        
        // Create new TZDate with the time in Bangkok timezone
        const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
        startTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
      } catch (error) {
        console.warn(`Failed to apply start_time:`, error)
      }
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
  // CRITICAL: Use Bangkok time for business logic (check-in validation)
  const now = getBangkokTime()
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
 * Check if bookings overlap in time (within a transaction for locking)
 * This version performs the overlap check within a transaction to prevent race conditions.
 * Use this when you need to ensure no other bookings are confirmed between check and save.
 */
export async function checkBookingOverlapWithLock(
  bookingId: string | null, // null for new bookings
  startDate: number,
  endDate: number | null,
  startTime: string | null,
  endTime: string | null,
  tx: any // Transaction object
): Promise<{ overlaps: boolean; overlappingBookings?: any[] }> {
  // Calculate actual start and end timestamps (reuse existing logic)
  const startTimestamp = calculateStartTimestamp(startDate, startTime)
  
  let endTimestamp: number
  if (endDate) {
    // Multiple day booking
    if (endTime) {
      const parsed = parseTimeString(endTime)
      if (parsed) {
        try {
          const utcDate = new Date(endDate * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
        } catch (error) {
          endTimestamp = endDate
        }
      } else {
        endTimestamp = endDate
      }
    } else {
      try {
        const utcDate = new Date(endDate * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
        const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
        endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
      } catch (error) {
        endTimestamp = endDate
      }
    }
  } else {
    // Single day booking
    if (endTime) {
      const parsed = parseTimeString(endTime)
      if (parsed) {
        try {
          const utcDate = new Date(startDate * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
        } catch (error) {
          endTimestamp = startTimestamp
        }
      } else {
        endTimestamp = startTimestamp
      }
    } else {
      endTimestamp = startTimestamp
    }
  }

  // CRITICAL: Validate that end timestamp is after start timestamp
  // This prevents invalid bookings with end time before or equal to start time
  if (endTimestamp <= startTimestamp) {
    throw new Error(
      `Invalid booking time range: end time (${new Date(endTimestamp * 1000).toISOString()}) must be after start time (${new Date(startTimestamp * 1000).toISOString()})`
    )
  }

  const { getBangkokTime } = await import("./timezone")
  const bangkokNow = getBangkokTime()
  const isNewBookingInPast = endTimestamp < bangkokNow
  
  // Query within transaction - this ensures we see the latest state
  // Note: SQLite doesn't support SELECT FOR UPDATE, but transactions provide isolation
  const query = bookingId
    ? `
      SELECT id, name, email, reference_number, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE id != ?
        AND status = 'confirmed'
      ORDER BY start_date ASC
    `
    : `
      SELECT id, name, email, reference_number, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE status = 'confirmed'
      ORDER BY start_date ASC
    `

  const args = bookingId ? [bookingId] : []
  const result = await tx.execute({ sql: query, args })

  // Check each booking for actual time overlap (reuse existing logic)
  const overlappingBookings: any[] = []
  
  for (const booking of result.rows) {
    const existingBooking = booking as any
    
    const existingStartTimestamp = calculateStartTimestamp(
      existingBooking.start_date,
      existingBooking.start_time
    )
    
    let existingEndTimestamp: number
    if (existingBooking.end_date) {
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            const utcDate = new Date(existingBooking.end_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingBooking.end_date
          }
        } else {
          existingEndTimestamp = existingBooking.end_date
        }
      } else {
        try {
          const utcDate = new Date(existingBooking.end_date * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
          existingEndTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
        } catch (error) {
          existingEndTimestamp = existingBooking.end_date
        }
      }
    } else {
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            const utcDate = new Date(existingBooking.start_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingStartTimestamp
          }
        } else {
          existingEndTimestamp = existingStartTimestamp
        }
      } else {
        existingEndTimestamp = existingStartTimestamp
      }
    }
    
    if (!isNewBookingInPast && existingEndTimestamp < bangkokNow) {
      continue
    }
    
    const overlaps = startTimestamp <= existingEndTimestamp && endTimestamp >= existingStartTimestamp
    
    if (overlaps) {
      overlappingBookings.push(existingBooking)
    }
  }

  if (overlappingBookings.length > 0) {
    return {
      overlaps: true,
      overlappingBookings,
    }
  }

  return { overlaps: false }
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
        const parsed = parseTimeString(endTime)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(endDate * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            endTimestamp = endDate
          }
        } else {
          endTimestamp = endDate
        }
      } else {
        // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
        // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
        try {
          const utcDate = new Date(endDate * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          // Set to end of day (23:59:59)
          const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
        } catch (error) {
          endTimestamp = endDate
        }
      }
    } else {
      // Single day booking - use start date with end time or start time
      if (endTime) {
        const parsed = parseTimeString(endTime)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(startDate * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            endTimestamp = startTimestamp
          }
        } else {
          endTimestamp = startTimestamp
        }
      } else {
        endTimestamp = startTimestamp
      }
    }

  // CRITICAL: Validate that end timestamp is after start timestamp
  // This prevents invalid bookings with end time before or equal to start time
  if (endTimestamp <= startTimestamp) {
    throw new Error(
      `Invalid booking time range: end time (${new Date(endTimestamp * 1000).toISOString()}) must be after start time (${new Date(startTimestamp * 1000).toISOString()})`
    )
  }

  // Find overlapping bookings that occupy time on the calendar:
  // Only confirmed bookings block the calendar (they have verified deposits and confirmed dates)
  // Optimized: Uses idx_bookings_status_start_date composite index for status filtering
  const { getBangkokTime } = await import("./timezone")
  const bangkokNow = getBangkokTime()
  
  // Determine if we should filter past bookings:
  // - If the NEW booking is in the FUTURE: only check against future/current bookings (past bookings don't block)
  // - If the NEW booking is in the PAST (historical correction): check ALL bookings including past ones (maintain data integrity)
  // This ensures:
  //   1. Future bookings are only blocked by future/current bookings (correct behavior)
  //   2. Historical corrections maintain data integrity (no overlapping past bookings allowed)
  const isNewBookingInPast = endTimestamp < bangkokNow
  
  const query = bookingId
    ? `
      SELECT id, name, email, reference_number, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE id != ?
        AND status = 'confirmed'
      ORDER BY start_date ASC
    `
    : `
      SELECT id, name, email, reference_number, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE status = 'confirmed'
      ORDER BY start_date ASC
    `

  const args = bookingId ? [bookingId] : []

  const result = await db.execute({ sql: query, args })

  // Check each booking for actual time overlap
  // Filter out past bookings (bookings that have already ended)
  const overlappingBookings: any[] = []
  
  for (const booking of result.rows) {
    const existingBooking = booking as any
    
    // Calculate existing booking's start and end timestamps
    const existingStartTimestamp = calculateStartTimestamp(
      existingBooking.start_date,
      existingBooking.start_time
    )
    
    let existingEndTimestamp: number
    if (existingBooking.end_date) {
      // Multiple day booking
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(existingBooking.end_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingBooking.end_date
          }
        } else {
          existingEndTimestamp = existingBooking.end_date
        }
      } else {
        // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
        // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
        try {
          const utcDate = new Date(existingBooking.end_date * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          // Set to end of day (23:59:59)
          const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
          existingEndTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
        } catch (error) {
          existingEndTimestamp = existingBooking.end_date
        }
      }
    } else {
      // Single day booking
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(existingBooking.start_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingStartTimestamp
          }
        } else {
          existingEndTimestamp = existingStartTimestamp
        }
      } else {
        existingEndTimestamp = existingStartTimestamp
      }
    }
    
    // Filter past bookings based on whether the NEW booking is in the past or future:
    // - If NEW booking is in FUTURE: skip past bookings (they don't block future bookings)
    // - If NEW booking is in PAST: check ALL bookings including past ones (maintain data integrity for historical corrections)
    if (!isNewBookingInPast && existingEndTimestamp < bangkokNow) {
      continue // Skip this past booking - it doesn't block future bookings
    }
    // If isNewBookingInPast is true, we check ALL bookings (including past ones) to maintain data integrity
    
    // Check for time overlap: two time ranges overlap if:
    // newStart <= existingEnd AND newEnd >= existingStart
    // This includes boundary touches (e.g., 21-25 overlaps with 25-26)
    const overlaps = startTimestamp <= existingEndTimestamp && endTimestamp >= existingStartTimestamp
    
    // Debug logging for overlap detection
    if (overlaps || (endDate && existingBooking.end_date)) {
      console.log('[Overlap Debug]', {
        newBooking: {
          startDate: new Date(startTimestamp * 1000).toISOString(),
          endDate: new Date(endTimestamp * 1000).toISOString(),
          startTimestamp,
          endTimestamp,
          hasEndDate: !!endDate,
          hasEndTime: !!endTime,
        },
        existingBooking: {
          id: existingBooking.id,
          reference: existingBooking.reference_number,
          startDate: new Date(existingStartTimestamp * 1000).toISOString(),
          endDate: new Date(existingEndTimestamp * 1000).toISOString(),
          startTimestamp: existingStartTimestamp,
          endTimestamp: existingEndTimestamp,
          hasEndDate: !!existingBooking.end_date,
          hasEndTime: !!existingBooking.end_time,
        },
        overlapCheck: {
          condition1: `${startTimestamp} <= ${existingEndTimestamp}`,
          condition1Result: startTimestamp <= existingEndTimestamp,
          condition2: `${endTimestamp} >= ${existingStartTimestamp}`,
          condition2Result: endTimestamp >= existingStartTimestamp,
          overlaps,
        }
      })
    }
    
    if (overlaps) {
      overlappingBookings.push(existingBooking)
    }
  }

  if (overlappingBookings.length > 0) {
    return {
      overlaps: true,
      overlappingBookings,
    }
  }

  return { overlaps: false }
}

/**
 * Find ALL overlapping bookings for a given booking (not just confirmed)
 * Used for showing overlap warnings and overlap filter
 */
export async function findAllOverlappingBookings(
  bookingId: string,
  startDate: number,
  endDate: number | null,
  startTime: string | null,
  endTime: string | null
): Promise<Array<{
  id: string
  name: string
  email: string
  reference_number: string | null
  start_date: number
  end_date: number | null
  start_time: string | null
  end_time: string | null
  status: string
  created_at: number
}>> {
  const db = getTursoClient()
  
  // Calculate actual start and end timestamps
  const startTimestamp = calculateStartTimestamp(startDate, startTime)
  
  let endTimestamp: number
  if (endDate) {
    // Multiple day booking
    if (endTime) {
      const parsed = parseTimeString(endTime)
      if (parsed) {
        try {
          const utcDate = new Date(endDate * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
        } catch (error) {
          endTimestamp = endDate
        }
      } else {
        endTimestamp = endDate
      }
    } else {
      // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
      // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
      try {
        const utcDate = new Date(endDate * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
        // Set to end of day (23:59:59)
        const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
        endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
      } catch (error) {
        endTimestamp = endDate
      }
    }
  } else {
      // Single day booking
      if (endTime) {
      const parsed = parseTimeString(endTime)
      if (parsed) {
        try {
          const utcDate = new Date(startDate * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
        } catch (error) {
          endTimestamp = startTimestamp
        }
      } else {
        endTimestamp = startTimestamp
      }
    } else {
      endTimestamp = startTimestamp
    }
  }

  // Get all bookings (except cancelled and finished) that might overlap
  // We check all active statuses to show full overlap context
  const query = `
    SELECT id, name, email, reference_number, start_date, end_date, start_time, end_time, status, created_at
    FROM bookings
    WHERE id != ?
      AND status NOT IN ('cancelled', 'finished')
    ORDER BY created_at DESC
  `

  const result = await db.execute({ sql: query, args: [bookingId] })

  const overlappingBookings: Array<{
    id: string
    name: string
    email: string
    reference_number: string | null
    start_date: number
    end_date: number | null
    start_time: string | null
    end_time: string | null
    status: string
    created_at: number
  }> = []
  
  for (const booking of result.rows) {
    const existingBooking = booking as any
    
    // Calculate existing booking's start and end timestamps
    const existingStartTimestamp = calculateStartTimestamp(
      existingBooking.start_date,
      existingBooking.start_time
    )
    
    let existingEndTimestamp: number
    if (existingBooking.end_date) {
      // Multiple day booking
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            const utcDate = new Date(existingBooking.end_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingBooking.end_date
          }
        } else {
          existingEndTimestamp = existingBooking.end_date
        }
      } else {
        // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
        // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
        try {
          const utcDate = new Date(existingBooking.end_date * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          // Set to end of day (23:59:59)
          const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
          existingEndTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
        } catch (error) {
          existingEndTimestamp = existingBooking.end_date
        }
      }
    } else {
      // Single day booking
      if (existingBooking.end_time) {
        const parsed = parseTimeString(existingBooking.end_time)
        if (parsed) {
          try {
            const utcDate = new Date(existingBooking.start_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            existingEndTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            existingEndTimestamp = existingStartTimestamp
          }
        } else {
          existingEndTimestamp = existingStartTimestamp
        }
      } else {
        existingEndTimestamp = existingStartTimestamp
      }
    }
    
    // Check for time overlap: two time ranges overlap if:
    // newStart <= existingEnd AND newEnd >= existingStart
    // This includes boundary touches (e.g., 21-25 overlaps with 25-26)
    if (startTimestamp <= existingEndTimestamp && endTimestamp >= existingStartTimestamp) {
      overlappingBookings.push({
        id: existingBooking.id,
        name: existingBooking.name,
        email: existingBooking.email,
        reference_number: existingBooking.reference_number,
        start_date: existingBooking.start_date,
        end_date: existingBooking.end_date,
        start_time: existingBooking.start_time,
        end_time: existingBooking.end_time,
        status: existingBooking.status,
        created_at: existingBooking.created_at,
      })
    }
  }

  return overlappingBookings
}

/**
 * Get unavailable dates and time ranges for calendar
 * Returns dates that have confirmed bookings
 * 
 * @param excludeBookingId - Optional booking ID to exclude from unavailable dates
 */
export async function getUnavailableDates(excludeBookingId?: string | null): Promise<{
  unavailableDates: string[] // ISO date strings (YYYY-MM-DD)
  unavailableTimeRanges: Array<{
    date: string // ISO date string (YYYY-MM-DD)
    startTime: string | null
    endTime: string | null
    startDate: number // Unix timestamp for full start
    endDate: number // Unix timestamp for full end
  }>
}> {
  const db = getTursoClient()
  const { getBangkokTime } = await import("./timezone")
  const bangkokNow = getBangkokTime()
  
  // Get all confirmed bookings that occupy time on the calendar
  // Only future/current bookings block the calendar (past bookings are already finished)
  // Optimized: Uses idx_bookings_status_start_date composite index for status filtering and ordering
  const query = excludeBookingId
    ? `
      SELECT start_date, end_date, start_time, end_time, status, id
      FROM bookings
      WHERE status = 'confirmed' AND id != ?
      ORDER BY start_date ASC
    `
    : `
      SELECT start_date, end_date, start_time, end_time, status, id
      FROM bookings
      WHERE status = 'confirmed'
      ORDER BY start_date ASC
    `
  
  const args = excludeBookingId ? [excludeBookingId] : []
  const result = await db.execute({ sql: query, args })
  
  console.log(`[getUnavailableDates] Query executed, found ${result.rows.length} confirmed bookings blocking calendar`)

  const unavailableDates = new Set<string>()
  const unavailableTimeRanges: Array<{
    date: string
    startTime: string | null
    endTime: string | null
    startDate: number
    endDate: number
  }> = []

  for (const row of result.rows) {
    const booking = row as any
    const startTimestamp = calculateStartTimestamp(booking.start_date, booking.start_time)
    
    let endTimestamp: number
    if (booking.end_date) {
      // Multiple day booking
      if (booking.end_time) {
        const parsed = parseTimeString(booking.end_time)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(booking.end_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            endTimestamp = booking.end_date
          }
        } else {
          endTimestamp = booking.end_date
        }
      } else {
        // No endTime: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
        // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
        try {
          const utcDate = new Date(booking.end_date * 1000)
          const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
          const year = tzDate.getFullYear()
          const month = tzDate.getMonth()
          const day = tzDate.getDate()
          // Set to end of day (23:59:59)
          const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
          endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
        } catch (error) {
          endTimestamp = booking.end_date
        }
      }
    } else {
      if (booking.end_time) {
        const parsed = parseTimeString(booking.end_time)
        if (parsed) {
          try {
            // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
            const utcDate = new Date(booking.start_date * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            endTimestamp = startTimestamp
          }
        } else {
          endTimestamp = startTimestamp
        }
      } else {
        endTimestamp = startTimestamp
      }
    }
    
    // Skip past bookings - only future/current bookings should block the calendar
    // Past bookings are already finished and shouldn't prevent new bookings
    if (endTimestamp < bangkokNow) {
      continue // Skip this booking - it's in the past
    }

    // Add all dates in the range to unavailable dates
    // Convert timestamps to Bangkok timezone dates
    const startDateBangkok = new TZDate(startTimestamp * 1000, BANGKOK_TIMEZONE)
    const endDateBangkok = new TZDate(endTimestamp * 1000, BANGKOK_TIMEZONE)
    
    // Get date components in Bangkok timezone
    const startYear = startDateBangkok.getFullYear()
    const startMonth = startDateBangkok.getMonth()
    const startDay = startDateBangkok.getDate()
    
    const endYear = endDateBangkok.getFullYear()
    const endMonth = endDateBangkok.getMonth()
    const endDay = endDateBangkok.getDate()
    
    // Create date objects for iteration (in Bangkok timezone)
    let currentYear = startYear
    let currentMonth = startMonth
    let currentDay = startDay
    
    // Iterate through all dates in the range (inclusive)
    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth < endMonth) ||
      (currentYear === endYear && currentMonth === endMonth && currentDay <= endDay)
    ) {
      // Create TZDate for current date in Bangkok timezone
      const tzDate = new TZDate(currentYear, currentMonth, currentDay, 0, 0, 0, BANGKOK_TIMEZONE)
      const dateStr = format(tzDate, 'yyyy-MM-dd')
      unavailableDates.add(dateStr)
      
      // Move to next day
      currentDay++
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
      if (currentDay > daysInMonth) {
        currentDay = 1
        currentMonth++
        if (currentMonth > 11) {
          currentMonth = 0
          currentYear++
        }
      }
    }

    // Add time range info with Bangkok timezone date
    unavailableTimeRanges.push({
      date: timestampToBangkokDateString(startTimestamp),
      startTime: booking.start_time,
      endTime: booking.end_time,
      startDate: startTimestamp,
      endDate: endTimestamp,
    })
  }

  const sortedDates = Array.from(unavailableDates).sort()
  
  // Debug: Log final unavailable dates
  if (sortedDates.length > 0) {
    console.log(`[getUnavailableDates] Final unavailable dates (${sortedDates.length}):`, sortedDates.slice(0, 10), sortedDates.length > 10 ? '...' : '')
  } else {
    console.log('[getUnavailableDates] No unavailable dates found')
  }
  
  return {
    unavailableDates: sortedDates,
    unavailableTimeRanges,
  }
}

/**
 * Validate proposed dates for postponed bookings
 * Allows any future date (except today and occupied dates) regardless of original start date
 */
export async function validateProposedDates(
  proposedDate: string | null | undefined,
  proposedEndDate: string | null | undefined,
  originalStartDate?: number // Optional - no longer used for validation, kept for backward compatibility
): Promise<{ valid: boolean; reason?: string }> {
  if (!proposedDate) {
    return { valid: true } // Admin doesn't propose dates
  }

  // Use GMT+7 timezone for validation
  // Import dynamically to avoid circular dependencies
  const timezoneModule = await import("./timezone")
  const proposedTimestamp = timezoneModule.createBangkokTimestamp(proposedDate, null)
  const now = timezoneModule.getBangkokTime()
  const todayDateStr = timezoneModule.getBangkokDateString()

  // Proposed date cannot be today (users cannot propose current date)
  if (proposedDate === todayDateStr) {
    return {
      valid: false,
      reason: "Proposed date cannot be today. Please select a future date.",
    }
  }

  // Proposed date must be in the future
  if (proposedTimestamp <= now) {
    return {
      valid: false,
      reason: "Proposed date must be in the future.",
    }
  }

  // Note: Removed check requiring proposed date to be after original start date
  // Users can now propose any future date (overlap checking is handled separately)

  // If multiple days, validate end date
  if (proposedEndDate) {
    const proposedEndTimestamp = timezoneModule.createBangkokTimestamp(proposedEndDate, null)
    
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

/**
 * Validate fee data
 * Fee can only be recorded/updated when status is "confirmed" or "finished"
 */
export function validateFee(
  feeAmountOriginal: number | null | undefined,
  feeCurrency: string | null | undefined,
  feeConversionRate: number | null | undefined,
  feeAmount: number | null | undefined,
  status: string
): { valid: boolean; reason?: string } {
  // Fee can only be set for confirmed or finished bookings
  if (feeAmountOriginal !== null && feeAmountOriginal !== undefined) {
    if (status !== "confirmed" && status !== "finished") {
      return {
        valid: false,
        reason: "Fee can only be recorded for confirmed or finished bookings"
      }
    }
    
    // Validate amounts are non-negative
    if (feeAmountOriginal < 0) {
      return {
        valid: false,
        reason: "Original fee amount cannot be negative"
      }
    }
    
    if (feeAmount !== null && feeAmount !== undefined && feeAmount < 0) {
      return {
        valid: false,
        reason: "Base fee amount (THB) cannot be negative"
      }
    }
    
    // If currency is provided and not THB, validate conversion
    if (feeCurrency && feeCurrency.toUpperCase() !== "THB") {
      // If both amounts and rate are provided, validate they match
      if (feeAmount !== null && feeAmount !== undefined && 
          feeConversionRate !== null && feeConversionRate !== undefined) {
        const calculatedAmount = feeAmountOriginal * feeConversionRate
        const difference = Math.abs(calculatedAmount - feeAmount)
        // Allow small rounding differences (0.01)
        if (difference > 0.01) {
          return {
            valid: false,
            reason: `Fee amounts don't match: ${feeAmountOriginal} × ${feeConversionRate} = ${calculatedAmount.toFixed(2)}, but base amount is ${feeAmount}`
          }
        }
      }
      
      // Validate conversion rate is reasonable (between 0.01 and 10000)
      if (feeConversionRate !== null && feeConversionRate !== undefined) {
        if (feeConversionRate < 0.01 || feeConversionRate > 10000) {
          return {
            valid: false,
            reason: "Conversion rate must be between 0.01 and 10000"
          }
        }
      }
      
      // If currency is not THB, either rate or base amount must be provided
      if (feeConversionRate === null && feeAmount === null) {
        return {
          valid: false,
          reason: "Either conversion rate or base amount (THB) must be provided for non-THB currency"
        }
      }
    }
  }
  
  return { valid: true }
}

