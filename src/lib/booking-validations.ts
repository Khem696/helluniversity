/**
 * Booking Validation Utilities
 * 
 * Contains validation functions for booking status transitions, dates, and overlaps
 */

import { getTursoClient } from "./turso"
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

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
  pending: ["accepted", "rejected", "postponed", "cancelled"],
  accepted: ["paid_deposit", "postponed", "cancelled", "finished"],
  paid_deposit: ["checked-in", "postponed", "cancelled", "pending_deposit"], // pending_deposit if deposit rejected
  pending_deposit: ["paid_deposit", "postponed", "cancelled"], // User can re-upload deposit
  rejected: ["pending", "accepted", "cancelled"], // Allow re-opening rejected bookings or cancelling
  postponed: ["accepted", "rejected", "cancelled", "pending"], // User can propose, admin accepts
  cancelled: ["pending", "accepted"], // Allow re-opening cancelled bookings
  "checked-in": ["finished", "postponed", "cancelled"], // User can propose new date (postponed)
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
        endTimestamp = endDate
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

  // Find overlapping bookings that occupy time on the calendar:
  // 1. Currently checked-in bookings (status = 'checked-in')
  // 2. Postponed bookings that were previously checked-in (status = 'postponed' AND deposit_verified_at IS NOT NULL)
  //    - These keep their ORIGINAL dates (start_date, end_date) blocking the calendar until admin accepts the proposed date
  //    - The proposed dates do NOT block the calendar (they're just proposals)
  const query = bookingId
    ? `
      SELECT id, name, email, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE id != ?
        AND (
          status = 'checked-in'
          OR (status = 'postponed' AND deposit_verified_at IS NOT NULL)
        )
    `
    : `
      SELECT id, name, email, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE (
        status = 'checked-in'
        OR (status = 'postponed' AND deposit_verified_at IS NOT NULL)
      )
    `

  const args = bookingId ? [bookingId] : []

  const result = await db.execute({ sql: query, args })

  // Check each booking for actual time overlap
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
        existingEndTimestamp = existingBooking.end_date
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
    
    // Check for time overlap: two time ranges overlap if:
    // newStart < existingEnd AND newEnd > existingStart
    if (startTimestamp < existingEndTimestamp && endTimestamp > existingStartTimestamp) {
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
 * Get unavailable dates and time ranges for calendar
 * Returns dates that have checked-in bookings
 * 
 * @param excludeBookingId - Optional booking ID to exclude from unavailable dates
 *                          (allows users to select their own original dates when proposing)
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
  
  // Get all bookings that occupy time on the calendar:
  // 1. Currently checked-in bookings (status = 'checked-in')
  // 2. Postponed bookings that were previously checked-in (status = 'postponed' AND deposit_verified_at IS NOT NULL)
  //    - These use their ORIGINAL dates (start_date, end_date), not proposed dates
  //    - The original dates remain blocked until admin accepts the proposed date
  // First, let's check all bookings to see what statuses exist
  const allBookingsCheck = await db.execute({
    sql: `
      SELECT id, status, start_date, end_date, deposit_verified_at
      FROM bookings
      WHERE start_date >= ? OR end_date >= ?
      ORDER BY start_date DESC
      LIMIT 10
    `,
    args: [Math.floor(Date.now() / 1000) - 86400 * 365, Math.floor(Date.now() / 1000) - 86400 * 365], // Last year
  })
  
  console.log(`[getUnavailableDates] Recent bookings check:`, allBookingsCheck.rows.map((row: any) => ({
    id: row.id,
    status: row.status,
    start_date: row.start_date,
    deposit_verified_at: row.deposit_verified_at
  })))
  
  // Query for checked-in bookings - try multiple variations
  // SQLite/Turso might store status differently, so we check multiple formats
  // CRITICAL: Must select deposit_verified_at to check if postponed bookings were previously checked-in
  const result = await db.execute({
    sql: `
      SELECT start_date, end_date, start_time, end_time, status, id, deposit_verified_at
      FROM bookings
      WHERE (
        status = 'checked-in'
        OR status = 'Checked In'
        OR status LIKE '%checked%'
        OR (status = 'postponed' AND deposit_verified_at IS NOT NULL)
      )
      ORDER BY start_date ASC
    `,
    args: [],
  })
  
  console.log(`[getUnavailableDates] Query found ${result.rows.length} bookings with status variations`)
  
  // Filter in JavaScript to ensure we get the right statuses
  const filteredRows = result.rows.filter((row: any) => {
    const status = String(row.status || '').toLowerCase().trim()
    const isCheckedIn = status === 'checked-in' || status === 'checked in'
    const isPostponedWithDeposit = status === 'postponed' && row.deposit_verified_at
    const shouldInclude = isCheckedIn || isPostponedWithDeposit
    
    // Debug logging for postponed bookings
    if (status === 'postponed') {
      console.log(`[getUnavailableDates] Postponed booking check:`, {
        id: row.id,
        status: row.status,
        deposit_verified_at: row.deposit_verified_at,
        start_date: row.start_date,
        end_date: row.end_date,
        shouldInclude,
        reason: isPostponedWithDeposit ? 'Has deposit_verified_at' : 'Missing deposit_verified_at'
      })
    }
    
    return shouldInclude
  })
  
  console.log(`[getUnavailableDates] After filtering: ${filteredRows.length} bookings`)
  
  // Filter out the current booking if excludeBookingId is provided
  // This allows users to select their own original dates when proposing a new date
  const rowsToProcess = excludeBookingId
    ? filteredRows.filter((row: any) => row.id !== excludeBookingId)
    : filteredRows
  
  if (excludeBookingId && filteredRows.length !== rowsToProcess.length) {
    console.log(`[getUnavailableDates] Excluding booking ${excludeBookingId} from unavailable dates (user can select their own original dates)`)
  }
  
  // Log details of postponed bookings with deposit_verified_at
  const postponedBookings = rowsToProcess.filter((row: any) => String(row.status || '').toLowerCase().trim() === 'postponed')
  if (postponedBookings.length > 0) {
    console.log(`[getUnavailableDates] Found ${postponedBookings.length} postponed bookings with deposit_verified_at (original dates should be blocked):`)
    postponedBookings.forEach((row: any, idx: number) => {
      // CRITICAL: Format timestamps in Bangkok timezone for debug logging
    const startDateStr = row.start_date 
      ? timestampToBangkokDateString(row.start_date) + ' GMT+7'
      : 'null'
    const endDateStr = row.end_date 
      ? timestampToBangkokDateString(row.end_date) + ' GMT+7'
      : 'null'
    
    console.log(`[getUnavailableDates] Postponed booking ${idx + 1}:`, {
        id: row.id,
        start_date: row.start_date,
        end_date: row.end_date,
        start_date_str: startDateStr,
        end_date_str: endDateStr,
        deposit_verified_at: row.deposit_verified_at
      })
    })
  }
  
  // Create a result-like object with filtered rows
  const finalResult = {
    rows: rowsToProcess
  }
  
  // Debug: Log found bookings
  console.log(`[getUnavailableDates] Query executed, found ${finalResult.rows.length} bookings`)
  if (finalResult.rows.length > 0) {
    console.log(`[getUnavailableDates] Found ${finalResult.rows.length} bookings blocking calendar`)
    // CRITICAL: Format timestamps in Bangkok timezone for debug logging
    finalResult.rows.forEach((row: any, idx: number) => {
      const startDateStr = row.start_date 
        ? timestampToBangkokDateString(row.start_date) + ' GMT+7'
        : 'null'
      const endDateStr = row.end_date 
        ? timestampToBangkokDateString(row.end_date) + ' GMT+7'
        : 'null'
      console.log(`[getUnavailableDates] Booking ${idx + 1}: id=${row.id}, status="${row.status}", start_date=${row.start_date} (${startDateStr}), end_date=${row.end_date || 'null'}${row.end_date ? ` (${endDateStr})` : ''}`)
    })
  } else {
    console.log(`[getUnavailableDates] No checked-in bookings found. Query: status='checked-in' OR (status='postponed' AND deposit_verified_at IS NOT NULL)`)
  }

  const unavailableDates = new Set<string>()
  const unavailableTimeRanges: Array<{
    date: string
    startTime: string | null
    endTime: string | null
    startDate: number
    endDate: number
  }> = []

  for (const row of finalResult.rows) {
    const booking = row as any
    const startTimestamp = calculateStartTimestamp(booking.start_date, booking.start_time)
    
    let endTimestamp: number
    if (booking.end_date) {
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
        endTimestamp = booking.end_date
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



