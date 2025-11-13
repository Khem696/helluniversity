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
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in" | "paid_deposit" | "pending_deposit"
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
  status?: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished"
  statuses?: ("pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished")[]
  excludeArchived?: boolean // Exclude finished, rejected, cancelled from main list
  limit?: number
  offset?: number
  startDateFrom?: number
  startDateTo?: number
  email?: string
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

  // Exclude archived statuses (finished, rejected, cancelled) from main list
  if (options?.excludeArchived) {
    conditions.push("status NOT IN ('finished', 'rejected', 'cancelled')")
  }

  if (options?.startDateFrom) {
    conditions.push("start_date >= ?")
    args.push(options.startDateFrom)
  }

  if (options?.startDateTo) {
    conditions.push("start_date <= ?")
    args.push(options.startDateTo)
  }

  if (options?.email) {
    conditions.push("email = ?")
    args.push(options.email)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  // Get total count
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM bookings ${whereClause}`,
    args,
  })
  const total = (countResult.rows[0] as any).count

  // Get bookings
  const result = await db.execute({
    sql: `
      SELECT * FROM bookings 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, limit, offset],
  })

  return {
    bookings: result.rows.map((row: any) => formatBooking(row)),
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
 * - accepted → cancelled (when past start date/time without check-in)
 * - accepted → finished (when past end date/time)
 * - checked-in → finished (when past end date/time)
 * - pending → cancelled (when past start date/time, no response received)
 * - postponed → cancelled (when past start date/time, no response received)
 * Should be called periodically (e.g., via cron job or on admin page load)
 * 
 * Note: For postponed bookings that were accepted by admin, the start_date and end_date
 * are already updated to use the proposed dates (see updateBookingStatus lines 519-543),
 * so the auto-update will correctly use the new dates, not the original ones.
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
  const result = await db.execute({
    sql: `
      SELECT id, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE status IN ('accepted', 'pending', 'postponed', 'checked-in', 'paid_deposit')
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

  for (const row of result.rows) {
    const bookingRow = row as any
    const startTimestamp = await calculateReservationStartTimestamp(
      bookingRow.start_date,
      bookingRow.start_time
    )
    
    // Check accepted bookings - cancel if past start date + time (grace period) without deposit
    if (bookingRow.status === "accepted") {
      // Use grace period: cancel when past end of start date + time
      const { CHECK_IN_GRACE_PERIOD } = await import("./booking-validations")
      const gracePeriodEnd = startTimestamp ? startTimestamp + CHECK_IN_GRACE_PERIOD : 0
      
      // If start date + grace period has passed and no deposit uploaded, cancel the booking
      if (startTimestamp && gracePeriodEnd < now) {
        const newStatus = "cancelled"
        const changeReason = "Automatically cancelled: reservation start date/time has passed without check-in confirmation (grace period expired)"

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
              console.log(`Cancellation email sent to user for booking ${bookingRow.id} (no check-in before start date)`)
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

    // Check pending and postponed bookings - cancel if start date passed
    if (bookingRow.status === "pending" || bookingRow.status === "postponed") {
      // If start date has passed, cancel the booking (no response received before reservation start date)
      if (startTimestamp && startTimestamp < now) {
        const newStatus = "cancelled"
        const changeReason = "Automatically cancelled: reservation start date/time has passed without response"

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
      // Only accepted and checked-in bookings can reach here (pending/postponed are handled by start date check above)
      if (bookingRow.status === "accepted" || bookingRow.status === "checked-in") {
        // Accepted and checked-in bookings become finished
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
  newStatus: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in" | "paid_deposit" | "pending_deposit",
  options?: {
    changedBy?: string
    changeReason?: string
    adminNotes?: string
    proposedDate?: string | null
    proposedEndDate?: string | null
    sendNotification?: boolean
    depositEvidenceUrl?: string | null
    depositVerifiedBy?: string | null
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

    // Handle deposit carry-over logic when admin accepts user's proposed date
    // This must happen BEFORE we set the status, so we can adjust newStatus if needed
    let finalStatus = newStatus
    let needsDepositVerification = false
    let depositVerifiedBy = options?.depositVerifiedBy
    
    if (newStatus === "accepted" && currentBooking.proposed_date && options?.changedBy) {
      const hasDepositEvidence = currentBooking.deposit_evidence_url
      const wasCheckedIn = oldStatus === "checked-in"
      const wasPaidDeposit = oldStatus === "paid_deposit"
      // Also check if deposit was previously verified (indicates it was checked-in before)
      const wasPreviouslyCheckedIn = currentBooking.deposit_verified_at !== null && currentBooking.deposit_verified_at !== undefined
      
      if (hasDepositEvidence && (wasCheckedIn || wasPreviouslyCheckedIn)) {
        // If already checked-in (or was checked-in before postpone), go directly to checked-in (deposit already verified)
        finalStatus = "checked-in"
        // Set deposit verification fields if not already set
        if (!currentBooking.deposit_verified_at && options?.depositVerifiedBy === undefined) {
          needsDepositVerification = true
          depositVerifiedBy = options?.changedBy || "Admin"
        }
      } else if (hasDepositEvidence && wasPaidDeposit) {
        // If was paid_deposit (not yet checked-in), go to paid_deposit (deposit carries over)
        finalStatus = "paid_deposit"
      }
    }

    // Check for overlaps when setting status to checked-in (from any status)
    // This prevents creating overlapping checked-in bookings
    if (finalStatus === "checked-in" && oldStatus !== "checked-in") {
      // Determine which dates to check
      let checkStartDate: number
      let checkEndDate: number | null
      
      if (currentBooking.proposed_date) {
        // If accepting a proposed date, check proposed dates
        checkStartDate = currentBooking.proposed_date
        checkEndDate = currentBooking.proposed_end_date || null
      } else {
        // Otherwise check original dates
        checkStartDate = currentBooking.start_date
        checkEndDate = currentBooking.end_date || null
      }
      
      if (checkStartDate) {
        const overlapCheck = await checkBookingOverlap(
          bookingId,
          checkStartDate,
          checkEndDate,
          currentBooking.start_time,
          currentBooking.end_time
        )
        
        if (overlapCheck.overlaps) {
          const overlappingNames = overlapCheck.overlappingBookings
            ?.map((b: any) => b.name || "Unknown")
            .join(", ") || "existing booking"
          throw new Error(
            `Cannot check in booking: the selected date and time overlaps with an existing checked-in booking (${overlappingNames}). Please choose a different date or resolve the conflict first.`
          )
        }
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
    // If accepting and there are proposed dates, use those (they will be moved to actual dates)
    // Otherwise, use current booking dates
    let effectiveStartDate = currentBooking.start_date
    let effectiveEndDate = currentBooking.end_date
    let effectiveDateRange = currentBooking.date_range || 0
    
    if ((finalStatus === "accepted" || finalStatus === "paid_deposit" || finalStatus === "checked-in") && currentBooking.proposed_date) {
      // Use proposed dates for token calculation (they will become the actual dates)
      effectiveStartDate = currentBooking.proposed_date
      effectiveEndDate = currentBooking.proposed_end_date || null
      effectiveDateRange = (currentBooking.proposed_end_date && currentBooking.proposed_end_date !== currentBooking.proposed_date) ? 1 : 0
    }

    // Generate response token for postponed, accepted, or pending status (to allow cancellation)
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
    const needsNewToken = 
      // Generate for postponed UNLESS: postponing from accepted and user hasn't uploaded deposit yet (preserve deposit link)
      (finalStatus === "postponed" && !(oldStatus === "accepted" && !currentBooking.deposit_evidence_url && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now)) ||
      // Generate for accepted if coming from pending (new acceptance)
      (finalStatus === "accepted" && oldStatus === "pending") ||
      // Generate for accepted if coming from postponed (admin accepts proposed date)
      (finalStatus === "accepted" && oldStatus === "postponed") ||
      // Generate for pending if it's a new booking or status change
      (finalStatus === "pending" && oldStatus !== "pending") ||
      // Generate if booking doesn't have a token yet
      !currentBooking.response_token ||
      // Generate if existing token is expired
      (currentBooking.token_expires_at && currentBooking.token_expires_at < now) ||
      // Generate for other notification cases (but preserve token for paid_deposit from accepted)
      ((options?.sendNotification && finalStatus !== "pending") && !(finalStatus === "paid_deposit" && oldStatus === "accepted" && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now))
    
    // For paid_deposit from accepted: preserve existing token if valid
    if (finalStatus === "paid_deposit" && oldStatus === "accepted" && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
      // Preserve existing token - don't update it
      responseToken = currentBooking.response_token
      tokenExpiresAt = currentBooking.token_expires_at
      // Don't add to updateFields - keep existing token
    }
    // For postponed from accepted (user hasn't uploaded deposit): preserve existing token to keep deposit link active
    else if (finalStatus === "postponed" && oldStatus === "accepted" && !currentBooking.deposit_evidence_url && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
      // Preserve existing token - user can still upload deposit using the same link
      responseToken = currentBooking.response_token
      tokenExpiresAt = currentBooking.token_expires_at
      // Don't add to updateFields - keep existing token
      console.log(`Preserving deposit upload token for booking ${bookingId} when postponing from accepted (user hasn't uploaded deposit yet)`)
    } 
    // Prevent rapid token regeneration: if token was recently generated and status hasn't changed, preserve it
    else if (tokenRecentlyGenerated && oldStatus === finalStatus && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
      // Same status, token recently generated - preserve existing token to prevent invalidation
      responseToken = currentBooking.response_token
      tokenExpiresAt = currentBooking.token_expires_at
      // Don't add to updateFields - keep existing token
      console.log(`Preserving existing token for booking ${bookingId} (recently generated, preventing rapid regeneration)`)
    } 
    else if (needsNewToken && (finalStatus === "postponed" || finalStatus === "accepted" || finalStatus === "paid_deposit" || finalStatus === "pending_deposit" || finalStatus === "pending")) {
      // Generate new token
      responseToken = generateResponseToken()
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      
      // Calculate token expiration: reservation end date or 30 days from now, whichever is earlier
      // Reuse the 'now' variable declared above (line 428)
      const thirtyDaysFromNow = now + (30 * 24 * 60 * 60) // 30 days in seconds
      
      // Get reservation end date using effective dates
      let reservationEndDate: number | null = null
      if (effectiveEndDate) {
        // Multiple day: use end_date + end_time
        reservationEndDate = effectiveEndDate
        // Parse end_time if available
        if (currentBooking.end_time) {
          const parsed = parseTimeString(currentBooking.end_time)
          if (parsed) {
            try {
              if (reservationEndDate !== null) {
                // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                const { TZDate } = await import('@date-fns/tz')
                const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                const utcDate = new Date(reservationEndDate * 1000)
                const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                const year = tzDate.getFullYear()
                const month = tzDate.getMonth()
                const day = tzDate.getDate()
                const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
              }
            } catch (error) {
              // Fallback to date without time
            }
          }
        }
      } else {
        // Single day: use start_date + end_time
        reservationEndDate = effectiveStartDate
        if (currentBooking.end_time) {
          const parsed = parseTimeString(currentBooking.end_time)
          if (parsed) {
            try {
              if (reservationEndDate !== null) {
                // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                const { TZDate } = await import('@date-fns/tz')
                const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                const utcDate = new Date(reservationEndDate * 1000)
                const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                const year = tzDate.getFullYear()
                const month = tzDate.getMonth()
                const day = tzDate.getDate()
                const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
              }
            } catch (error) {
              // Fallback to date without time
            }
          }
        }
      }
      
      // Token expires at the earlier of: reservation end date or 30 days from now
      if (reservationEndDate && reservationEndDate < thirtyDaysFromNow) {
        tokenExpiresAt = reservationEndDate
      } else {
        tokenExpiresAt = thirtyDaysFromNow
      }
      
      updateFields.push("token_expires_at = ?")
      updateArgs.push(tokenExpiresAt)
    } else if (finalStatus === "paid_deposit" || finalStatus === "accepted" || finalStatus === "checked-in" || finalStatus === "pending_deposit") {
      // For other statuses that need token access, preserve existing token if valid
      if (currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
        responseToken = currentBooking.response_token
        tokenExpiresAt = currentBooking.token_expires_at
        // Don't update - preserve existing token
      } else if (!currentBooking.response_token || (currentBooking.token_expires_at && currentBooking.token_expires_at < now)) {
        // Generate token if missing or expired - these statuses need token access
        responseToken = generateResponseToken()
        updateFields.push("response_token = ?")
        updateArgs.push(responseToken)
        
        // Calculate token expiration
        const thirtyDaysFromNow = now + (30 * 24 * 60 * 60)
        let reservationEndDate: number | null = null
        if (effectiveEndDate) {
          reservationEndDate = effectiveEndDate
          if (currentBooking.end_time) {
            const parsed = parseTimeString(currentBooking.end_time)
            if (parsed) {
              try {
                if (reservationEndDate !== null) {
                  // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                  const { TZDate } = await import('@date-fns/tz')
                  const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                  const utcDate = new Date(reservationEndDate * 1000)
                  const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                  const year = tzDate.getFullYear()
                  const month = tzDate.getMonth()
                  const day = tzDate.getDate()
                  const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                  reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
                }
              } catch (error) {
                // Fallback
              }
            }
          }
        } else {
          reservationEndDate = effectiveStartDate
          if (currentBooking.end_time) {
            const parsed = parseTimeString(currentBooking.end_time)
            if (parsed) {
              try {
                if (reservationEndDate !== null) {
                  // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                  const { TZDate } = await import('@date-fns/tz')
                  const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                  const utcDate = new Date(reservationEndDate * 1000)
                  const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                  const year = tzDate.getFullYear()
                  const month = tzDate.getMonth()
                  const day = tzDate.getDate()
                  const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                  reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
                }
              } catch (error) {
                // Fallback
              }
            }
          }
        }
        
        tokenExpiresAt = reservationEndDate && reservationEndDate < thirtyDaysFromNow ? reservationEndDate : thirtyDaysFromNow
        updateFields.push("token_expires_at = ?")
        updateArgs.push(tokenExpiresAt)
        
        console.log(`[updateBookingStatus] Generated new token for booking ${bookingId} with status ${finalStatus} (token was missing or expired)`)
      }
    }
    
    // When rejecting deposit (paid_deposit -> pending_deposit), generate new token for deposit upload
    if (finalStatus === "pending_deposit" && oldStatus === "paid_deposit") {
      responseToken = generateResponseToken()
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      
      // Calculate token expiration
      const thirtyDaysFromNow = now + (30 * 24 * 60 * 60)
      let reservationEndDate: number | null = null
      if (effectiveEndDate) {
        reservationEndDate = effectiveEndDate
        if (currentBooking.end_time) {
          const parsed = parseTimeString(currentBooking.end_time)
          if (parsed) {
            try {
              if (reservationEndDate !== null) {
                // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                const { TZDate } = await import('@date-fns/tz')
                const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                const utcDate = new Date(reservationEndDate * 1000)
                const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                const year = tzDate.getFullYear()
                const month = tzDate.getMonth()
                const day = tzDate.getDate()
                const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
              }
            } catch (error) {
              // Fallback
            }
          }
        }
      } else {
        reservationEndDate = effectiveStartDate
        if (currentBooking.end_time) {
          const parsed = parseTimeString(currentBooking.end_time)
          if (parsed) {
            try {
              if (reservationEndDate !== null) {
                // CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
                const { TZDate } = await import('@date-fns/tz')
                const BANGKOK_TIMEZONE = 'Asia/Bangkok'
                const utcDate = new Date(reservationEndDate * 1000)
                const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
                const year = tzDate.getFullYear()
                const month = tzDate.getMonth()
                const day = tzDate.getDate()
                const tzDateWithTime = new TZDate(year, month, day, parsed.hour24, parsed.minutes, 0, BANGKOK_TIMEZONE)
                reservationEndDate = Math.floor(tzDateWithTime.getTime() / 1000)
              }
            } catch (error) {
              // Fallback
            }
          }
        }
      }
      
      tokenExpiresAt = reservationEndDate && reservationEndDate < thirtyDaysFromNow ? reservationEndDate : thirtyDaysFromNow
      updateFields.push("token_expires_at = ?")
      updateArgs.push(tokenExpiresAt)
      
      // Clear deposit evidence URL and verification fields
      updateFields.push("deposit_evidence_url = NULL")
      updateFields.push("deposit_verified_at = NULL")
      updateFields.push("deposit_verified_by = NULL")
    }

    // When accepting a booking, move proposed dates to actual booking dates
    // This applies to: accepted, paid_deposit, and checked-in (when accepting a proposed date)
    if ((finalStatus === "accepted" || finalStatus === "paid_deposit" || finalStatus === "checked-in") && currentBooking.proposed_date) {
      // Check for overlaps BEFORE accepting the proposed date
      // We need to check if the proposed date/time overlaps with other checked-in bookings
      const proposedStartTimestamp = currentBooking.proposed_date
      const proposedEndTimestamp = currentBooking.proposed_end_date || currentBooking.proposed_date
      
      // Get proposed times (if user proposed new times, they're in user_response, otherwise use original times)
      // For now, use original times - if user proposed new times, they would be in a different field
      // TODO: If user can propose new times, we need to handle that here
      const proposedStartTime = currentBooking.start_time
      const proposedEndTime = currentBooking.end_time
      
      // Check overlap (exclude current booking from check)
      const overlapCheck = await checkBookingOverlap(
        bookingId,
        proposedStartTimestamp,
        proposedEndTimestamp !== proposedStartTimestamp ? proposedEndTimestamp : null,
        proposedStartTime,
        proposedEndTime
      )
      
      if (overlapCheck.overlaps) {
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        throw new Error(
          `Cannot accept proposed date: it overlaps with an existing checked-in booking (${overlappingNames}). Please ask the user to propose a different date.`
        )
      }
      
      // Move proposed date to start_date
      updateFields.push("start_date = ?")
      updateArgs.push(proposedStartTimestamp)
      
      // Check if it's multiple days
      if (currentBooking.proposed_end_date && currentBooking.proposed_end_date !== currentBooking.proposed_date) {
        // Multiple days: move proposed_end_date to end_date
        const proposedEndTimestamp = currentBooking.proposed_end_date
        updateFields.push("end_date = ?")
        updateArgs.push(proposedEndTimestamp)
        updateFields.push("date_range = ?")
        updateArgs.push(1) // Multiple days
      } else {
        // Single day: clear end_date
        updateFields.push("end_date = NULL")
        updateFields.push("date_range = ?")
        updateArgs.push(0) // Single day
      }
      
      // Clear proposed dates after moving them
      updateFields.push("proposed_date = NULL")
      updateFields.push("proposed_end_date = NULL")
    } else if (finalStatus === "postponed") {
      // CRITICAL: Preserve deposit_verified_at when postponing a checked-in booking
      // This ensures original dates remain blocked until admin accepts the new proposed date
      if (oldStatus === "checked-in" && currentBooking.deposit_verified_at) {
        updateFields.push("deposit_verified_at = ?")
        updateArgs.push(currentBooking.deposit_verified_at)
        if (currentBooking.deposit_verified_by) {
          updateFields.push("deposit_verified_by = ?")
          updateArgs.push(currentBooking.deposit_verified_by)
        }
      }
      
      // If admin is setting postponed from postponed (without proposed date), clear existing proposals
      // This allows admin to "request postpone again" which clears user's proposal and asks for new one
      if (oldStatus === "postponed" && options?.proposedDate === undefined && options?.changedBy) {
        // Admin is requesting postpone again - clear proposed dates to ask user to propose
        // BUT preserve deposit_verified_at if it exists (booking was previously checked-in)
        if (currentBooking.deposit_verified_at) {
          updateFields.push("deposit_verified_at = ?")
          updateArgs.push(currentBooking.deposit_verified_at)
          if (currentBooking.deposit_verified_by) {
            updateFields.push("deposit_verified_by = ?")
            updateArgs.push(currentBooking.deposit_verified_by)
          }
        }
      updateFields.push("proposed_date = NULL")
      updateFields.push("proposed_end_date = NULL")
    } else {
      // Store proposed date if provided (for postponed status)
        // CRITICAL: Use createBangkokTimestamp to handle date strings in Bangkok timezone
      if (options?.proposedDate !== undefined) {
          const { createBangkokTimestamp } = await import('./timezone')
        const proposedTimestamp = options.proposedDate
            ? createBangkokTimestamp(options.proposedDate)
          : null
        updateFields.push("proposed_date = ?")
        updateArgs.push(proposedTimestamp)
      }

      // Store proposed end date if provided (for multiple day proposals)
        // CRITICAL: Use createBangkokTimestamp to handle date strings in Bangkok timezone
      if (options?.proposedEndDate !== undefined) {
          const { createBangkokTimestamp } = await import('./timezone')
        const proposedEndTimestamp = options.proposedEndDate
            ? createBangkokTimestamp(options.proposedEndDate)
          : null
        updateFields.push("proposed_end_date = ?")
        updateArgs.push(proposedEndTimestamp)
      }
      }
    } else {
      // Clear proposed dates when status changes away from postponed
      updateFields.push("proposed_date = NULL")
      updateFields.push("proposed_end_date = NULL")
    }

    // Clear user_response and response_date only when admin is actually responding to user's proposal
    // This preserves user's proposal text when admin is just updating notes or changing unrelated status
    // Clear when:
    // 1. Admin accepts user's proposed date (postponed → accepted/checked-in/paid_deposit)
    // 2. Admin rejects user's proposal (postponed → rejected)
    // 3. Admin postpones again (clears proposal - postponed → postponed without proposed_date)
    // 4. Admin cancels (any status → cancelled)
    const isAdminRespondingToProposal = 
      // Admin accepts user's proposed date
      (oldStatus === "postponed" && currentBooking.proposed_date && 
       (finalStatus === "accepted" || finalStatus === "checked-in" || finalStatus === "paid_deposit")) ||
      // Admin rejects user's proposal
      (oldStatus === "postponed" && currentBooking.proposed_date && finalStatus === "rejected") ||
      // Admin postpones again (clears proposal)
      (finalStatus === "postponed" && oldStatus === "postponed" && !currentBooking.proposed_date) ||
      // Admin cancels (any status)
      (finalStatus === "cancelled" && options?.changedBy)

    if (isAdminRespondingToProposal && options?.changedBy) {
      updateFields.push("user_response = NULL")
      updateFields.push("response_date = NULL")
    }
    // Otherwise, preserve user_response for context (admin might just be updating notes or changing unrelated status)

    // Handle deposit evidence URL update
    if (options?.depositEvidenceUrl !== undefined) {
      updateFields.push("deposit_evidence_url = ?")
      updateArgs.push(options.depositEvidenceUrl)
    }

    // Clear verification fields when user uploads new deposit evidence (status changes to paid_deposit from accepted/pending_deposit)
    // BUT preserve verification if it's a deposit carry-over (from checked-in or paid_deposit with existing evidence)
    if (finalStatus === "paid_deposit" && options?.depositEvidenceUrl !== undefined) {
      const isCarryOver = (oldStatus === "checked-in" || oldStatus === "paid_deposit") && currentBooking.deposit_evidence_url
      if (!isCarryOver) {
        // New deposit upload - clear any existing verification
        updateFields.push("deposit_verified_at = NULL")
        updateFields.push("deposit_verified_by = NULL")
      }
      // If it's a carry-over, keep existing verification fields (don't clear them)
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
    status: row.status as "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in" | "paid_deposit" | "pending_deposit",
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

