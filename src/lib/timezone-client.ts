/**
 * Client-Side Timezone Utilities for GMT+7 (Bangkok, Thailand)
 * 
 * These utilities work in the browser to match backend timezone handling.
 * All date operations use GMT+7 timezone for consistency.
 * 
 * Uses native date-fns v4 timezone support via @date-fns/tz.
 */

import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

const BANGKOK_TIMEZONE = 'Asia/Bangkok' // GMT+7

/**
 * Helper: Convert a Date to UTC timestamp, treating it as if it were in Bangkok timezone
 * Equivalent to fromZonedTime from date-fns-tz
 */
function fromZonedTime(date: Date, timeZone: string): Date {
  // Create a TZDate in the specified timezone with the same local time components
  const tzDate = new TZDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    timeZone
  )
  // Return as regular Date (UTC)
  return new Date(tzDate.getTime())
}

/**
 * Helper: Convert a UTC Date to a Date representing the same moment in Bangkok timezone
 * Equivalent to toZonedTime from date-fns-tz
 */
function toZonedTime(date: Date, timeZone: string): Date {
  // Create TZDate from UTC timestamp in the specified timezone
  const tzDate = new TZDate(date.getTime(), timeZone)
  // Return a regular Date with the local time components from the timezone
  return new Date(
    tzDate.getFullYear(),
    tzDate.getMonth(),
    tzDate.getDate(),
    tzDate.getHours(),
    tzDate.getMinutes(),
    tzDate.getSeconds()
  )
}

/**
 * Get current time in Bangkok timezone as Unix timestamp (seconds)
 * 
 * Returns the current time in Bangkok timezone (GMT+7) as a Unix timestamp.
 * Uses native date-fns v4 timezone support to properly handle timezone conversion regardless of browser timezone.
 * 
 * @returns Unix timestamp in seconds (UTC, representing current Bangkok time)
 */
export function getBangkokTime(): number {
  // Unix timestamps are always UTC and represent a specific moment in time.
  // When we create timestamps from Bangkok dates using createBangkokTimestamp(),
  // we convert Bangkok time to UTC. So for comparisons, we just need the current UTC time.
  // 
  // However, to ensure we're getting the "current moment" correctly regardless of browser timezone,
  // we use Date.now() which always returns UTC milliseconds.
  // 
  // The key is that createBangkokTimestamp() properly converts Bangkok timezone to UTC,
  // so all our timestamps are in UTC and can be compared directly.
  return Math.floor(Date.now() / 1000)
}

/**
 * Convert a date string (YYYY-MM-DD) and optional time (HH:MM) to Unix timestamp
 * Assumes the date/time is in GMT+7 (Bangkok) timezone
 * 
 * Uses native date-fns v4 timezone support to properly convert Bangkok timezone to UTC timestamp,
 * ensuring correct conversion regardless of browser timezone.
 * 
 * @param dateString - Date string in YYYY-MM-DD format (Bangkok timezone)
 * @param timeString - Optional time string in HH:MM format (24-hour, Bangkok timezone)
 * @returns Unix timestamp in seconds (UTC, representing the Bangkok time)
 */
export function createBangkokTimestamp(
  dateString: string,
  timeString?: string | null
): number {
  const [year, month, day] = dateString.split('-').map(Number)

  let hours = 0
  let minutes = 0

  if (timeString) {
    const [h, m] = timeString.split(':').map(Number)
    hours = h || 0
    minutes = m || 0
  }

  // Create a TZDate directly in Bangkok timezone with the specified components
  // This ensures correct conversion regardless of browser timezone
  // TZDate constructor: (year, month, day, hour, minute, second, timezone)
  // Note: month is 0-indexed in JavaScript Date, but TZDate uses 1-indexed months
  const tzDate = new TZDate(year, month - 1, day, hours, minutes, 0, BANGKOK_TIMEZONE)
  
  // Convert to UTC Date object
  const utcDate = new Date(tzDate.getTime())
  
  return Math.floor(utcDate.getTime() / 1000)
}

/**
 * Check if a timestamp is in the past (using GMT+7 current time)
 */
export function isPastInBangkok(timestamp: number): boolean {
  const now = getBangkokTime()
  return timestamp < now
}

/**
 * Check if a timestamp is in the future (using GMT+7 current time)
 */
export function isFutureInBangkok(timestamp: number): boolean {
  const now = getBangkokTime()
  return timestamp > now
}

/**
 * Format timestamp to Bangkok timezone date/time string for display
 * 
 * @param timestamp - Unix timestamp in seconds (UTC)
 * @returns Formatted date/time string in Bangkok timezone (YYYY-MM-DD HH:MM GMT+7)
 */
export function formatBangkokDateTime(timestamp: number): string {
  // Convert UTC timestamp to Date object
  const utcDate = new Date(timestamp * 1000)
  
  // Convert to Bangkok timezone
  const bangkokDate = toZonedTime(utcDate, BANGKOK_TIMEZONE)
  
  // Format using date-fns
  const dateStr = format(bangkokDate, 'yyyy-MM-dd HH:mm')
  
  return `${dateStr} GMT+7`
}

/**
 * Get current date string in Bangkok timezone (YYYY-MM-DD)
 * 
 * @returns Current date in Bangkok timezone as YYYY-MM-DD string
 */
export function getBangkokDateString(): string {
  // Get current UTC time
  const utcNow = new Date()
  
  // Convert to Bangkok timezone
  const bangkokDate = toZonedTime(utcNow, BANGKOK_TIMEZONE)
  
  // Format as YYYY-MM-DD
  return format(bangkokDate, 'yyyy-MM-dd')
}

/**
 * Convert a Date object to Bangkok timezone date string (YYYY-MM-DD)
 * Useful for comparing calendar dates with unavailable dates from the API
 * 
 * @param date - Date object (can be in any timezone)
 * @returns Date string in Bangkok timezone as YYYY-MM-DD
 */
export function dateToBangkokDateString(date: Date): string {
  // Convert to Bangkok timezone
  const bangkokDate = toZonedTime(date, BANGKOK_TIMEZONE)
  
  // Format as YYYY-MM-DD
  return format(bangkokDate, 'yyyy-MM-dd')
}

/**
 * Check if a date is today in Bangkok timezone
 * 
 * @param date - Date object to check
 * @returns true if the date is today in Bangkok timezone
 */
export function isTodayInBangkok(date: Date): boolean {
  const todayStr = getBangkokDateString()
  const dateStr = dateToBangkokDateString(date)
  return todayStr === dateStr
}

/**
 * Validate proposed date using GMT+7 timezone (frontend validation)
 * Matches backend validation logic
 * Allows any future date (except today) regardless of original start date
 */
export function validateProposedDateFrontend(
  proposedDate: string,
  proposedEndDate?: string | null,
  originalStartDate?: number // Optional - no longer used for validation, kept for backward compatibility
): { valid: boolean; reason?: string } {
  if (!proposedDate) {
    return { valid: false, reason: 'Proposed date is required' }
  }

  const proposedTimestamp = createBangkokTimestamp(proposedDate, null)
  const now = getBangkokTime()
  const todayStr = getBangkokDateString()

  // Proposed date cannot be today
  if (proposedDate === todayStr) {
    return {
      valid: false,
      reason: 'Proposed date cannot be today. Please select a future date.',
    }
  }

  // Proposed date must be in the future (not today or past)
  if (proposedTimestamp <= now) {
    return {
      valid: false,
      reason: 'Proposed date must be in the future (GMT+7 Bangkok time)',
    }
  }

  // Note: Removed check requiring proposed date to be after original start date
  // Users can now propose any future date (overlap checking is handled separately)

  // If multiple days, validate end date
  if (proposedEndDate) {
    const proposedEndTimestamp = createBangkokTimestamp(proposedEndDate, null)
    
    if (proposedEndTimestamp <= now) {
      return {
        valid: false,
        reason: 'Proposed end date must be in the future (GMT+7 Bangkok time)',
      }
    }

    if (proposedEndTimestamp < proposedTimestamp) {
      return {
        valid: false,
        reason: 'Proposed end date must be after proposed start date',
      }
    }
  }

  return { valid: true }
}

