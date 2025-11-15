/**
 * Timezone Utilities for GMT+7 (Bangkok, Thailand)
 * 
 * All date/time operations should use GMT+7 timezone for consistency
 * since bookings are for a location in Chiang Mai, Thailand.
 * 
 * IMPORTANT: This web app operates exclusively in GMT+7 (Bangkok time).
 * All date comparisons and validations use GMT+7.
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
 * Uses native date-fns v4 timezone support to properly handle timezone conversion regardless of server timezone.
 * 
 * @returns Unix timestamp in seconds (UTC, representing current Bangkok time)
 */
export function getBangkokTime(): number {
  // Unix timestamps are always UTC and represent a specific moment in time.
  // When we create timestamps from Bangkok dates using createBangkokTimestamp(),
  // we convert Bangkok time to UTC. So for comparisons, we just need the current UTC time.
  // 
  // However, to ensure we're getting the "current moment" correctly regardless of server timezone,
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
 * ensuring correct conversion regardless of server timezone.
 * 
 * @param dateString - Date string in YYYY-MM-DD format (Bangkok timezone)
 * @param timeString - Optional time string in HH:MM format (24-hour, Bangkok timezone)
 * @returns Unix timestamp in seconds (UTC, representing the Bangkok time)
 */
export function createBangkokTimestamp(
  dateString: string,
  timeString?: string | null
): number {
  // Extract date part if ISO string is provided (e.g., "2025-11-21T00:00:00.000Z" -> "2025-11-21")
  const dateOnly = dateString.includes('T') ? dateString.split('T')[0] : dateString
  const [year, month, day] = dateOnly.split('-').map(Number)
  
  // Validate parsed values
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date string: ${dateString}. Expected YYYY-MM-DD format.`)
  }
  
  // Validate month and day ranges
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`)
  }
  if (day < 1 || day > 31) {
    throw new Error(`Invalid day: ${day}. Day must be between 1 and 31.`)
  }
  
  let hours = 0
  let minutes = 0
  
  if (timeString) {
    const [h, m] = timeString.split(':').map(Number)
    hours = Number.isFinite(h) ? h : 0
    minutes = Number.isFinite(m) ? m : 0
  }
  
  // CRITICAL: Validate that the date actually exists in the calendar
  // TZDate will wrap invalid dates (e.g., Feb 30 becomes March 2), so we need to verify
  // Create a test TZDate with just the date (no time) to check validity
  let testTzDate: TZDate
  try {
    testTzDate = new TZDate(year, month - 1, day, 0, 0, 0, BANGKOK_TIMEZONE)
    // Verify the date components match (catches invalid dates like Feb 30, April 31, etc.)
    if (testTzDate.getFullYear() !== year || 
        testTzDate.getMonth() !== month - 1 || 
        testTzDate.getDate() !== day) {
      throw new Error(`Invalid date: ${dateString}. Date does not exist in calendar (e.g., February 30, April 31, etc.).`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid date')) {
      throw error
    }
    throw new Error(`Invalid date: ${dateString}. Date does not exist in calendar.`)
  }
  
  // Create a TZDate directly in Bangkok timezone with the specified components
  // This ensures correct conversion regardless of server timezone
  // TZDate constructor: (year, month, day, hour, minute, second, timezone)
  // Note: month is 0-indexed in JavaScript Date, but TZDate uses 1-indexed months
  const tzDate = new TZDate(year, month - 1, day, hours, minutes, 0, BANGKOK_TIMEZONE)
  
  // Convert to UTC Date object
  const utcDate = new Date(tzDate.getTime())
  
  // Validate the resulting timestamp
  const timestamp = Math.floor(utcDate.getTime() / 1000)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid timestamp generated from date: ${dateString} ${timeString || ''}`)
  }
  
  return timestamp
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

