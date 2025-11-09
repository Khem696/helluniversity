import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID, randomBytes } from "crypto"

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
  status: "pending" | "accepted" | "rejected" | "postponed" | "cancelled"
  adminNotes?: string
  responseToken?: string
  proposedDate?: string | null
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
  status?: "pending" | "accepted" | "rejected" | "postponed"
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

  if (options?.status) {
    conditions.push("status = ?")
    args.push(options.status)
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
  newStatus: "pending" | "accepted" | "rejected" | "postponed" | "cancelled",
  options?: {
    changedBy?: string
    changeReason?: string
    adminNotes?: string
    proposedDate?: string | null
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

    // Generate response token for postponed status (or if explicitly requested)
    let responseToken: string | null = null
    if (newStatus === "postponed" || (options?.sendNotification && newStatus !== "pending")) {
      responseToken = generateResponseToken()
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
    }

    // Store proposed date if provided (for postponed status)
    if (options?.proposedDate !== undefined) {
      const proposedTimestamp = options.proposedDate
        ? Math.floor(new Date(options.proposedDate).getTime() / 1000)
        : null
      updateFields.push("proposed_date = ?")
      updateArgs.push(proposedTimestamp)
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
function formatBooking(row: any): Booking {
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
    status: row.status as "pending" | "accepted" | "rejected" | "postponed" | "cancelled",
    adminNotes: row.admin_notes,
    responseToken: row.response_token,
    proposedDate: row.proposed_date ? new Date(row.proposed_date * 1000).toISOString() : null,
    userResponse: row.user_response,
    responseDate: row.response_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Get booking by response token
 */
export async function getBookingByToken(token: string): Promise<Booking | null> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: "SELECT * FROM bookings WHERE response_token = ?",
    args: [token],
  })

  if (result.rows.length === 0) {
    return null
  }

  return formatBooking(result.rows[0] as any)
}

/**
 * Submit user response to booking
 */
export async function submitUserResponse(
  bookingId: string,
  response: "accept" | "propose" | "cancel",
  options?: {
    proposedDate?: string
    message?: string
  }
): Promise<Booking> {
  return await dbTransaction(async (db) => {
    const now = Math.floor(Date.now() / 1000)

    let newStatus: string
    let userResponseText: string
    let proposedTimestamp: number | null = null

    if (response === "accept") {
      newStatus = "accepted"
      userResponseText = "User accepted the proposed date"
    } else if (response === "propose") {
      newStatus = "postponed"
      userResponseText = `User proposed alternative date: ${options?.proposedDate || "N/A"}`
      if (options?.proposedDate) {
        proposedTimestamp = Math.floor(new Date(options.proposedDate).getTime() / 1000)
      }
    } else {
      // cancel
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
          updated_at = ?
        WHERE id = ?
      `,
      args: [
        newStatus,
        userResponseText + (options?.message ? `\n\nMessage: ${options.message}` : ""),
        now,
        proposedTimestamp,
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
        "postponed", // Previous status when user responds
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

