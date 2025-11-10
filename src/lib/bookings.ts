import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID, randomBytes } from "crypto"
import { sendAdminAutoUpdateNotification, sendBookingStatusNotification } from "./email"

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
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in"
  adminNotes?: string
  responseToken?: string
  tokenExpiresAt?: number
  proposedDate?: string | null
  proposedEndDate?: string | null
  userResponse?: string
  responseDate?: number
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
 * Create a new booking
 */
export async function createBooking(data: BookingData): Promise<Booking> {
  const db = getTursoClient()
  const bookingId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Convert dates to Unix timestamps
  const startDate = data.startDate
    ? Math.floor(new Date(data.startDate).getTime() / 1000)
    : null

  const endDate = data.endDate
    ? Math.floor(new Date(data.endDate).getTime() / 1000)
    : null

  if (!startDate) {
    throw new Error("Start date is required")
  }

  await db.execute({
    sql: `
      INSERT INTO bookings (
        id, name, email, phone, participants, event_type, other_event_type,
        date_range, start_date, end_date, start_time, end_time,
        organization_type, organized_person, introduction, biography,
        special_requests, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      bookingId,
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

  return formatBooking(result.rows[0] as any)
}

/**
 * Get booking by ID
 */
export async function getBookingById(id: string): Promise<Booking | null> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE id = ?",
    args: [id],
  })

  if (result.rows.length === 0) {
    return null
  }

  return formatBooking(result.rows[0] as any)
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
 * Helper function to calculate reservation end timestamp
 */
function calculateReservationStartTimestamp(
  startDate: number,
  startTime: string | null
): number | null {
  let startTimestamp: number | null = startDate

  // Parse start_time if available
  if (startTime && startTimestamp) {
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

      // Create date from timestamp and add time
      const startDateObj = new Date(startTimestamp * 1000)
      startDateObj.setHours(hour24, minutes || 0, 0, 0)
      startTimestamp = Math.floor(startDateObj.getTime() / 1000)
    } catch (error) {
      console.warn(`Failed to parse start_time:`, error)
      // Fallback: use date without time
    }
  }

  return startTimestamp
}

function calculateReservationEndTimestamp(
  startDate: number,
  endDate: number | null,
  endTime: string | null
): number | null {
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
  if (endTime && endTimestamp) {
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

      // Create date from timestamp and add time
      const endDateObj = new Date(endTimestamp * 1000)
      endDateObj.setHours(hour24, minutes || 0, 0, 0)
      endTimestamp = Math.floor(endDateObj.getTime() / 1000)
    } catch (error) {
      console.warn(`Failed to parse end_time:`, error)
      // Fallback: use date without time
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
  const now = Math.floor(Date.now() / 1000)

  // Find all bookings that need status updates
  const result = await db.execute({
    sql: `
      SELECT id, start_date, end_date, start_time, end_time, status
      FROM bookings
      WHERE status IN ('accepted', 'pending', 'postponed', 'checked-in')
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
    const startTimestamp = calculateReservationStartTimestamp(
      bookingRow.start_date,
      bookingRow.start_time
    )
    
    // Check accepted bookings that haven't been checked in - cancel if start date + grace period passed
    if (bookingRow.status === "accepted") {
      // Fix #4: Use grace period for check-in cancellation
      const { CHECK_IN_GRACE_PERIOD } = await import("./booking-validations")
      const gracePeriodEnd = startTimestamp ? startTimestamp + CHECK_IN_GRACE_PERIOD : 0
      
      // If start date + grace period has passed and user hasn't checked in, cancel the booking
      if (startTimestamp && gracePeriodEnd < now) {
        const newStatus = "cancelled"
        const changeReason = "Automatically cancelled: reservation start date/time has passed without check-in confirmation (grace period expired)"

        // Update status
        await dbTransaction(async (tx) => {
          await tx.execute({
            sql: "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?",
            args: [newStatus, now, bookingRow.id],
          })

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

        // Update status
        await dbTransaction(async (tx) => {
          await tx.execute({
            sql: "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?",
            args: [newStatus, now, bookingRow.id],
          })

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

    const endTimestamp = calculateReservationEndTimestamp(
      bookingRow.start_date,
      bookingRow.end_date,
      bookingRow.end_time
    )

    // Check if end timestamp has passed
    if (endTimestamp && endTimestamp < now) {
      let newStatus: string
      let changeReason: string

      // Only accepted and checked-in bookings can reach here (pending/postponed are handled by start date check above)
      if (bookingRow.status === "accepted" || bookingRow.status === "checked-in") {
        // Accepted and checked-in bookings become finished
        newStatus = "finished"
        changeReason = "Automatically updated: reservation end date/time has passed"
        finishedCount++
      }

      // Update status
      await dbTransaction(async (tx) => {
        await tx.execute({
          sql: "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?",
          args: [newStatus, now, bookingRow.id],
        })

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

        }
      } catch (error) {
        console.error(`Failed to fetch full booking details for ${bookingRow.id}:`, error)
        // Continue even if we can't fetch full details
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
  newStatus: "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in",
  options?: {
    changedBy?: string
    changeReason?: string
    adminNotes?: string
    proposedDate?: string | null
    proposedEndDate?: string | null
    sendNotification?: boolean
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

    // Update booking status
    const now = Math.floor(Date.now() / 1000)
    const updateFields: string[] = ["status = ?", "updated_at = ?"]
    const updateArgs: any[] = [newStatus, now]

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
    
    if (newStatus === "accepted" && currentBooking.proposed_date) {
      // Use proposed dates for token calculation (they will become the actual dates)
      effectiveStartDate = currentBooking.proposed_date
      effectiveEndDate = currentBooking.proposed_end_date || null
      effectiveDateRange = (currentBooking.proposed_end_date && currentBooking.proposed_end_date !== currentBooking.proposed_date) ? 1 : 0
    }

    // Generate response token for postponed, accepted, or pending status (to allow cancellation)
    let responseToken: string | null = null
    let tokenExpiresAt: number | null = null
    
    // Generate token for: postponed (always), accepted/pending (for cancellation)
    if (newStatus === "postponed" || newStatus === "accepted" || newStatus === "pending" || (options?.sendNotification && newStatus !== "pending")) {
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
          try {
            const [timePart, period] = currentBooking.end_time.trim().split(/\s+/)
            const [hours, minutes] = timePart.split(":").map(Number)
            let hour24 = hours
            if (period) {
              if (period.toUpperCase() === "PM" && hour24 !== 12) hour24 += 12
              else if (period.toUpperCase() === "AM" && hour24 === 12) hour24 = 0
            }
            const endDate = new Date(reservationEndDate * 1000)
            endDate.setHours(hour24, minutes || 0, 0, 0)
            reservationEndDate = Math.floor(endDate.getTime() / 1000)
          } catch (error) {
            // Fallback to date without time
          }
        }
      } else {
        // Single day: use start_date + end_time
        reservationEndDate = effectiveStartDate
        if (currentBooking.end_time) {
          try {
            const [timePart, period] = currentBooking.end_time.trim().split(/\s+/)
            const [hours, minutes] = timePart.split(":").map(Number)
            let hour24 = hours
            if (period) {
              if (period.toUpperCase() === "PM" && hour24 !== 12) hour24 += 12
              else if (period.toUpperCase() === "AM" && hour24 === 12) hour24 = 0
            }
            const endDate = new Date(reservationEndDate * 1000)
            endDate.setHours(hour24, minutes || 0, 0, 0)
            reservationEndDate = Math.floor(endDate.getTime() / 1000)
          } catch (error) {
            // Fallback to date without time
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
    }

    // When accepting a booking, move proposed dates to actual booking dates
    if (newStatus === "accepted" && currentBooking.proposed_date) {
      // Move proposed date to start_date
      const proposedStartTimestamp = currentBooking.proposed_date
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
    } else {
      // Store proposed date if provided (for postponed status)
      if (options?.proposedDate !== undefined) {
        const proposedTimestamp = options.proposedDate
          ? Math.floor(new Date(options.proposedDate).getTime() / 1000)
          : null
        updateFields.push("proposed_date = ?")
        updateArgs.push(proposedTimestamp)
      }

      // Store proposed end date if provided (for multiple day proposals)
      if (options?.proposedEndDate !== undefined) {
        const proposedEndTimestamp = options.proposedEndDate
          ? Math.floor(new Date(options.proposedEndDate).getTime() / 1000)
          : null
        updateFields.push("proposed_end_date = ?")
        updateArgs.push(proposedEndTimestamp)
      }
    }

    // Clear user_response and response_date when admin updates status (admin is responding)
    // This makes the response banner disappear until the next user response
    if (options?.changedBy) {
      updateFields.push("user_response = NULL")
      updateFields.push("response_date = NULL")
    }

    await db.execute({
      sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ?`,
      args: [...updateArgs, bookingId],
    })

    // Record status change in history
    if (oldStatus !== newStatus) {
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

    return formatBooking(result.rows[0] as any)
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
 */
export function formatBooking(row: any): Booking {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    participants: row.participants,
    eventType: row.event_type,
    otherEventType: row.other_event_type,
    dateRange: Boolean(row.date_range),
    startDate: row.start_date ? new Date(row.start_date * 1000).toISOString() : null,
    endDate: row.end_date ? new Date(row.end_date * 1000).toISOString() : null,
    startTime: row.start_time,
    endTime: row.end_time,
    organizationType: row.organization_type as "Tailor Event" | "Space Only" | "" | undefined,
    organizedPerson: row.organized_person,
    introduction: row.introduction,
    biography: row.biography,
    specialRequests: row.special_requests,
    status: row.status as "pending" | "accepted" | "rejected" | "postponed" | "cancelled" | "finished" | "checked-in",
    adminNotes: row.admin_notes,
    responseToken: row.response_token,
    tokenExpiresAt: row.token_expires_at,
    proposedDate: row.proposed_date ? new Date(row.proposed_date * 1000).toISOString() : null,
    proposedEndDate: row.proposed_end_date ? new Date(row.proposed_end_date * 1000).toISOString() : null,
    userResponse: row.user_response,
    responseDate: row.response_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Get booking by response token
 * Also checks if token is expired
 */
export async function getBookingByToken(token: string): Promise<Booking | null> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE response_token = ?",
    args: [token],
  })

  if (result.rows.length === 0) {
    return null
  }

  const booking = result.rows[0] as any

  // Check if token is expired
  if (booking.token_expires_at && booking.token_expires_at < now) {
    // Token expired - return null to indicate invalid token
    return null
  }

  return formatBooking(booking)
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
      newStatus = "pending"
      if (options?.proposedDate) {
        proposedTimestamp = Math.floor(new Date(options.proposedDate).getTime() / 1000)
        
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
          proposedEndTimestamp = Math.floor(new Date(options.proposedEndDate).getTime() / 1000)
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

    // Update booking
    await db.execute({
      sql: `
        UPDATE bookings 
        SET 
          status = ?,
          user_response = ?,
          response_date = ?,
          proposed_date = ?,
          proposed_end_date = ?,
          date_range = ?,
          updated_at = ?
        WHERE id = ?
      `,
      args: [
        newStatus,
        userResponseText + (options?.message ? `\n\nMessage: ${options.message}` : ""),
        now,
        proposedTimestamp,
        proposedEndTimestamp,
        dateRange,
        now,
        bookingId,
      ],
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

    return formatBooking(result.rows[0] as any)
  })
}

