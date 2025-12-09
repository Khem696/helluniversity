import { getTursoClient } from "./turso"
import { randomUUID } from "crypto"
import { createBangkokTimestamp, getBangkokTime } from "./timezone"
import { logWarn } from "./logger"

/**
 * Calculate end timestamp for a booking hold, considering time components
 * This is a shared helper to avoid code duplication
 */
/**
 * Calculate the end timestamp for a booking hold
 * Since time fields are no longer used, this simplifies to:
 * - If endDate exists: end of that day (23:59:59) in Bangkok timezone
 * - If no endDate: end of startDate day (23:59:59) in Bangkok timezone
 * 
 * @internal - Exported for use in booking-validations.ts
 */
export async function calculateHoldEndTimestamp(
  startDate: number,
  endDate: number | null,
  endTime: string | null // Always null now, kept for backward compatibility
): Promise<number> {
  const { TZDate } = await import('@date-fns/tz')
  const BANGKOK_TIMEZONE = 'Asia/Bangkok'
  
  // CRITICAL: Validate input timestamps are valid positive numbers
  // This prevents issues with corrupted data (e.g., startDate = 0, null, or negative)
  if (!startDate || typeof startDate !== 'number' || startDate <= 0) {
    throw new Error(
      `Invalid startDate timestamp: ${startDate}. Expected a positive Unix timestamp (seconds since epoch).`
    )
  }
  
  if (endDate !== null && (typeof endDate !== 'number' || endDate <= 0)) {
    throw new Error(
      `Invalid endDate timestamp: ${endDate}. Expected null or a positive Unix timestamp (seconds since epoch).`
    )
  }
  
  // Time is no longer used - always calculate end of day
  const targetDate = endDate || startDate
  
  try {
    const utcDate = new Date(targetDate * 1000)
    
    // Additional validation: ensure the Date object is valid
    if (isNaN(utcDate.getTime())) {
      throw new Error(`Invalid date created from timestamp: ${targetDate}`)
    }
    
    const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
    const year = tzDate.getFullYear()
    const month = tzDate.getMonth()
    const day = tzDate.getDate()
    
    // Validate date components are reasonable (sanity check)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      throw new Error(`Invalid date components: year=${year}, month=${month}, day=${day}`)
    }
    
    // Set to end of day (23:59:59) in Bangkok timezone
    const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
    const result = Math.floor(tzDateEndOfDay.getTime() / 1000)
    
    // Validate result is a valid timestamp
    if (!Number.isFinite(result) || result <= 0) {
      throw new Error(`Invalid end timestamp calculated: ${result}`)
    }
    
    return result
  } catch (error) {
    // CRITICAL: If we can't calculate the end of day, throw an error rather than
    // returning start of day, which would create an incorrect hold (especially for multi-day holds)
    // This ensures data integrity - if date calculation fails, the hold creation should fail
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to calculate end timestamp for booking hold: ${errorMessage}. ` +
      `This may indicate an invalid date. Please verify the date is valid.`
    )
  }
}

/**
 * Booking Holds Management
 * 
 * Allows admins to mark dates as unavailable for bookings
 */

/**
 * Clean up expired booking holds (holds that have ended)
 * This can be called periodically to remove old holds from the database
 * 
 * @param olderThanDays - Only delete holds that ended more than this many days ago (default: 0, meaning delete immediately after end date passes)
 * @returns Object with deletedCount and skippedCount, or number for backward compatibility (returns deletedCount)
 */
export async function cleanupExpiredHolds(olderThanDays: number = 0): Promise<{ deletedCount: number; skippedCount: number; errorCount: number }> {
  const db = getTursoClient()
  const now = getBangkokTime()
  const cutoffTimestamp = now - (olderThanDays * 24 * 60 * 60) // olderThanDays days ago (default: now, meaning delete immediately after end date passes)
  
  // IMPROVED: Use cursor-based pagination to avoid skipping items when deletions occur
  // Instead of OFFSET (which can skip items when rows are deleted), we use WHERE with
  // start_date and id as cursor keys. This ensures we process all holds even if some are deleted.
  const BATCH_SIZE = 100
  let deletedCount = 0
  let skippedCount = 0
  let errorCount = 0 // Track holds that failed timestamp calculation
  let lastStartDate: number | null = null
  let lastId: string | null = null
  
  const { logWarn, logError } = await import('./logger')
  
  while (true) {
    // Fetch holds in batches using cursor-based pagination
    // This ensures we don't skip items even if some are deleted during processing
    let result
    if (lastStartDate === null && lastId === null) {
      // First batch: get the first BATCH_SIZE holds
      result = await db.execute({
        sql: `
          SELECT * FROM booking_holds
          ORDER BY start_date ASC, id ASC
          LIMIT ?
        `,
        args: [BATCH_SIZE],
      })
    } else {
      // Subsequent batches: get holds after the last processed one
      result = await db.execute({
        sql: `
          SELECT * FROM booking_holds
          WHERE (start_date > ? OR (start_date = ? AND id > ?))
          ORDER BY start_date ASC, id ASC
          LIMIT ?
        `,
        args: [lastStartDate, lastStartDate, lastId, BATCH_SIZE],
      })
    }
    
    if (result.rows.length === 0) {
      break // No more holds to process
    }
    
    // Process batch
    for (const row of result.rows) {
      const hold = formatHold(row as any)
      
      try {
        // Time fields are always null now - dates represent full days
        const endTimestamp = await calculateHoldEndTimestamp(
          hold.startDate,
          hold.endDate,
          null // Time is always null (formatHold sets it to null)
        )
        
        // Delete if hold ended more than olderThanDays ago
        if (endTimestamp < cutoffTimestamp) {
          try {
            const deleteResult = await db.execute({
              sql: "DELETE FROM booking_holds WHERE id = ?",
              args: [hold.id],
            })
            
            if (deleteResult.rowsAffected > 0) {
              deletedCount++
            } else {
              // Hold was already deleted (possibly by another process or concurrent cleanup)
              skippedCount++
              logWarn('Hold was already deleted during cleanup (possible concurrent operation)', {
                holdId: hold.id,
                startDate: hold.startDate,
                endDate: hold.endDate
              })
            }
          } catch (error) {
            // Use logError from top-level import
            logError('Failed to delete expired hold during cleanup', {
              holdId: hold.id,
              endTimestamp,
              cutoffTimestamp,
              error: error instanceof Error ? error.message : String(error)
            }, error instanceof Error ? error : new Error(String(error)))
            // Continue with other holds even if one fails
          }
        }
        
        // Update cursor for next batch (always update, even if hold wasn't deleted)
        lastStartDate = hold.startDate
        lastId = hold.id
      } catch (error) {
        // Track holds that fail timestamp calculation (possible data corruption)
        errorCount++
        const errorMessage = error instanceof Error ? error.message : String(error)
        logError('Failed to calculate end timestamp for hold during cleanup - hold skipped', {
          holdId: hold.id,
          startDate: hold.startDate,
          endDate: hold.endDate,
          error: errorMessage,
          note: 'This hold may have corrupted date data and will not be deleted. Consider manual review.'
        }, error instanceof Error ? error : new Error(errorMessage))
        // Update cursor even if calculation failed to avoid infinite loop
        lastStartDate = hold.startDate
        lastId = hold.id
        // Continue with other holds
      }
    }
    
    // If we got fewer rows than batch size, we're done
    if (result.rows.length < BATCH_SIZE) {
      break
    }
  }
  
  // Log summary if there were skipped items or errors
  if (skippedCount > 0 || errorCount > 0) {
    if (errorCount > 0) {
      logError('Cleanup expired holds completed with errors', {
        deletedCount,
        skippedCount,
        errorCount,
        olderThanDays,
        cutoffTimestamp,
        message: `${deletedCount} hold(s) deleted, ${skippedCount} already deleted, ${errorCount} failed timestamp calculation (may need manual review)`
      }, new Error(`${errorCount} hold(s) failed timestamp calculation`))
    } else {
      logWarn('Cleanup expired holds completed with skipped items', {
        deletedCount,
        skippedCount,
        olderThanDays,
        cutoffTimestamp,
        message: `${skippedCount} hold(s) were already deleted (possibly by concurrent operation)`
      })
    }
  }
  
  // Return deleted, skipped, and error counts for better visibility
  return { deletedCount, skippedCount, errorCount }
}

export interface BookingHold {
  id: string
  startDate: number // Unix timestamp
  endDate: number | null // Unix timestamp, null for single day holds
  /** @deprecated Time fields are no longer used - always null. Kept for backward compatibility. */
  startTime: string | null // HH:mm format (deprecated - always null)
  /** @deprecated Time fields are no longer used - always null. Kept for backward compatibility. */
  endTime: string | null // HH:mm format (deprecated - always null)
  reason: string | null
  createdBy: string
  modifiedBy: string | null // Email of admin who last modified the hold
  createdAt: number
  updatedAt: number
}

export interface BookingHoldData {
  startDate: string // YYYY-MM-DD format
  endDate?: string | null // YYYY-MM-DD format, optional for single day
  /** @deprecated Time fields are no longer used - always ignored/set to null. Kept for backward compatibility. */
  startTime?: string | null // HH:mm format (deprecated - always ignored)
  /** @deprecated Time fields are no longer used - always ignored/set to null. Kept for backward compatibility. */
  endTime?: string | null // HH:mm format (deprecated - always ignored)
  reason?: string | null
}

/**
 * Format database row to BookingHold interface
 * 
 * CRITICAL: Validates all required fields to prevent issues with corrupted data.
 * Database schema has NOT NULL constraints, but we validate for safety.
 * 
 * Note: This function is synchronous and doesn't log errors to avoid performance issues.
 * Invalid data will be caught by calculateHoldEndTimestamp validation or downstream checks.
 */
function formatHold(row: any): BookingHold {
  // CRITICAL: Handle null/undefined row to prevent crashes
  // This should never happen with database queries, but defensive programming
  if (!row || typeof row !== 'object') {
    // Return a minimal valid BookingHold with fallback values
    // This will be caught by calculateHoldEndTimestamp validation downstream
    return {
      id: '',
      startDate: 0,
      endDate: null,
      startTime: null,
      endTime: null,
      reason: null,
      createdBy: '',
      modifiedBy: null,
      createdAt: 0,
      updatedAt: 0,
    }
  }
  
  // Validate id - required, must be a non-empty string
  const id = typeof row.id === 'string' && row.id.trim().length > 0
    ? row.id
    : ''
  
  // Validate created_by - required, must be a non-empty string
  const createdBy = typeof row.created_by === 'string' && row.created_by.trim().length > 0
    ? row.created_by
    : ''
  
  // Validate created_at - required, must be a valid positive number (timestamp)
  // Use 0 as fallback - will be caught by any timestamp validation downstream
  const createdAt = typeof row.created_at === 'number' && row.created_at > 0
    ? row.created_at
    : 0
  
  // Validate updated_at - required, must be a valid positive number (timestamp)
  // Use 0 as fallback - will be caught by any timestamp validation downstream
  const updatedAt = typeof row.updated_at === 'number' && row.updated_at > 0
    ? row.updated_at
    : 0
  
  // Validate startDate is a valid positive number
  // If invalid, use 0 as fallback - this will be caught by calculateHoldEndTimestamp validation
  const startDate = typeof row.start_date === 'number' && row.start_date > 0 
    ? row.start_date 
    : 0
  
  // Validate endDate if present
  const endDate = row.end_date && typeof row.end_date === 'number' && row.end_date > 0 
    ? row.end_date 
    : null
  
  return {
    id,
    startDate,
    endDate,
    startTime: null, // Time columns removed from database
    endTime: null, // Time columns removed from database
    reason: row.reason,
    createdBy,
    modifiedBy: row.modified_by || null,
    createdAt,
    updatedAt,
  }
}

/**
 * Create a new booking hold
 */
export async function createBookingHold(
  data: BookingHoldData,
  createdBy: string
): Promise<BookingHold> {
  const db = getTursoClient()
  const holdId = randomUUID()
  const now = getBangkokTime()

  // Convert dates to Unix timestamps
  // Time fields are always null now - dates represent full days
  const { calculateStartTimestamp } = await import("./booking-validations")
  const startDateTimestamp = createBangkokTimestamp(data.startDate, null)
  const startTimestamp = calculateStartTimestamp(startDateTimestamp, null)
  
  let endDateTimestamp: number | null = null
  if (data.endDate) {
    endDateTimestamp = createBangkokTimestamp(data.endDate, null)
  }
  
  // Use shared helper to calculate end timestamp (always null for time now)
  const endTimestamp = await calculateHoldEndTimestamp(startDateTimestamp, endDateTimestamp, null)

  // CRITICAL: Validate that end timestamp is after start timestamp
  // For date-only holds: single-day holds block the entire day (start to end of day)
  // Multi-day holds: end date must be >= start date (already validated in API)
  // Since times are always null, endTimestamp will always be >= startTimestamp for valid date ranges
  // But we still check to be safe
  if (endTimestamp <= startTimestamp) {
    throw new Error(
      `Invalid booking hold date range: end date (${new Date(endTimestamp * 1000).toISOString()}) must be after start date (${new Date(startTimestamp * 1000).toISOString()})`
    )
  }

  // CRITICAL: Sanitize reason field to prevent XSS and control characters
  const { sanitizeText } = await import('./input-validation')
  const sanitizedReason = data.reason ? sanitizeText(data.reason.trim(), 1000, true) : null

  try {
    await db.execute({
      sql: `
        INSERT INTO booking_holds (
          id, start_date, end_date, reason, created_by, modified_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        holdId,
        startDateTimestamp,
        endDateTimestamp,
        sanitizedReason,
        createdBy,
        createdBy, // modified_by is same as created_by for new holds
        now,
        now,
      ],
    })

    const result = await db.execute({
      sql: "SELECT * FROM booking_holds WHERE id = ?",
      args: [holdId],
    })

    if (result.rows.length === 0) {
      throw new Error("Failed to retrieve created booking hold")
    }

    return formatHold(result.rows[0] as any)
  } catch (error) {
    const { logError } = await import('./logger')
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    // Check if this is a database constraint violation (overlap trigger)
    if (errorMessage.includes('overlaps with an existing booking hold')) {
      // Re-throw with the user-friendly message from the trigger
      throw new Error(errorMessage)
    }
    
    logError('Failed to create booking hold', {
      holdId,
      startDateTimestamp,
      endDateTimestamp,
      startDate: data.startDate,
      endDate: data.endDate,
      createdBy,
      error: errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined
    }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * Get all booking holds
 */
export async function getAllBookingHolds(): Promise<BookingHold[]> {
  const db = getTursoClient()
  
  const result = await db.execute({
      sql: `
      SELECT * FROM booking_holds
      ORDER BY start_date ASC
    `,
  })

  return result.rows.map((row) => formatHold(row as any))
}

/**
 * Get active booking holds (future or current holds)
 * A hold is active if its end timestamp (considering time) is >= now
 */
export async function getActiveBookingHolds(): Promise<BookingHold[]> {
  const db = getTursoClient()
  const now = getBangkokTime()
  
  // Get all holds first, then filter by calculating actual end timestamps
  const result = await db.execute({
      sql: `
      SELECT * FROM booking_holds
      ORDER BY start_date ASC
    `,
  })

  const activeHolds: BookingHold[] = []
  
  for (const row of result.rows) {
    const hold = formatHold(row as any)
    
    try {
      // Calculate actual end timestamp for this hold using shared helper
      // Time fields are always null now - dates represent full days
      const endTimestamp = await calculateHoldEndTimestamp(
        hold.startDate,
        hold.endDate,
        null // Time is always null (formatHold sets it to null)
      )
      
      // Hold is active if end timestamp >= now
      if (endTimestamp >= now) {
        activeHolds.push(hold)
      }
    } catch (error) {
      // If we can't calculate the end timestamp (e.g., corrupted data), log and skip this hold
      // This prevents one bad hold from breaking the entire function
      const { logWarn } = await import('./logger')
      logWarn('Failed to calculate end timestamp for hold in getActiveBookingHolds, skipping', {
        holdId: hold.id,
        startDate: hold.startDate,
        endDate: hold.endDate,
        error: error instanceof Error ? error.message : String(error)
      })
      // Continue with other holds - skip this one
    }
  }

  return activeHolds
}

/**
 * Get booking hold by ID
 */
export async function getBookingHoldById(id: string): Promise<BookingHold | null> {
  const db = getTursoClient()
  
  const result = await db.execute({
    sql: "SELECT * FROM booking_holds WHERE id = ?",
    args: [id],
  })

  if (result.rows.length === 0) {
    return null
  }

  return formatHold(result.rows[0] as any)
}

/**
 * Update a booking hold
 * 
 * @param id - Hold ID to update
 * @param data - Partial hold data to update
 * @param modifiedBy - Email of admin modifying the hold (required for audit tracking)
 */
export async function updateBookingHold(
  id: string,
  data: Partial<BookingHoldData>,
  modifiedBy: string
): Promise<BookingHold> {
  const db = getTursoClient()
  const now = getBangkokTime()

  // Get existing hold
  const existing = await getBookingHoldById(id)
  if (!existing) {
    throw new Error("Booking hold not found")
  }

  // CRITICAL: Validate existing hold has valid data before using it
  // If existing.startDate is invalid (e.g., 0 or corrupted), validate it will fail
  // This prevents using corrupted data when updating only partial fields
  if (!existing.startDate || typeof existing.startDate !== 'number' || existing.startDate <= 0) {
    throw new Error(
      `Cannot update booking hold: existing hold has invalid startDate (${existing.startDate}). ` +
      `Please contact support to fix this hold's data.`
    )
  }

  // CRITICAL: Validate existing.endDate if it exists and will be used
  // If existing.endDate is invalid (negative, 0, or less than startDate), catch it early
  if (existing.endDate !== null) {
    if (typeof existing.endDate !== 'number' || existing.endDate <= 0) {
      throw new Error(
        `Cannot update booking hold: existing hold has invalid endDate (${existing.endDate}). ` +
        `Please contact support to fix this hold's data.`
      )
    }
    // Validate data integrity: endDate should be >= startDate
    if (existing.endDate < existing.startDate) {
      throw new Error(
        `Cannot update booking hold: existing hold has invalid date range (endDate ${existing.endDate} < startDate ${existing.startDate}). ` +
        `Please contact support to fix this hold's data.`
      )
    }
  }

  // Prepare update values
  // Time fields are always null now - dates represent full days
  const { calculateStartTimestamp } = await import("./booking-validations")
  
  const startDateTimestamp = data.startDate
    ? createBangkokTimestamp(data.startDate, null)
    : existing.startDate

  const startTimestamp = calculateStartTimestamp(startDateTimestamp, null)

  let endDateTimestamp: number | null = null
  if (data.endDate !== undefined) {
    if (data.endDate) {
      endDateTimestamp = createBangkokTimestamp(data.endDate, null)
    } else {
      endDateTimestamp = null
    }
  } else {
    endDateTimestamp = existing.endDate
  }
  
  // Use shared helper to calculate end timestamp (always null for time now)
  const endTimestamp = await calculateHoldEndTimestamp(startDateTimestamp, endDateTimestamp, null)

  // CRITICAL: Sanitize reason field to prevent XSS and control characters
  const { sanitizeText } = await import('./input-validation')
  const reason = data.reason !== undefined 
    ? (data.reason ? sanitizeText(data.reason.trim(), 1000, true) : null)
    : existing.reason

  // CRITICAL: Validate that end timestamp is after start timestamp
  // For date-only holds: end date must be >= start date (already validated in API)
  // Since times are always null, endTimestamp will always be >= startTimestamp for valid date ranges
  if (endTimestamp <= startTimestamp) {
    throw new Error(
      `Invalid booking hold date range: end date (${new Date(endTimestamp * 1000).toISOString()}) must be after start date (${new Date(startTimestamp * 1000).toISOString()})`
    )
  }

  try {
    // Use optimistic locking: check updated_at to detect concurrent modifications
    // This prevents lost updates when multiple admins edit the same hold
    const updateResult = await db.execute({
      sql: `
        UPDATE booking_holds
        SET start_date = ?, end_date = ?, reason = ?, modified_by = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `,
      args: [startDateTimestamp, endDateTimestamp, reason, modifiedBy, now, id, existing.updatedAt],
    })
    
    if (updateResult.rowsAffected === 0) {
      // Hold was modified by another admin or doesn't exist
      throw new Error("Booking hold was modified by another user. Please refresh and try again.")
    }

    const result = await db.execute({
      sql: "SELECT * FROM booking_holds WHERE id = ?",
      args: [id],
    })

    if (result.rows.length === 0) {
      throw new Error("Failed to retrieve updated booking hold")
    }

    return formatHold(result.rows[0] as any)
  } catch (error) {
    const { logError } = await import('./logger')
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    // Check if this is a database constraint violation (overlap trigger)
    if (errorMessage.includes('overlaps with an existing booking hold')) {
      // Re-throw with the user-friendly message from the trigger
      throw new Error(errorMessage)
    }
    
    logError('Failed to update booking hold', {
      holdId: id,
        updateData: {
        startDate: data.startDate,
        endDate: data.endDate,
        reason: data.reason ? `${data.reason.substring(0, 50)}...` : null
      },
      existingHold: existing ? {
        startDate: existing.startDate,
        endDate: existing.endDate,
      } : null,
      error: errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined
    }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * Delete a booking hold
 */
export async function deleteBookingHold(id: string): Promise<void> {
  const db = getTursoClient()
  
  try {
    const result = await db.execute({
      sql: "DELETE FROM booking_holds WHERE id = ?",
      args: [id],
    })

    if (result.rowsAffected === 0) {
      throw new Error("Booking hold not found")
    }
  } catch (error) {
    const { logError } = await import('./logger')
    // Note: result may not be available if error occurred before execute
    logError('Failed to delete booking hold', {
      holdId: id,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * Check if a booking's date range overlaps with any active booking holds
 * Used to warn admins when viewing bookings that overlap with holds
 * 
 * Since booking holds are date-only (block entire days), we check if any of the booking's dates
 * fall within a hold's date range. The booking's time doesn't matter since holds block full days.
 * 
 * @param bookingStartDate - Booking start date timestamp (start of day)
 * @param bookingEndDate - Booking end date timestamp (start of day, null for single day)
 * @param bookingStartTime - Booking start time (ignored - holds are date-only)
 * @param bookingEndTime - Booking end time (ignored - holds are date-only)
 * @returns Array of overlapping active booking holds
 */
export async function findOverlappingBookingHolds(
  bookingStartDate: number,
  bookingEndDate: number | null,
  bookingStartTime: string | null, // Ignored - holds are date-only
  bookingEndTime: string | null // Ignored - holds are date-only
): Promise<BookingHold[]> {
  // Validate booking dates - if startDate is 0 or invalid, return empty array
  // This handles edge cases where booking data might be corrupted or missing
  if (!bookingStartDate || bookingStartDate <= 0) {
    const { logWarn } = await import('./logger')
    logWarn('findOverlappingBookingHolds: Invalid booking start date', {
      bookingStartDate,
      bookingEndDate
    })
    return []
  }
  
  // Validate that endDate >= startDate if both are provided
  // This prevents invalid date ranges from causing calculation errors
  if (bookingEndDate !== null && bookingEndDate < bookingStartDate) {
    const { logWarn } = await import('./logger')
    logWarn('findOverlappingBookingHolds: Invalid booking date range (endDate < startDate)', {
      bookingStartDate,
      bookingEndDate
    })
    return []
  }
  
  // Get all active booking holds
  const activeHolds = await getActiveBookingHolds()
  
  if (activeHolds.length === 0) {
    return []
  }
  
  try {
    // Calculate booking date range timestamps
    // Since holds block entire days, we use start of day for start and end of day for end
    const { calculateStartTimestamp } = await import("./booking-validations")
    const bookingStartTimestamp = calculateStartTimestamp(bookingStartDate, null) // Start of start day
    
    // Calculate booking end timestamp (end of the last day of the booking)
    const bookingEndTimestamp = await calculateHoldEndTimestamp(
      bookingStartDate,
      bookingEndDate, // null for single day
      null
    )
    
    // Validate calculated timestamps
    if (bookingEndTimestamp <= bookingStartTimestamp) {
      const { logWarn } = await import('./logger')
      logWarn('findOverlappingBookingHolds: Invalid booking date range (end <= start)', {
        bookingStartDate,
        bookingEndDate,
        bookingStartTimestamp,
        bookingEndTimestamp
      })
      return []
    }
    
    // Check each active hold for overlap
    const overlappingHolds: BookingHold[] = []
    
    for (const hold of activeHolds) {
      try {
        const holdStartTimestamp = calculateStartTimestamp(hold.startDate, null)
        const holdEndTimestamp = await calculateHoldEndTimestamp(hold.startDate, hold.endDate, null)
        
        // Two date ranges overlap if: bookingStart < holdEnd AND bookingEnd > holdStart
        // Since holds block entire days, any booking that touches a held day overlaps
        const overlaps = bookingStartTimestamp < holdEndTimestamp && bookingEndTimestamp > holdStartTimestamp
        
        if (overlaps) {
          overlappingHolds.push(hold)
        }
      } catch (error) {
        // If we can't calculate timestamps for a hold (e.g., corrupted data), skip it
        // This prevents one bad hold from breaking the entire function
        const { logWarn } = await import('./logger')
        logWarn('findOverlappingBookingHolds: Failed to calculate timestamps for hold, skipping', {
          holdId: hold.id,
          holdStartDate: hold.startDate,
          holdEndDate: hold.endDate,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue with other holds
      }
    }
    
    return overlappingHolds
  } catch (error) {
    // If we can't calculate booking timestamps, log and return empty array
    // This prevents the function from crashing and allows the booking to be viewed
    const { logError } = await import('./logger')
    logError('findOverlappingBookingHolds: Failed to calculate booking timestamps', {
      bookingStartDate,
      bookingEndDate,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    }, error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

/**
 * Check if a date range overlaps with any booking holds
 * 
 * @deprecated This function is kept for backward compatibility but is no longer used.
 * Overlap checking is now handled by database triggers to prevent race conditions.
 * Time parameters are ignored (holds are date-only).
 */
export async function checkHoldOverlap(
  startDate: number,
  endDate: number | null,
  startTime: string | null, // Deprecated - ignored (always treated as null)
  endTime: string | null, // Deprecated - ignored (always treated as null)
  excludeHoldId?: string | null
): Promise<{ overlaps: boolean; overlappingHolds?: BookingHold[] }> {
  const db = getTursoClient()
  
  // Calculate actual start and end timestamps
  // Time fields are always null now - dates represent full days
  const { calculateStartTimestamp } = await import("./booking-validations")
  const startTimestamp = calculateStartTimestamp(startDate, null) // Time is always null (deprecated parameter)
  
  // Use shared helper to calculate end timestamp
  const endTimestamp = await calculateHoldEndTimestamp(startDate, endDate, null) // Time is always null (deprecated parameter)

  // Query for overlapping holds
  // We need to check if any existing hold overlaps with the given time range
  // Two time ranges overlap if: newStart < existingEnd AND newEnd > existingStart
  // We need to calculate timestamps for each hold to do proper time-based overlap checking
  
  const allHolds = await db.execute({
    sql: excludeHoldId
      ? `SELECT * FROM booking_holds WHERE id != ? ORDER BY start_date ASC`
      : `SELECT * FROM booking_holds ORDER BY start_date ASC`,
    args: excludeHoldId ? [excludeHoldId] : []
  })

  const overlappingHolds: BookingHold[] = []
  
  for (const row of allHolds.rows) {
    const existingHold = formatHold(row as any)
    
    // Calculate timestamps for existing hold using shared helper
    // Time fields are always null now - dates represent full days
    const { calculateStartTimestamp } = await import("./booking-validations")
    const existingStartTimestamp = calculateStartTimestamp(existingHold.startDate, null) // Time is always null
    const existingEndTimestamp = await calculateHoldEndTimestamp(
      existingHold.startDate,
      existingHold.endDate,
      null // Time is always null
    )
    
    // Check for time overlap: two time ranges overlap if:
    // newStart < existingEnd AND newEnd > existingStart
    // This includes boundary touches (e.g., 21-25 overlaps with 25-26)
    const overlaps = startTimestamp < existingEndTimestamp && endTimestamp > existingStartTimestamp
    
    if (overlaps) {
      overlappingHolds.push(existingHold)
    }
  }
  
  if (overlappingHolds.length === 0) {
    return { overlaps: false }
  }
  
  return { overlaps: true, overlappingHolds }
}

/**
 * Bulk delete booking holds
 * 
 * @param holdIds - Array of hold IDs to delete
 * @returns Number of holds deleted
 * 
 * CRITICAL: Uses transaction to ensure atomicity - either all deletes succeed or none do
 */
export async function bulkDeleteBookingHolds(holdIds: string[]): Promise<number> {
  if (!holdIds || holdIds.length === 0) {
    return 0
  }

  // Validate and deduplicate IDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validIds = Array.from(new Set(holdIds.filter(id => {
    if (typeof id !== 'string' || id.length === 0) {
      return false
    }
    // Validate UUID format (basic check)
    return uuidRegex.test(id)
  })))

  if (validIds.length === 0) {
    return 0
  }

  // CRITICAL: Use transaction to ensure atomicity
  // All deletes succeed or all fail (rollback)
  const { dbTransaction } = await import('./turso')
  
  try {
    return await dbTransaction(async (tx) => {
      let deletedCount = 0

      // Delete holds one by one within transaction
      for (const id of validIds) {
        const result = await tx.execute({
          sql: "DELETE FROM booking_holds WHERE id = ?",
          args: [id],
        })

        if (result.rowsAffected && result.rowsAffected > 0) {
          deletedCount++
        }
      }

      return deletedCount
    })
  } catch (error) {
    // If transaction fails, log error and re-throw
    // This ensures partial deletions don't occur
    const { logError } = await import('./logger')
    logError('Bulk delete booking holds transaction failed', {
      holdIds: validIds,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * Bulk create booking holds
 * 
 * @param holdsData - Array of hold data to create
 * @param createdBy - Email of admin creating the holds
 * @returns Array of created holds
 */
export async function bulkCreateBookingHolds(
  holdsData: BookingHoldData[],
  createdBy: string
): Promise<BookingHold[]> {
  if (!holdsData || holdsData.length === 0) {
    return []
  }

  // CRITICAL: First, check for overlaps between holds in the same request
  // This prevents creating overlapping holds in a single bulk operation
  const { calculateStartTimestamp } = await import("./booking-validations")
  const { createBangkokTimestamp } = await import("./timezone")
  
  // Calculate timestamps for all holds first
  const holdTimestamps: Array<{
    index: number
    startTimestamp: number
    endTimestamp: number
    data: BookingHoldData
  }> = []
  
  for (let i = 0; i < holdsData.length; i++) {
    const hold = holdsData[i]
    if (!hold.startDate) {
      continue // Will be caught by validation in createBookingHold
    }
    
    try {
      // Time fields are always null now - dates represent full days
      const startDateTimestamp = createBangkokTimestamp(hold.startDate, null)
      const startTimestamp = calculateStartTimestamp(startDateTimestamp, null)
      
      let endDateTimestamp: number | null = null
      if (hold.endDate) {
        endDateTimestamp = createBangkokTimestamp(hold.endDate, null)
      }
      
      const endTimestamp = await calculateHoldEndTimestamp(startDateTimestamp, endDateTimestamp, null)
      
      holdTimestamps.push({
        index: i,
        startTimestamp,
        endTimestamp,
        data: hold
      })
    } catch (error) {
      // Skip invalid holds - will be caught during creation
      continue
    }
  }
  
  // Check for overlaps between holds in the same request
  for (let i = 0; i < holdTimestamps.length; i++) {
    for (let j = i + 1; j < holdTimestamps.length; j++) {
      const hold1 = holdTimestamps[i]
      const hold2 = holdTimestamps[j]
      
      // Two time ranges overlap if: hold1Start < hold2End AND hold1End > hold2Start
      const overlaps = hold1.startTimestamp < hold2.endTimestamp && hold1.endTimestamp > hold2.startTimestamp
      
      if (overlaps) {
        throw new Error(
          `Holds at indices ${hold1.index} and ${hold2.index} overlap. Please ensure all holds in the bulk request have non-overlapping date ranges.`
        )
      }
    }
  }

  const createdHolds: BookingHold[] = []
  const errors: Array<{ index: number; error: string }> = []

  // Create holds one by one to handle validation errors gracefully
  // Note: We still check overlaps with existing holds in createBookingHold
  for (let i = 0; i < holdsData.length; i++) {
    try {
      const hold = await createBookingHold(holdsData[i], createdBy)
      createdHolds.push(hold)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push({ index: i, error: errorMessage })
      const { logWarn } = await import('./logger')
      logWarn('Failed to create hold during bulk create', {
        index: i,
        holdData: holdsData[i],
        error: errorMessage
      })
      // Continue with other holds even if one fails
    }
  }

  // If some holds failed, log a summary
  if (errors.length > 0) {
    const { logWarn } = await import('./logger')
    logWarn('Bulk create completed with some failures', {
      total: holdsData.length,
      succeeded: createdHolds.length,
      failed: errors.length,
      errors: errors.map(e => `Index ${e.index}: ${e.error}`)
    })
  }

  return createdHolds
}

