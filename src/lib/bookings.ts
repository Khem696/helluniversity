import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID, randomBytes, randomInt } from "crypto"
import { sendAdminAutoUpdateNotification, sendBookingStatusNotification } from "./email"
import { checkBookingOverlap } from "./booking-validations"
import { getCached, setCached, invalidateCache, CacheKeys } from "./cache"

/**
 * Booking Management Utilities
 * 
 * Handles CRUD operations for bookings and status management
 */

export interface BookingData {
  name: string
  email: string
  phone: string
  participants?: string
  eventType: string
  otherEventType?: string
  dateRange: boolean
  startDate: string | null
  endDate?: string | null
  startTime?: string
  endTime?: string
  organizationType?: "Tailor Event" | "Space Only" | ""
  organizedPerson?: string
  introduction: string
  biography?: string
  specialRequests?: string
}

export interface Booking extends BookingData {
  id: string
  referenceNumber: string
  status: "pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished"
  adminNotes?: string
  responseToken?: string
  tokenExpiresAt?: number
  proposedDate?: string | null
  proposedEndDate?: string | null
  userResponse?: string
  responseDate?: number
  depositEvidenceUrl?: string | null
  depositVerifiedAt?: number | null
  depositVerifiedBy?: string | null
  depositVerifiedFromOtherChannel?: boolean
  createdAt: number
  updatedAt: number
}

export interface BookingStatusHistory {
  id: string
  bookingId: string
  oldStatus: string | null
  newStatus: string
  changedBy?: string
  changeReason?: string
  createdAt: number
}

/**
 * Generate a short booking reference number using Base36 encoding
 * Format: HU-XXXXXX (e.g., HU-A3K9M2)
 * Uses timestamp + random component for uniqueness
 */
function generateBookingReference(): string {
  // Get current timestamp in seconds (last 6 digits for shorter code)
  const timestamp = Math.floor(Date.now() / 1000)
  
  // Generate random component (3 bytes = 6 hex chars, convert to base36)
  const randomBuffer = randomBytes(3)
  const randomValue = parseInt(randomBuffer.toString('hex'), 16)
  
  // Convert to base36 (0-9, a-z)
  const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0') // 46656 = 36^3
  const randomPart = (randomValue % 1296).toString(36).toUpperCase().padStart(2, '0') // 1296 = 36^2
  
  // Combine: HU- + 3 chars timestamp + 2 chars random = HU-XXXXX (8 chars total)
  const reference = `HU-${timestampPart}${randomPart}`
  
  return reference
}

/**
 * Create a new booking
 * @param data - Booking data
 * @param referenceNumber - Optional reference number (if not provided, will be generated)
 */
export async function createBooking(data: BookingData, referenceNumber?: string): Promise<Booking> {
  const db = getTursoClient()
  const bookingId = randomUUID()
  const finalReferenceNumber = referenceNumber || generateBookingReference()
  const now = Math.floor(Date.now() / 1000)

  // Convert dates to Unix timestamps using Bangkok timezone
  // Dates are in YYYY-MM-DD format (Bangkok timezone)
  const { createBangkokTimestamp } = await import('./timezone')
  const startDate = data.startDate
    ? createBangkokTimestamp(data.startDate, data.startTime || null)
    : null

  const endDate = data.endDate
    ? createBangkokTimestamp(data.endDate, data.endTime || null)
    : null

  if (!startDate) {
    throw new Error("Start date is required")
  }

  await db.execute({
    sql: `
      INSERT INTO bookings (
        id, reference_number, name, email, phone, participants, event_type, other_event_type,
        date_range, start_date, end_date, start_time, end_time,
        organization_type, organized_person, introduction, biography,
        special_requests, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      bookingId,
      finalReferenceNumber,
      data.name.trim(),
      data.email.trim(),
      data.phone.trim(),
      data.participants?.trim() || null,
      data.eventType.trim(),
      data.otherEventType?.trim() || null,
      data.dateRange ? 1 : 0,
      startDate,
      endDate,
      data.startTime?.trim() || null,
      data.endTime?.trim() || null,
      data.organizationType || null,
      data.organizedPerson?.trim() || null,
      data.introduction.trim(),
      data.biography?.trim() || null,
      data.specialRequests?.trim() || null,
      "pending",
      now,
      now,
    ],
  })

  // Fetch the created booking
  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE id = ?",
    args: [bookingId],
  })

  const booking = formatBooking(result.rows[0] as any)
  
  // Invalidate list caches when new booking is created
  invalidateCache('bookings:list')
  
  return booking
}

/**
 * Get booking by ID
 * Uses caching to reduce database queries
 */
export async function getBookingById(id: string): Promise<Booking | null> {
  // Check cache first
  const cacheKey = CacheKeys.booking(id)
  const cached = getCached<Booking>(cacheKey)
  if (cached) {
    return cached
  }

  // If not in cache, fetch from database
  const db = getTursoClient()

  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE id = ?",
    args: [id],
  })

  if (result.rows.length === 0) {
    return null
  }

  const booking = formatBooking(result.rows[0] as any)
  
  // Cache the result (5 minutes TTL)
  setCached(cacheKey, booking, 300)
  
  return booking
}

/**
 * List bookings with filters
 */
export async function listBookings(options?: {
  status?: "pending" | "pending_deposit" | "confirmed" | "cancelled" | "finished"
  statuses?: ("pending" | "pending_deposit" | "confirmed" | "cancelled" | "finished")[]
  excludeArchived?: boolean // Exclude finished, cancelled from main list
  limit?: number
  offset?: number
  startDateFrom?: number
  startDateTo?: number
  email?: string
  referenceNumber?: string // Exact match search
  name?: string // Partial text search (LIKE)
  phone?: string // Partial text search (LIKE)
  eventType?: string // Exact match filter
  sortBy?: "created_at" | "start_date" | "name" | "updated_at" // Sort field
  sortOrder?: "ASC" | "DESC" // Sort direction
  showOverlappingOnly?: boolean // Filter to show only bookings with overlaps
}): Promise<{ bookings: Booking[]; total: number }> {
  const db = getTursoClient()

  const limit = options?.limit || 50
  const offset = options?.offset || 0

  // Build WHERE clause
  const conditions: string[] = []
  const args: any[] = []

  // Support single status or multiple statuses
  if (options?.statuses && options.statuses.length > 0) {
    const placeholders = options.statuses.map(() => "?").join(", ")
    conditions.push(`status IN (${placeholders})`)
    args.push(...options.statuses)
  } else if (options?.status) {
    conditions.push("status = ?")
    args.push(options.status)
  }

  // Exclude archived statuses (finished, cancelled) from main list
  if (options?.excludeArchived) {
    conditions.push("status NOT IN ('finished', 'cancelled')")
  }

  if (options?.startDateFrom) {
    conditions.push("start_date >= ?")
    args.push(options.startDateFrom)
  }

  if (options?.startDateTo) {
    conditions.push("start_date <= ?")
    args.push(options.startDateTo)
  }

  // Exact match searches (use indexes)
  if (options?.email) {
    conditions.push("email = ?")
    args.push(options.email)
  }

  if (options?.referenceNumber) {
    // Uses UNIQUE index on reference_number
    conditions.push("reference_number = ?")
    args.push(options.referenceNumber)
  }

  if (options?.eventType) {
    // Uses idx_bookings_event_type index
    conditions.push("event_type = ?")
    args.push(options.eventType)
  }

  // Partial text searches (LIKE - uses indexes for prefix searches)
  if (options?.name) {
    // Uses idx_bookings_name index for prefix searches (name LIKE 'value%')
    // For better performance, prefer prefix searches over contains searches
    conditions.push("name LIKE ?")
    args.push(`${options.name}%`)
  }

  if (options?.phone) {
    // Uses idx_bookings_phone index for prefix searches (phone LIKE 'value%')
    // For better performance, prefer prefix searches over contains searches
    conditions.push("phone LIKE ?")
    args.push(`${options.phone}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  // Get total count (optimized: uses indexes for filtering)
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM bookings ${whereClause}`,
    args,
  })
  const total = (countResult.rows[0] as any).count

  // Optimize ORDER BY based on available filters and user preferences to leverage composite indexes
  // Default: created_at DESC (uses idx_bookings_created_at)
  const sortBy = options?.sortBy || "created_at"
  const sortOrder = options?.sortOrder || "DESC"
  
  let orderByClause = `ORDER BY ${sortBy} ${sortOrder}`
  
  // Add secondary sort for consistency when sorting by non-unique fields
  if (sortBy !== "created_at" && sortBy !== "updated_at") {
    orderByClause += `, created_at DESC`
  }
  
  // Index usage optimization:
  // - created_at: Uses idx_bookings_created_at
  // - start_date: Uses idx_bookings_start_date or idx_bookings_status_start_date (if status filter)
  // - updated_at: Uses idx_bookings_updated_at (if exists) or scans
  // - name: Uses idx_bookings_name (for alphabetical sorting)
  
  // If filtering by status and sorting by created_at, uses idx_bookings_status_created_at
  // If filtering by status and sorting by start_date, uses idx_bookings_status_start_date
  // If filtering by event_type and status, uses idx_bookings_event_type_status_start_date

  // Get bookings (optimized: leverages composite indexes)
  // If overlap filter is enabled, we need to fetch more bookings to check for overlaps
  // Then filter in memory and apply limit/offset
  const fetchLimit = options?.showOverlappingOnly ? (limit + offset) * 3 : limit + offset // Fetch more if filtering overlaps
  const result = await db.execute({
    sql: `
      SELECT * FROM bookings 
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET 0
    `,
    args: [...args, fetchLimit],
  })

  let bookings = result.rows.map((row: any) => formatBooking(row))

  // Apply overlap filter if enabled
  if (options?.showOverlappingOnly) {
    const { findAllOverlappingBookings } = await import('./booking-validations')
    const bookingsWithOverlaps: Booking[] = []
    
    // Check each booking for overlaps (in parallel for better performance)
    const { createBangkokTimestamp } = await import('./timezone')
    const overlapChecks = await Promise.all(
      bookings.map(async (booking) => {
        // formatBooking returns dates as YYYY-MM-DD strings, convert to Unix timestamps
        const startDate = booking.startDate 
          ? createBangkokTimestamp(booking.startDate, booking.startTime || null)
          : 0
        const endDate = booking.endDate 
          ? createBangkokTimestamp(booking.endDate, booking.endTime || null)
          : null
        const overlaps = await findAllOverlappingBookings(
          booking.id,
          startDate,
          endDate,
          booking.startTime || null,
          booking.endTime || null
        )
        return { booking, overlapCount: overlaps.length }
      })
    )
    
    // Filter to only bookings with overlaps
    bookings = overlapChecks
      .filter(check => check.overlapCount > 0)
      .map(check => check.booking)
    
    // Re-apply sorting after filtering (in case order changed)
    const sortBy = options?.sortBy || "created_at"
    const sortOrder = options?.sortOrder || "DESC"
    bookings.sort((a, b) => {
      let aVal: any, bVal: any
      switch (sortBy) {
        case "created_at":
          aVal = a.createdAt
          bVal = b.createdAt
          break
        case "start_date":
          aVal = typeof a.startDate === 'number' ? a.startDate : 0
          bVal = typeof b.startDate === 'number' ? b.startDate : 0
          break
        case "name":
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case "updated_at":
          aVal = a.updatedAt
          bVal = b.updatedAt
          break
        default:
          aVal = a.createdAt
          bVal = b.createdAt
      }
      if (sortOrder === "ASC") {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
      }
    })
    
    // Update total count for overlap filter
    const totalWithOverlaps = bookings.length
    
    // Apply pagination
    bookings = bookings.slice(offset, offset + limit)
    
    return {
      bookings,
      total: totalWithOverlaps,
    }
  }

  // Apply pagination for normal queries
  bookings = bookings.slice(offset, offset + limit)

  return {
    bookings,
    total,
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
 * Helper function to calculate reservation start timestamp
 * CRITICAL: Uses Bangkok timezone to avoid timezone conversion issues
 */
async function calculateReservationStartTimestamp(
  startDate: number,
  startTime: string | null
): Promise<number | null> {
  let startTimestamp: number | null = startDate

  // Parse start_time if available
  // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
  if (startTime && startTimestamp) {
    const parsed = parseTimeString(startTime)
    if (parsed) {
      try {
        const { TZDate } = await import('@date-fns/tz')
        const BANGKOK_TIMEZONE = 'Asia/Bangkok'
        const utcDate = new Date(startTimestamp * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
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
 * Helper function to calculate reservation end timestamp
 * CRITICAL: Uses Bangkok timezone to avoid timezone conversion issues
 */
async function calculateReservationEndTimestamp(
  startDate: number,
  endDate: number | null,
  endTime: string | null
): Promise<number | null> {
  let endTimestamp: number | null = null

  // Determine which date to use
  if (endDate) {
    // Multiple day: use end_date
    endTimestamp = endDate
  } else {
    // Single day: use start_date
    endTimestamp = startDate
  }

  // Parse end_time if available
  // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
  if (endTime && endTimestamp) {
    const parsed = parseTimeString(endTime)
    if (parsed) {
      try {
        const { TZDate } = await import('@date-fns/tz')
        const BANGKOK_TIMEZONE = 'Asia/Bangkok'
        const utcDate = new Date(endTimestamp * 1000)
        const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
        const year = tzDate.getFullYear()
        const month = tzDate.getMonth()
        const day = tzDate.getDate()
        const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
        endTimestamp = Math.floor(tzDateWithTime.getTime() / 1000)
      } catch (error) {
        console.warn(`Failed to apply end_time:`, error)
      }
    }
  }

  return endTimestamp
}

/**
 * Auto-update bookings based on reservation date/time
 * - pending → cancelled (when past start date/time)
 * - pending_deposit → cancelled (when past start date/time)
 * - confirmed → finished (when past end date/time)
 * Should be called periodically (e.g., via cron job or on admin page load)
 */
export async function autoUpdateFinishedBookings(): Promise<{
  finished: number
  cancelled: number
  updatedBookings: Array<{
    booking: Booking
    oldStatus: string
    newStatus: string
    reason: string
  }>
}> {
  const db = getTursoClient()
  // Use GMT+7 (Bangkok time) for all date comparisons
  const { getBangkokTime } = await import("./timezone")
  const now = getBangkokTime()

  // Find all bookings that need status updates
  // Optimized: Uses idx_bookings_status_start_date for status filtering
  // Note: SQLite can use the index for IN clause with multiple statuses
  // Include deposit_evidence_url for cleanup when cancelling/finishing bookings
  const result = await db.execute({
    sql: `
      SELECT id, start_date, end_date, start_time, end_time, status, deposit_evidence_url
      FROM bookings
      WHERE status IN ('pending', 'pending_deposit', 'paid_deposit', 'confirmed')
      ORDER BY start_date ASC
    `,
  })

  let finishedCount = 0
  let cancelledCount = 0
  const updatedBookings: Array<{
    booking: Booking
    oldStatus: string
    newStatus: string
    reason: string
  }> = []

  console.log(`[autoUpdateFinishedBookings] Processing ${result.rows.length} bookings. Current time (Bangkok): ${new Date(now * 1000).toISOString()}`)
  
  for (const row of result.rows) {
    const bookingRow = row as any
    const startTimestamp = await calculateReservationStartTimestamp(
      bookingRow.start_date,
      bookingRow.start_time
    )
    
    // Debug logging for pending/pending_deposit bookings
    if (bookingRow.status === "pending" || bookingRow.status === "pending_deposit") {
      const startDateStr = bookingRow.start_date ? new Date(bookingRow.start_date * 1000).toISOString() : 'null'
      const startTimestampStr = startTimestamp ? new Date(startTimestamp * 1000).toISOString() : 'null'
      console.log(`[autoUpdateFinishedBookings] ${bookingRow.status} booking ${bookingRow.id}: start_date=${startDateStr}, start_time=${bookingRow.start_time || 'null'}, startTimestamp=${startTimestampStr}, now=${new Date(now * 1000).toISOString()}, shouldCancel=${startTimestamp && startTimestamp < now}`)
    }
    
    // Check pending, pending_deposit, and paid_deposit bookings - cancel if start date passed
    if (bookingRow.status === "pending" || bookingRow.status === "pending_deposit" || bookingRow.status === "paid_deposit") {
      // If start date has passed, cancel the booking (no response received before reservation start date)
      // For bookings without start_time, compare the date itself (not time)
      let shouldCancel = false
      
      if (bookingRow.start_time && startTimestamp) {
        // Has start_time: compare timestamp directly (already in Bangkok timezone)
        shouldCancel = startTimestamp < now
        console.log(`[autoUpdateFinishedBookings] ${bookingRow.status} booking ${bookingRow.id} with start_time: startTimestamp=${new Date(startTimestamp * 1000).toISOString()}, now=${new Date(now * 1000).toISOString()}, shouldCancel=${shouldCancel}`)
      } else if (bookingRow.start_date) {
        // No start_time: compare dates (if start_date is before today, cancel)
        // Get today's date in Bangkok timezone (at start of day)
        const { TZDate } = await import('@date-fns/tz')
        const BANGKOK_TIMEZONE = 'Asia/Bangkok'
        const nowDate = new Date(now * 1000)
        const tzNow = new TZDate(nowDate.getTime(), BANGKOK_TIMEZONE)
        const todayYear = tzNow.getFullYear()
        const todayMonth = tzNow.getMonth()
        const todayDay = tzNow.getDate()
        const todayStart = new TZDate(todayYear, todayMonth, todayDay, 0, 0, 0, BANGKOK_TIMEZONE)
        const todayStartTimestamp = Math.floor(todayStart.getTime() / 1000)
        
        // Also convert start_date to Bangkok timezone start of day for fair comparison
        const startDateUtc = new Date(bookingRow.start_date * 1000)
        const tzStartDate = new TZDate(startDateUtc.getTime(), BANGKOK_TIMEZONE)
        const startYear = tzStartDate.getFullYear()
        const startMonth = tzStartDate.getMonth()
        const startDay = tzStartDate.getDate()
        const startDateStart = new TZDate(startYear, startMonth, startDay, 0, 0, 0, BANGKOK_TIMEZONE)
        const startDateStartTimestamp = Math.floor(startDateStart.getTime() / 1000)
        
        // If start_date (start of day) is before today (start of day), cancel it
        shouldCancel = startDateStartTimestamp < todayStartTimestamp
        console.log(`[autoUpdateFinishedBookings] ${bookingRow.status} booking ${bookingRow.id} has no start_time: start_date=${new Date(bookingRow.start_date * 1000).toISOString()}, startDateStart=${new Date(startDateStartTimestamp * 1000).toISOString()}, today_start=${new Date(todayStartTimestamp * 1000).toISOString()}, shouldCancel=${shouldCancel}`)
      }
      
      if (shouldCancel) {
        console.log(`[autoUpdateFinishedBookings] Cancelling ${bookingRow.status} booking ${bookingRow.id} - start date/time has passed`)
        const newStatus = "cancelled"
        const changeReason = bookingRow.status === "pending"
          ? "Automatically cancelled: reservation start date/time has passed without deposit confirmation"
          : bookingRow.status === "pending_deposit"
          ? "Automatically cancelled: reservation start date/time has passed without deposit upload"
          : "Automatically cancelled: reservation start date/time has passed without confirmed deposit"

        // Update status with optimistic locking
        await dbTransaction(async (tx) => {
          // Get current updated_at for version check
          const currentResult = await tx.execute({
            sql: "SELECT updated_at FROM bookings WHERE id = ?",
            args: [bookingRow.id],
          })
          
          if (currentResult.rows.length === 0) {
            // Booking was deleted, skip
            return
          }
          
          const currentUpdatedAt = (currentResult.rows[0] as any).updated_at
          
          // Update with version check (optimistic locking)
          const updateResult = await tx.execute({
            sql: "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
            args: [newStatus, now, bookingRow.id, currentUpdatedAt],
          })
          
          // If no rows affected, booking was modified - skip this update
          if (updateResult.rowsAffected === 0) {
            console.log(`Skipping auto-update for booking ${bookingRow.id} - booking was modified`)
            return
          }

          // Record in status history
          const historyId = randomUUID()
          await tx.execute({
            sql: `
              INSERT INTO booking_status_history (
                id, booking_id, old_status, new_status, changed_by, change_reason, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              historyId,
              bookingRow.id,
              bookingRow.status,
              newStatus,
              "system",
              changeReason,
              now,
            ],
          })
        })

        // Delete deposit evidence image if it exists (for pending_deposit bookings)
        if (bookingRow.deposit_evidence_url) {
          try {
            const { deleteImage } = await import("./blob")
            await deleteImage(bookingRow.deposit_evidence_url)
            console.log(`[autoUpdateFinishedBookings] Deleted deposit evidence blob for cancelled booking ${bookingRow.id}`, { blobUrl: bookingRow.deposit_evidence_url })
          } catch (blobError) {
            // Log error but continue - queue cleanup job as fallback
            console.error(`[autoUpdateFinishedBookings] Failed to delete deposit evidence blob for booking ${bookingRow.id}:`, blobError)
            
            // Queue cleanup job for retry (fail-safe approach)
            try {
              const { enqueueJob } = await import("./job-queue")
              await enqueueJob("cleanup-orphaned-blob", { blobUrl: bookingRow.deposit_evidence_url }, { priority: 1 })
              console.log(`[autoUpdateFinishedBookings] Queued orphaned blob cleanup job for deposit evidence`, { blobUrl: bookingRow.deposit_evidence_url })
            } catch (queueError) {
              console.error(`[autoUpdateFinishedBookings] Failed to queue orphaned blob cleanup:`, queueError)
            }
          }
        }

        // Fetch full booking details for notification
        try {
          const fullBookingResult = await db.execute({
            sql: "SELECT * FROM bookings WHERE id = ?",
            args: [bookingRow.id],
          })
          
          if (fullBookingResult.rows.length > 0) {
            const fullBooking = formatBooking(fullBookingResult.rows[0] as any)
            updatedBookings.push({
              booking: fullBooking,
              oldStatus: bookingRow.status,
              newStatus,
              reason: changeReason,
            })

            // Send cancellation email to user
            // Fix #7: Duplicate prevention is handled in sendBookingStatusNotification
            try {
              const emailBooking = { ...fullBooking, status: "cancelled" as const }
              await sendBookingStatusNotification(emailBooking, "cancelled", {
                changeReason: changeReason,
              })
              console.log(`Cancellation email sent to user for booking ${bookingRow.id} (pending/postponed - start date passed)`)
            } catch (emailError) {
              console.error(`Failed to send cancellation email to user for booking ${bookingRow.id}:`, emailError)
              // Continue even if email fails
            }
          }
        } catch (error) {
          console.error(`Failed to fetch full booking details for ${bookingRow.id}:`, error)
          // Continue even if we can't fetch full details
        }

        cancelledCount++
        continue // Skip end date check for this booking
      }
    }

    const endTimestamp = await calculateReservationEndTimestamp(
      bookingRow.start_date,
      bookingRow.end_date,
      bookingRow.end_time
    )

    // Check if end timestamp has passed
    if (endTimestamp && endTimestamp < now) {
      // Only confirmed bookings can reach here (pending/pending_deposit are handled by start date check above)
      if (bookingRow.status === "confirmed") {
        // Confirmed bookings become finished
        const newStatus = "finished"
        const changeReason = "Automatically updated: reservation end date/time has passed"
        finishedCount++

        // Update status with optimistic locking
        await dbTransaction(async (tx) => {
          // Get current updated_at for version check
          const currentResult = await tx.execute({
            sql: "SELECT updated_at FROM bookings WHERE id = ?",
            args: [bookingRow.id],
          })
          
          if (currentResult.rows.length === 0) {
            // Booking was deleted, skip
            return
          }
          
          const currentUpdatedAt = (currentResult.rows[0] as any).updated_at
          
          // Update with version check (optimistic locking)
          const updateResult = await tx.execute({
            sql: "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
            args: [newStatus, now, bookingRow.id, currentUpdatedAt],
          })
          
          // If no rows affected, booking was modified - skip this update
          if (updateResult.rowsAffected === 0) {
            console.log(`Skipping auto-update for booking ${bookingRow.id} - booking was modified`)
            return
          }

          // Record in status history
          const historyId = randomUUID()
          await tx.execute({
            sql: `
              INSERT INTO booking_status_history (
                id, booking_id, old_status, new_status, changed_by, change_reason, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              historyId,
              bookingRow.id,
              bookingRow.status,
              newStatus,
              "system",
              changeReason,
              now,
            ],
          })
        })

        // Delete deposit evidence image if it exists (for finished bookings)
        // Note: You may want to keep deposit images for records, but cleaning them up saves storage
        if (bookingRow.deposit_evidence_url) {
          try {
            const { deleteImage } = await import("./blob")
            await deleteImage(bookingRow.deposit_evidence_url)
            console.log(`[autoUpdateFinishedBookings] Deleted deposit evidence blob for finished booking ${bookingRow.id}`, { blobUrl: bookingRow.deposit_evidence_url })
          } catch (blobError) {
            // Log error but continue - queue cleanup job as fallback
            console.error(`[autoUpdateFinishedBookings] Failed to delete deposit evidence blob for booking ${bookingRow.id}:`, blobError)
            
            // Queue cleanup job for retry (fail-safe approach)
            try {
              const { enqueueJob } = await import("./job-queue")
              await enqueueJob("cleanup-orphaned-blob", { blobUrl: bookingRow.deposit_evidence_url }, { priority: 1 })
              console.log(`[autoUpdateFinishedBookings] Queued orphaned blob cleanup job for deposit evidence`, { blobUrl: bookingRow.deposit_evidence_url })
            } catch (queueError) {
              console.error(`[autoUpdateFinishedBookings] Failed to queue orphaned blob cleanup:`, queueError)
            }
          }
        }

        // Fetch full booking details for notification
        try {
          const fullBookingResult = await db.execute({
            sql: "SELECT * FROM bookings WHERE id = ?",
            args: [bookingRow.id],
          })
          
          if (fullBookingResult.rows.length > 0) {
            const fullBooking = formatBooking(fullBookingResult.rows[0] as any)
            updatedBookings.push({
              booking: fullBooking,
              oldStatus: bookingRow.status,
              newStatus,
              reason: changeReason,
            })

            // Send finished email to user
            try {
              const emailBooking = { ...fullBooking, status: "finished" as const }
              await sendBookingStatusNotification(emailBooking, "finished", {
                changeReason: changeReason,
              })
              console.log(`Finished email sent to user for booking ${bookingRow.id}`)
            } catch (emailError) {
              console.error(`Failed to send finished email to user for booking ${bookingRow.id}:`, emailError)
              // Continue even if email fails
            }
          }
        } catch (error) {
          console.error(`Failed to fetch full booking details for ${bookingRow.id}:`, error)
          // Continue even if we can't fetch full details
        }
      }
    }
  }

  // Send admin notification if there are any updates
  if (updatedBookings.length > 0) {
    try {
      await sendAdminAutoUpdateNotification(updatedBookings)
    } catch (emailError) {
      console.error("Failed to send admin auto-update notification:", emailError)
      // Don't fail the function if email fails
    }
  }

  return {
    finished: finishedCount,
    cancelled: cancelledCount,
    updatedBookings,
  }
}

/**
 * Generate a secure token for user response
 */
export function generateResponseToken(): string {
  return randomBytes(32).toString("hex")
}

/**
 * Update booking status
 */
export async function updateBookingStatus(
  bookingId: string,
  newStatus: "pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished",
  options?: {
    changedBy?: string
    changeReason?: string
    adminNotes?: string
    proposedDate?: string | null
    proposedEndDate?: string | null
    sendNotification?: boolean
    depositEvidenceUrl?: string | null
    depositVerifiedBy?: string | null
    depositVerifiedFromOtherChannel?: boolean
  }
): Promise<Booking> {
  return await dbTransaction(async (db) => {
    // Get current booking
    const currentResult = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    if (currentResult.rows.length === 0) {
      throw new Error(`Booking with id ${bookingId} not found`)
    }

    const currentBooking = currentResult.rows[0] as any
    const oldStatus = currentBooking.status
    
    // Validate status transition (backend validation for security)
    if (oldStatus !== newStatus) {
      const { isValidStatusTransition } = await import("./booking-validations")
      if (!isValidStatusTransition(oldStatus, newStatus)) {
        throw new Error(
          `Invalid status transition from "${oldStatus}" to "${newStatus}". This transition is not allowed.`
        )
      }
    }

    // Handle deposit verification when admin accepts deposit
    let finalStatus = newStatus
    let needsDepositVerification = false
    let depositVerifiedBy = options?.depositVerifiedBy
    
    // When accepting deposit (paid_deposit -> confirmed), set deposit verification
    // Normal flow: paid_deposit -> confirmed (without other channel flag)
    if (newStatus === "confirmed" && oldStatus === "paid_deposit" && options?.changedBy && !options?.depositVerifiedFromOtherChannel) {
      needsDepositVerification = true
      depositVerifiedBy = options?.depositVerifiedBy || options?.changedBy || "Admin"
    }

    // Special case: When confirming from pending_deposit via other channel
    if (newStatus === "confirmed" && oldStatus === "pending_deposit" && options?.depositVerifiedFromOtherChannel && options?.changedBy) {
      needsDepositVerification = true
      depositVerifiedBy = options?.depositVerifiedBy || options?.changedBy || "Admin"
    }

    // Special case: When confirming from paid_deposit via other channel
    if (newStatus === "confirmed" && oldStatus === "paid_deposit" && options?.depositVerifiedFromOtherChannel && options?.changedBy) {
      needsDepositVerification = true
      depositVerifiedBy = options?.depositVerifiedBy || options?.changedBy || "Admin"
    }

    // Check for overlaps when setting status to confirmed (from paid_deposit)
    // This prevents creating overlapping confirmed bookings
    if (finalStatus === "confirmed" && oldStatus !== "confirmed") {
        const overlapCheck = await checkBookingOverlap(
          bookingId,
        currentBooking.start_date,
        currentBooking.end_date || null,
          currentBooking.start_time,
          currentBooking.end_time
        )
        
        if (overlapCheck.overlaps) {
          const overlappingNames = overlapCheck.overlappingBookings
            ?.map((b: any) => b.name || "Unknown")
            .join(", ") || "existing booking"
          throw new Error(
          `Cannot confirm booking: the selected date and time overlaps with an existing confirmed booking (${overlappingNames}). Please choose a different date or resolve the conflict first.`
          )
      }
    }

    // Update booking status
    const now = Math.floor(Date.now() / 1000)
    const updateFields: string[] = ["status = ?", "updated_at = ?"]
    const updateArgs: any[] = [finalStatus, now]
    
    // Handle deposit verification if needed (for checked-in carry-over)
    if (needsDepositVerification && depositVerifiedBy) {
      updateFields.push("deposit_verified_at = ?")
      updateArgs.push(now)
      updateFields.push("deposit_verified_by = ?")
      updateArgs.push(depositVerifiedBy)
    }

    if (options?.adminNotes !== undefined) {
      updateFields.push("admin_notes = ?")
      updateArgs.push(options.adminNotes)
    }

    // Determine which dates to use for token expiration calculation
    // Use current booking dates (no proposed dates in new flow)
    let effectiveStartDate = currentBooking.start_date
    let effectiveEndDate = currentBooking.end_date
    let effectiveDateRange = currentBooking.date_range || 0
    
    // Generate response token for pending_deposit status (to allow deposit upload)
    let responseToken: string | null = null
    let tokenExpiresAt: number | null = null
    
    // Token regeneration prevention: Check if token was recently generated (within last 10 seconds)
    // This prevents rapid token regeneration when admin clicks same action multiple times
    const TOKEN_REGENERATION_COOLDOWN = 10 // seconds
    const tokenRecentlyGenerated = currentBooking.updated_at && 
      (now - currentBooking.updated_at) < TOKEN_REGENERATION_COOLDOWN &&
      currentBooking.response_token &&
      currentBooking.token_expires_at &&
      currentBooking.token_expires_at > now
    
    // Determine if we need to generate/regenerate a token
    // Token is needed for pending_deposit status (user can upload deposit)
    const needsNewToken = 
      // Generate for pending_deposit if coming from pending (admin accepts booking)
      (finalStatus === "pending_deposit" && oldStatus === "pending") ||
      // Generate if booking doesn't have a token yet
      !currentBooking.response_token ||
      // Generate if existing token is expired
      (currentBooking.token_expires_at && currentBooking.token_expires_at < now)
    
    // Prevent rapid token regeneration: if token was recently generated and status hasn't changed, preserve it
    if (tokenRecentlyGenerated && oldStatus === finalStatus && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
      // Same status, token recently generated - preserve existing token to prevent invalidation
      responseToken = currentBooking.response_token
      tokenExpiresAt = currentBooking.token_expires_at
      // Don't add to updateFields - keep existing token
      console.log(`Preserving existing token for booking ${bookingId} (recently generated, preventing rapid regeneration)`)
    } 
    else if (needsNewToken && (finalStatus === "pending_deposit" || finalStatus === "pending")) {
      // Generate new token
      responseToken = generateResponseToken()
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      
      // Calculate token expiration: expires exactly at booking start date/time (Bangkok timezone)
      const { calculateStartTimestamp } = await import("./booking-validations")
      const startTimestamp = calculateStartTimestamp(
        effectiveStartDate,
        currentBooking.start_time || null
      )
      
      // Token expires at start date/time
      tokenExpiresAt = startTimestamp
      
      updateFields.push("token_expires_at = ?")
      updateArgs.push(tokenExpiresAt)
    } else if (finalStatus === "pending_deposit") {
      // For pending_deposit status, preserve existing token if valid
      // Token is only needed for deposit upload, which is only for pending_deposit
      if (currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
        responseToken = currentBooking.response_token
        tokenExpiresAt = currentBooking.token_expires_at
        // Don't update - preserve existing token
      } else if (!currentBooking.response_token || (currentBooking.token_expires_at && currentBooking.token_expires_at < now)) {
        // If token is missing or expired, generate a new one
        // This handles the case where booking transitions to pending_deposit without a valid token
        responseToken = generateResponseToken()
        updateFields.push("response_token = ?")
        updateArgs.push(responseToken)
        
        // Calculate token expiration: expires exactly at booking start date/time (Bangkok timezone)
        const { calculateStartTimestamp } = await import("./booking-validations")
        const startTimestamp = calculateStartTimestamp(
          effectiveStartDate,
          currentBooking.start_time || null
        )
        
        tokenExpiresAt = startTimestamp
        updateFields.push("token_expires_at = ?")
        updateArgs.push(tokenExpiresAt)
        
        console.log(`[updateBookingStatus] Generated new token for pending_deposit status (token was missing/expired), expires at: ${new Date(tokenExpiresAt * 1000).toISOString()}`)
      }
    }
    // Note: confirmed status doesn't need tokens for deposit upload (deposit already verified)
    
    // When rejecting deposit (pending_deposit -> pending_deposit), generate new token for deposit re-upload
    // Token expires at original booking start date/time (Bangkok timezone)
    // This happens when admin rejects deposit and user needs to re-upload
    if (finalStatus === "pending_deposit" && oldStatus === "pending_deposit" && options?.changedBy && currentBooking.deposit_evidence_url) {
      // Check if start date has passed - if so, cancel booking instead
      const { calculateStartTimestamp } = await import("./booking-validations")
      const { getBangkokTime } = await import("./timezone")
      const bangkokNow = getBangkokTime()
      const startTimestamp = calculateStartTimestamp(
        currentBooking.start_date,
        currentBooking.start_time || null
      )
      
      if (startTimestamp < bangkokNow) {
        // Start date passed - cancel booking instead of rejecting deposit
        finalStatus = "cancelled"
        // Update status field
        updateFields[0] = "status = ?"
        updateArgs[0] = finalStatus
        console.log(`[updateBookingStatus] Start date passed, cancelling booking instead of rejecting deposit`)
      } else {
        // Generate new token with expiration at start date/time (same as original)
      responseToken = generateResponseToken()
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      
        // Token expires exactly at booking start date/time (Bangkok timezone)
        tokenExpiresAt = startTimestamp
      updateFields.push("token_expires_at = ?")
      updateArgs.push(tokenExpiresAt)
      
        console.log(`[updateBookingStatus] Generated new token for deposit rejection, expires at start date/time: ${new Date(tokenExpiresAt * 1000).toISOString()}`)
      }
      
      // Clear deposit evidence URL and verification fields when rejecting
      updateFields.push("deposit_evidence_url = NULL")
      updateFields.push("deposit_verified_at = NULL")
      updateFields.push("deposit_verified_by = NULL")
    }

    // Handle date changes for confirmed bookings (admin manually changes dates)
    // Date changes are handled separately via change_date action, not through status updates
    // No proposed date logic needed in new flow

    // Clear user_response and response_date when admin cancels
    if (finalStatus === "cancelled" && options?.changedBy) {
      updateFields.push("user_response = NULL")
      updateFields.push("response_date = NULL")
    }
    // Otherwise, preserve user_response for context

    // Handle deposit evidence URL update
    if (options?.depositEvidenceUrl !== undefined) {
      updateFields.push("deposit_evidence_url = ?")
      updateArgs.push(options.depositEvidenceUrl)
    }

    // Clear verification fields when user uploads new deposit evidence (status changes to pending_deposit)
    // This happens when deposit is rejected and user re-uploads
    if (finalStatus === "pending_deposit" && options?.depositEvidenceUrl !== undefined && oldStatus === "pending_deposit") {
      // New deposit upload after rejection - clear any existing verification
        updateFields.push("deposit_verified_at = NULL")
        updateFields.push("deposit_verified_by = NULL")
    }

    // Handle deposit verification (only set when admin explicitly verifies)
    // Check that depositVerifiedBy is provided and not empty
    if (options?.depositVerifiedBy !== undefined && 
        options.depositVerifiedBy !== null && 
        typeof options.depositVerifiedBy === 'string' && 
        options.depositVerifiedBy.trim() !== "") {
      updateFields.push("deposit_verified_by = ?")
      updateArgs.push(options.depositVerifiedBy.trim())
      updateFields.push("deposit_verified_at = ?")
      updateArgs.push(now)
    }

    // Handle deposit_verified_from_other_channel flag
    // Only update this column if it's explicitly provided or when confirming
    // For deposit uploads (pending_deposit -> paid_deposit), we don't touch this column
    if (options?.depositVerifiedFromOtherChannel !== undefined) {
      updateFields.push("deposit_verified_from_other_channel = ?")
      updateArgs.push(options.depositVerifiedFromOtherChannel ? 1 : 0)
    } else if (finalStatus === "confirmed" && (oldStatus === "pending_deposit" || oldStatus === "paid_deposit")) {
      // If confirming but flag not explicitly set, default to false (normal flow)
      // Only set this when confirming, not when uploading deposit
      updateFields.push("deposit_verified_from_other_channel = 0")
    }
    // For other status changes (like pending_deposit -> paid_deposit), we don't update this column
    // This prevents errors if the column doesn't exist yet (database not reinitialized)

    // Optimistic locking: Check if booking was modified since we read it
    // This prevents race conditions when multiple admins act simultaneously
    const originalUpdatedAt = currentBooking.updated_at
    
    // Update with version check (optimistic locking)
    const updateResult = await db.execute({
      sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
      args: [...updateArgs, bookingId, originalUpdatedAt],
    })
    
    // Check if update succeeded (rows affected > 0)
    // If rows affected = 0, booking was modified by another process
    if (updateResult.rowsAffected === 0) {
      throw new Error(
        "Booking was modified by another process. Please refresh the page and try again."
      )
    }

    // Record status change in history
    if (oldStatus !== finalStatus) {
      const historyId = randomUUID()
      await db.execute({
        sql: `
          INSERT INTO booking_status_history (
            id, booking_id, old_status, new_status, changed_by, change_reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          historyId,
          bookingId,
          oldStatus,
          finalStatus,
          options?.changedBy || null,
          options?.changeReason || null,
          now,
        ],
      })
    }

    // Fetch updated booking
    const result = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    const updatedBooking = formatBooking(result.rows[0] as any)
    
    // Invalidate cache for this booking
    invalidateCache(CacheKeys.booking(bookingId))
    
    // Invalidate token cache if token exists
    if (currentBooking.response_token) {
      invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // If new token was generated, invalidate old token cache
    if (responseToken && currentBooking.response_token && responseToken !== currentBooking.response_token) {
      invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // Invalidate list caches (bookings list may have changed)
    invalidateCache('bookings:list')
    
    return updatedBooking
  })
}

/**
 * Get booking status history
 */
export async function getBookingStatusHistory(
  bookingId: string
): Promise<BookingStatusHistory[]> {
  const db = getTursoClient()

  // Optimized: Uses idx_status_history_booking_id index for fast booking lookup
  const result = await db.execute({
    sql: `
      SELECT * FROM booking_status_history 
      WHERE booking_id = ?
      ORDER BY created_at DESC
    `,
    args: [bookingId],
  })

  return result.rows.map((row: any) => ({
    id: row.id,
    bookingId: row.booking_id,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    changedBy: row.changed_by,
    changeReason: row.change_reason,
    createdAt: row.created_at,
  }))
}

/**
 * Log admin action
 */
export async function logAdminAction(data: {
  actionType: string
  resourceType: string
  resourceId?: string
  adminEmail?: string
  adminName?: string
  description?: string
  metadata?: any
}): Promise<void> {
  const db = getTursoClient()
  const actionId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await db.execute({
    sql: `
      INSERT INTO admin_actions (
        id, action_type, resource_type, resource_id, admin_email, admin_name,
        description, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      actionId,
      data.actionType,
      data.resourceType,
      data.resourceId || null,
      data.adminEmail || null,
      data.adminName || null,
      data.description || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    ],
  })
}

/**
 * Format booking from database row
 * CRITICAL: Converts timestamps to Bangkok timezone date strings (YYYY-MM-DD) instead of ISO strings
 * to avoid timezone conversion issues
 */
export function formatBooking(row: any): Booking {
  // Helper to convert timestamp to Bangkok timezone date string
  const timestampToBangkokDateString = (timestamp: number): string => {
    const { TZDate } = require('@date-fns/tz')
    const { format } = require('date-fns')
    const BANGKOK_TIMEZONE = 'Asia/Bangkok'
    const utcDate = new Date(timestamp * 1000)
    const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
    return format(tzDate, 'yyyy-MM-dd')
  }
  
  // Generate reference number if missing (for backward compatibility with old records)
  const getReferenceNumber = (): string => {
    if (row.reference_number) {
      return row.reference_number
    }
    // For old records without reference_number, generate one based on ID
    // Use last 8 characters of UUID and convert to base36-like format
    const idPart = row.id.replace(/-/g, '').slice(-8)
    const numValue = parseInt(idPart, 16) % 46656 // 36^3
    return `HU-${numValue.toString(36).toUpperCase().padStart(3, '0')}${randomInt(0, 1296).toString(36).toUpperCase().padStart(2, '0')}`
  }
  
  return {
    id: row.id,
    referenceNumber: getReferenceNumber(),
    name: row.name,
    email: row.email,
    phone: row.phone,
    participants: row.participants,
    eventType: row.event_type,
    otherEventType: row.other_event_type,
    dateRange: Boolean(row.date_range),
    startDate: row.start_date ? timestampToBangkokDateString(row.start_date) : null,
    endDate: row.end_date ? timestampToBangkokDateString(row.end_date) : null,
    startTime: row.start_time,
    endTime: row.end_time,
    organizationType: row.organization_type as "Tailor Event" | "Space Only" | "" | undefined,
    organizedPerson: row.organized_person,
    introduction: row.introduction,
    biography: row.biography,
    specialRequests: row.special_requests,
    status: row.status as "pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished",
    adminNotes: row.admin_notes,
    responseToken: row.response_token,
    tokenExpiresAt: row.token_expires_at,
    proposedDate: row.proposed_date ? timestampToBangkokDateString(row.proposed_date) : null,
    proposedEndDate: row.proposed_end_date ? timestampToBangkokDateString(row.proposed_end_date) : null,
    userResponse: row.user_response,
    responseDate: row.response_date,
    depositEvidenceUrl: row.deposit_evidence_url || null,
    depositVerifiedAt: row.deposit_verified_at || null,
    depositVerifiedBy: row.deposit_verified_by || null,
    depositVerifiedFromOtherChannel: Boolean(row.deposit_verified_from_other_channel) || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Get booking by response token
 * Also checks if token is expired
 */
export async function getBookingByToken(token: string): Promise<Booking | null> {
  // Check cache first
  const cacheKey = CacheKeys.bookingByToken(token)
  const cached = getCached<Booking>(cacheKey)
  if (cached) {
    return cached
  }

  // Fetch from database
  const db = getTursoClient()
  // Use GMT+7 (Bangkok time) for token expiration check
  const { getBangkokTime } = await import("./timezone")
  const now = getBangkokTime()

  // Optimized: Uses idx_bookings_response_token index for fast token lookup
  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE response_token = ?",
    args: [token],
  })

  if (result.rows.length === 0) {
    // Log for debugging - check if there are any bookings with NULL token that might need one
    console.warn(`[getBookingByToken] No booking found with token: ${token.substring(0, 8)}...`)
    return null
  }

  const booking = result.rows[0] as any

  // Check if token is expired
  if (booking.token_expires_at && booking.token_expires_at < now) {
    // Token expired - log for debugging
    // CRITICAL: Format timestamps in Bangkok timezone for debug logging
    const { TZDate } = await import('@date-fns/tz')
    const { format } = await import('date-fns')
    const BANGKOK_TIMEZONE = 'Asia/Bangkok'
    const expiredDate = new TZDate(booking.token_expires_at * 1000, BANGKOK_TIMEZONE)
    const currentDate = new TZDate(now * 1000, BANGKOK_TIMEZONE)
    const expiredAtStr = format(expiredDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
    const currentTimeStr = format(currentDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
    console.warn(`[getBookingByToken] Token expired for booking ${booking.id}. Expired at: ${expiredAtStr}, Current time: ${currentTimeStr}`)
    return null
  }
  
  // Log successful token lookup for debugging
  console.log(`[getBookingByToken] Found booking ${booking.id} with valid token. Status: ${booking.status}`)

  const formattedBooking = formatBooking(booking)
  
  // Cache for shorter time (2 minutes) since tokens are time-sensitive
  setCached(cacheKey, formattedBooking, 120)
  
  return formattedBooking
}

/**
 * Submit user response to booking
 */
export async function submitUserResponse(
  bookingId: string,
  response: "accept" | "propose" | "cancel" | "check-in",
  options?: {
    proposedDate?: string
    proposedEndDate?: string
    proposedStartTime?: string
    proposedEndTime?: string
    message?: string
  }
): Promise<Booking> {
  return await dbTransaction(async (db) => {
    const now = Math.floor(Date.now() / 1000)

    // Get current booking to check status
    const currentResult = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    if (currentResult.rows.length === 0) {
      throw new Error(`Booking with id ${bookingId} not found`)
    }

    const currentBooking = currentResult.rows[0] as any
    const oldStatus = currentBooking.status

    let newStatus: string
    let userResponseText: string
    let proposedTimestamp: number | null = null
    let proposedEndTimestamp: number | null = null
    let dateRange: number = currentBooking.date_range || 0

    if (response === "check-in") {
      // Check-in is only allowed for accepted bookings
      if (oldStatus !== "accepted") {
        throw new Error("Check-in is only available for accepted bookings")
      }
      newStatus = "checked-in"
      userResponseText = "User confirmed check-in"
    } else if (response === "accept") {
      newStatus = "pending"
      userResponseText = "User accepted the proposed date"
      // If accepting a proposal, update date_range if proposed dates indicate multiple days
      if (currentBooking.proposed_end_date && currentBooking.proposed_end_date !== currentBooking.proposed_date) {
        dateRange = 1 // Multiple days
      } else {
        dateRange = 0 // Single day
      }
    } else if (response === "propose") {
      // User proposes new date - status becomes "postponed" (from any status)
      newStatus = "postponed"
      if (options?.proposedDate) {
            // Validate proposed dates using GMT+7 timezone
            const { getBangkokTime, createBangkokTimestamp } = await import("./timezone")
            const { validateProposedDates } = await import("./booking-validations")

            // Validate proposed date is in the future (GMT+7)
            const validation = await validateProposedDates(
              options.proposedDate,
              options.proposedEndDate || null,
              currentBooking.start_date
            )

            if (!validation.valid) {
              // Format error message to be caught by withErrorHandling as validation error
              const errorMessage = validation.reason || "Invalid proposed date"
              const error = new Error(errorMessage)
              error.name = 'ValidationError'
              throw error
            }
        
        // Create timestamps using GMT+7
        // Extract date part from ISO string if needed (API might receive ISO strings)
        const dateString = options.proposedDate.includes('T') 
          ? options.proposedDate.split('T')[0] 
          : options.proposedDate
        proposedTimestamp = createBangkokTimestamp(dateString, options.proposedStartTime || null)
        
        // Build time information
        const timeInfo: string[] = []
        if (options?.proposedStartTime) {
          timeInfo.push(`Start Time: ${options.proposedStartTime}`)
        }
        if (options?.proposedEndTime) {
          timeInfo.push(`End Time: ${options.proposedEndTime}`)
        }
        const timeText = timeInfo.length > 0 ? ` (${timeInfo.join(", ")})` : ""
        
        // Check if multiple days (proposedEndDate provided and different from proposedDate)
        if (options?.proposedEndDate && options.proposedEndDate !== options.proposedDate) {
          // Extract date part from ISO string if needed
          const endDateString = options.proposedEndDate.includes('T') 
            ? options.proposedEndDate.split('T')[0] 
            : options.proposedEndDate
          proposedEndTimestamp = createBangkokTimestamp(endDateString, options.proposedEndTime || null)
          userResponseText = `User proposed alternative dates: ${options.proposedDate} to ${options.proposedEndDate}${timeText}`
          dateRange = 1 // Multiple days
        } else {
          userResponseText = `User proposed alternative date: ${options.proposedDate}${timeText}`
          dateRange = 0 // Single day
        }
      } else {
        userResponseText = "User proposed alternative date: N/A"
      }
    } else {
      // cancel - allowed from pending, accepted, or postponed
      newStatus = "cancelled"
      userResponseText = "User cancelled the booking"
    }

    // Generate/regenerate response token for postponed status (to ensure user gets email with valid token)
    let responseToken: string | null = null
    let tokenExpiresAt: number | null = null
    if (newStatus === "postponed") {
      // Always generate new token when user proposes (status becomes postponed)
      // This ensures user gets a valid token for future access
      responseToken = generateResponseToken()
      
      // Calculate token expiration: reservation end date or 30 days from now, whichever is earlier
      const thirtyDaysFromNow = now + (30 * 24 * 60 * 60) // 30 days in seconds
      
      // Use proposed dates if available, otherwise use original dates
      let reservationEndDate: number | null = null
      if (proposedEndTimestamp) {
        reservationEndDate = proposedEndTimestamp
      } else if (proposedTimestamp) {
        reservationEndDate = proposedTimestamp
      } else if (currentBooking.end_date) {
        reservationEndDate = currentBooking.end_date
      } else {
        reservationEndDate = currentBooking.start_date
      }
      
      // Add end time if available
      // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
      if (currentBooking.end_time && reservationEndDate !== null) {
        const parsed = parseTimeString(currentBooking.end_time)
        if (parsed) {
          try {
            const { TZDate } = await import('@date-fns/tz')
            const BANGKOK_TIMEZONE = 'Asia/Bangkok'
            const utcDate = new Date(reservationEndDate * 1000)
            const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
            const year = tzDate.getFullYear()
            const month = tzDate.getMonth()
            const day = tzDate.getDate()
            const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
            reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
          } catch (error) {
            // Fallback to date without time
          }
        }
      }
      
      tokenExpiresAt = reservationEndDate !== null ? Math.min(reservationEndDate, thirtyDaysFromNow) : thirtyDaysFromNow
    } else if (newStatus === "cancelled" || newStatus === "checked-in") {
      // Don't generate token for cancelled or checked-in
      responseToken = null
      tokenExpiresAt = null
    } else {
      // For other statuses, preserve existing token if valid, otherwise generate new one
      if (currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
        responseToken = currentBooking.response_token
        tokenExpiresAt = currentBooking.token_expires_at
      } else {
        responseToken = generateResponseToken()
        const thirtyDaysFromNow = now + (30 * 24 * 60 * 60)
        let reservationEndDate: number | null = null
        if (currentBooking.end_date) {
          reservationEndDate = currentBooking.end_date
        } else {
          reservationEndDate = currentBooking.start_date
        }
        // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
        if (currentBooking.end_time && reservationEndDate !== null) {
          const parsed = parseTimeString(currentBooking.end_time)
          if (parsed) {
            try {
              const { TZDate } = await import('@date-fns/tz')
              const BANGKOK_TIMEZONE = 'Asia/Bangkok'
              const utcDate = new Date(reservationEndDate * 1000)
              const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
              const year = tzDate.getFullYear()
              const month = tzDate.getMonth()
              const day = tzDate.getDate()
              const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
              reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
            } catch (error) {
              // Fallback
            }
          }
        }
        tokenExpiresAt = reservationEndDate !== null ? Math.min(reservationEndDate, thirtyDaysFromNow) : thirtyDaysFromNow
      }
    }

    // Update booking
    const updateFields: string[] = [
      "status = ?",
      "user_response = ?",
      "response_date = ?",
      "proposed_date = ?",
      "proposed_end_date = ?",
      "date_range = ?",
      "updated_at = ?"
    ]
    const updateArgs: any[] = [
        newStatus,
        userResponseText + (options?.message ? `\n\nMessage: ${options.message}` : ""),
        now,
        proposedTimestamp,
        proposedEndTimestamp,
        dateRange,
        now,
    ]

    // CRITICAL: Preserve deposit_verified_at when postponing a checked-in booking
    // This ensures original dates remain blocked until admin accepts the new proposed date
    if (newStatus === "postponed" && oldStatus === "checked-in" && currentBooking.deposit_verified_at) {
      updateFields.push("deposit_verified_at = ?")
      updateArgs.push(currentBooking.deposit_verified_at)
      if (currentBooking.deposit_verified_by) {
        updateFields.push("deposit_verified_by = ?")
        updateArgs.push(currentBooking.deposit_verified_by)
      }
    }

    // Add token update if token was generated
    if (responseToken !== null) {
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      if (tokenExpiresAt !== null) {
        updateFields.push("token_expires_at = ?")
        updateArgs.push(tokenExpiresAt)
      }
    }

    updateArgs.push(bookingId) // Add bookingId at the end for WHERE clause

    await db.execute({
      sql: `
        UPDATE bookings 
        SET ${updateFields.join(", ")}
        WHERE id = ?
      `,
      args: updateArgs,
    })

    // Record in status history
    const historyId = randomUUID()
    await db.execute({
      sql: `
        INSERT INTO booking_status_history (
          id, booking_id, old_status, new_status, changed_by, change_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        historyId,
        bookingId,
        oldStatus,
        newStatus,
        "user",
        userResponseText,
        now,
      ],
    })

    // Fetch updated booking
    const result = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    const updatedBooking = formatBooking(result.rows[0] as any)
    
    // Invalidate cache for this booking
    invalidateCache(CacheKeys.booking(bookingId))
    
    // Invalidate token cache if token exists
    if (currentBooking.response_token) {
      invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // If new token was generated, invalidate old token cache
    if (responseToken && currentBooking.response_token && responseToken !== currentBooking.response_token) {
      invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // Invalidate list caches (bookings list may have changed)
    invalidateCache('bookings:list')
    
    return updatedBooking
  })
}

