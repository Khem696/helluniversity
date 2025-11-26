import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID, randomBytes, randomInt } from "crypto"
import { sendAdminAutoUpdateNotification, sendBookingStatusNotification } from "./email"
import { checkBookingOverlap } from "./booking-validations"
import { getCached, setCached, invalidateCache, CacheKeys } from "./cache"
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { logInfo, logWarn, logError } from "./logger"

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
  feeAmount?: number | null
  feeAmountOriginal?: number | null
  feeCurrency?: string | null
  feeConversionRate?: number | null
  feeRateDate?: number | null
  feeRecordedAt?: number | null
  feeRecordedBy?: string | null
  feeNotes?: string | null
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

export interface BookingFeeHistory {
  id: string
  bookingId: string
  oldFeeAmount: number | null
  oldFeeAmountOriginal: number | null
  oldFeeCurrency: string | null
  oldFeeConversionRate: number | null
  oldFeeRateDate: number | null
  oldFeeNotes: string | null
  newFeeAmount: number | null
  newFeeAmountOriginal: number | null
  newFeeCurrency: string | null
  newFeeConversionRate: number | null
  newFeeRateDate: number | null
  newFeeNotes: string | null
  changedBy: string
  changeReason?: string | null
  bookingStatusAtChange: string
  isRestorationChange: boolean
  createdAt: number
}

/**
 * Generate a short booking reference number using Base36 encoding
 * Format: HU-XXXXXX (e.g., HU-A3K9M2)
 * Uses timestamp + random component for uniqueness
 * 
 * IMPROVED: Increased capacity from 60M to 2.2B combinations
 * - Timestamp part: 3 chars (36^3 = 46,656, wraps every ~12.96 hours)
 * - Random part: 3 chars (36^3 = 46,656 unique values per timestamp window)
 * - Total: 46,656 × 46,656 = 2,176,782,336 unique combinations
 * 
 * This provides sufficient capacity for high-volume booking systems:
 * - Can handle ~3,600 bookings/hour before collision risk (vs 108/hour previously)
 * - At 1,000 bookings/day, collisions unlikely for decades
 * - Still maintains short, readable format (HU-XXXXXX = 8 chars total)
 */
function generateBookingReference(): string {
  // Get current timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000)
  
  // Generate random component (4 bytes = 8 hex chars, convert to base36)
  // Using 4 bytes instead of 3 to ensure sufficient randomness
  const randomBuffer = randomBytes(4)
  const randomValue = parseInt(randomBuffer.toString('hex'), 16)
  
  // Convert to base36 (0-9, A-Z)
  // Timestamp part: 3 chars (36^3 = 46,656, wraps every ~12.96 hours)
  const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
  // Random part: 3 chars (36^3 = 46,656 unique values per timestamp window)
  const randomPart = (randomValue % 46656).toString(36).toUpperCase().padStart(3, '0')
  
  // Combine: HU- + 3 chars timestamp + 3 chars random = HU-XXXXXX (9 chars total)
  const reference = `HU-${timestampPart}${randomPart}`
  
  return reference
}

/**
 * Generate a unique booking reference number with retry logic for collision handling
 * Retries up to 3 times if unique constraint violation occurs
 */
async function generateUniqueBookingReference(
  db: ReturnType<typeof getTursoClient> | Awaited<ReturnType<ReturnType<typeof getTursoClient>['transaction']>>,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const reference = generateBookingReference()
    
    // Check if reference already exists in database
    const checkResult = await db.execute({
      sql: `SELECT id FROM bookings WHERE reference_number = ? LIMIT 1`,
      args: [reference],
    })
    
    if (checkResult.rows.length === 0) {
      // Reference is unique, return it
      return reference
    }
    
    // Reference collision detected (rare but possible with timestamp-based generation)
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Reference number collision detected, generating new reference', {
        attempt: attempt + 1,
        maxRetries,
        referenceType: 'booking',
      })
    } catch {
      // Fallback if logger fails
    }
    // Track monitoring metric
    try {
      const { trackCollisionRetry } = await import('./monitoring')
      trackCollisionRetry('reference', attempt + 1)
    } catch {
      // Ignore monitoring errors
    }
  }
  
  // All retries exhausted (should be very rare)
  throw new Error(`Failed to generate unique booking reference after ${maxRetries} attempts`)
}

/**
 * Create a new booking
 * @param data - Booking data
 * @param referenceNumber - Optional reference number (if not provided, will be generated)
 */
export async function createBooking(data: BookingData, referenceNumber?: string): Promise<Booking> {
  const db = getTursoClient()
  const bookingId = randomUUID()
  
  // CRITICAL: Ensure reference number is unique
  // If provided, check for uniqueness; if not provided or collision, generate unique one
  let finalReferenceNumber: string
  if (referenceNumber) {
    // Check if provided reference number is unique
    const checkResult = await db.execute({
      sql: `SELECT id FROM bookings WHERE reference_number = ? LIMIT 1`,
      args: [referenceNumber],
    })
    
    if (checkResult.rows.length > 0) {
      // Provided reference number collides - generate unique one
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Provided reference number collides, generating unique reference', {
          providedReference: referenceNumber,
          referenceType: 'booking',
        })
      } catch {
        // Fallback if logger fails
      }
      finalReferenceNumber = await generateUniqueBookingReference(db)
    } else {
      // Provided reference number is unique
      finalReferenceNumber = referenceNumber
    }
  } else {
    // No reference provided - generate unique one
    finalReferenceNumber = await generateUniqueBookingReference(db)
  }
  
  // CRITICAL: Use Bangkok time for consistency with business logic
  // All timestamps are stored in UTC, but we use getBangkokTime() for consistency
  const { getBangkokTime } = await import('./timezone')
  const now = getBangkokTime()

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
  await invalidateCache('bookings:list')
  
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
  
  // Debug: Log fee data from database (development only)
  if (process.env.NODE_ENV === 'development') {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('Booking retrieved from database', {
        bookingId: id,
        feeAmount: booking.feeAmount,
        feeCurrency: booking.feeCurrency,
        feeAmountOriginal: booking.feeAmountOriginal,
        hasFee: !!(booking.feeAmount && Number(booking.feeAmount) > 0),
        bookingKeys: Object.keys(booking).filter(k => k.toLowerCase().includes('fee')),
        rawRowFeeAmount: (result.rows[0] as any).fee_amount,
      })
    } catch {
      // Fallback if logger fails
    }
  }
  
  // Cache the result (5 minutes TTL)
  setCached(cacheKey, booking, 300)
  
  return booking
}

/**
 * List bookings with filters
 */
export async function listBookings(options?: {
  status?: "pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished"
  statuses?: ("pending" | "pending_deposit" | "paid_deposit" | "confirmed" | "cancelled" | "finished")[]
  excludeArchived?: boolean // Exclude finished, cancelled from main list
  limit?: number
  offset?: number
  startDateFrom?: number
  startDateTo?: number
  email?: string // Exact match OR contains search (prioritizes exact matches)
  referenceNumber?: string // Exact match OR contains search (prioritizes exact matches)
  name?: string // Exact match OR contains search (prioritizes exact matches)
  phone?: string // Exact match OR contains search (prioritizes exact matches)
  eventType?: string // Exact match filter
  sortBy?: "created_at" | "start_date" | "name" | "updated_at" // Sort field
  sortOrder?: "ASC" | "DESC" // Sort direction
  showOverlappingOnly?: boolean // Filter to show only bookings with overlaps
}): Promise<{ bookings: Booking[]; total: number }> {
  const db = getTursoClient()

  // CRITICAL: Validate and clamp limit/offset to prevent DoS
  // Limit: 1-1000 (default: 50)
  // Offset: 0-1000000 (default: 0, prevents negative or extremely large offsets)
  const limit = Math.max(1, Math.min(1000, options?.limit || 50))
  const offset = Math.max(0, Math.min(1000000, options?.offset || 0))

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
  // BUT: If user is searching, don't exclude archived - let search work across all statuses
  const hasSearchParams = !!(options?.email || options?.referenceNumber || options?.name || options?.phone)
  if (options?.excludeArchived && !hasSearchParams) {
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

  // Search fields that support both exact and contains matching
  // We'll track which fields have search terms for ORDER BY prioritization
  const searchFields: string[] = []

  // Email: exact match OR contains (case-insensitive)
  if (options?.email) {
    const emailLower = options.email.toLowerCase()
    conditions.push("(LOWER(email) = ? OR LOWER(email) LIKE ?)")
    args.push(emailLower, `%${emailLower}%`)
    searchFields.push("email")
  }

  // Reference number: exact match OR contains (case-insensitive)
  if (options?.referenceNumber) {
    const refLower = options.referenceNumber.toLowerCase().trim()
    if (refLower) {
      // Search in reference_number - must have a value (not NULL or empty)
      // Use LIKE for contains search, case-insensitive
      conditions.push("(reference_number IS NOT NULL AND reference_number != '' AND LOWER(reference_number) LIKE ?)")
      args.push(`%${refLower}%`)
      searchFields.push("reference_number")
      // Debug logging (development only)
      if (process.env.NODE_ENV === 'development') {
        try {
          const { logDebug } = await import('./logger')
          await logDebug('Reference number search', {
            searchTerm: refLower,
            searchPattern: `%${refLower}%`,
            condition: "(reference_number IS NOT NULL AND reference_number != '' AND LOWER(reference_number) LIKE ?)",
            argsCount: args.length,
          })
        } catch {
          // Fallback if logger fails
        }
      }
    }
  }

  if (options?.eventType) {
    // Uses idx_bookings_event_type index
    conditions.push("event_type = ?")
    args.push(options.eventType)
  }

  // Name: exact match OR contains (case-insensitive)
  if (options?.name) {
    const nameLower = options.name.toLowerCase()
    conditions.push("(LOWER(name) = ? OR LOWER(name) LIKE ?)")
    args.push(nameLower, `%${nameLower}%`)
    searchFields.push("name")
  }

  // Phone: exact match OR contains
  if (options?.phone) {
    conditions.push("(phone = ? OR phone LIKE ?)")
    args.push(options.phone, `%${options.phone}%`)
    searchFields.push("phone")
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  // Debug logging for search queries (development only)
  const isSearching = !!(options?.referenceNumber || options?.email || options?.name || options?.phone)
  if (isSearching && process.env.NODE_ENV === 'development') {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('Search query', {
        whereClause,
        argsCount: args.length,
        searchFields: {
          referenceNumber: options?.referenceNumber,
          email: options?.email,
          name: options?.name,
          phone: options?.phone,
        },
        excludeArchived: options?.excludeArchived,
        isSearching,
        statuses: options?.statuses,
        status: options?.status,
        willExcludeArchived: options?.excludeArchived && !isSearching,
      })
    } catch {
      // Fallback if logger fails
    }
  }

  // Get total count (optimized: uses indexes for filtering)
  // IMPORTANT: Use the same WHERE clause and args for count as for the main query
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM bookings ${whereClause}`,
    args,
  })
  const total = (countResult.rows[0] as any).count
  
  // Debug logging (development only)
  if (process.env.NODE_ENV === 'development' && isSearching) {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('Count query result', {
        total,
        whereClause,
        argsCount: args.length,
      })
    } catch {
      // Fallback if logger fails
    }
  }
  
  // Debug: Log sample reference numbers and their statuses if searching by reference
  if (options?.referenceNumber) {
    try {
      const sampleResult = await db.execute({
        sql: `SELECT reference_number, id, name, status FROM bookings WHERE reference_number IS NOT NULL LIMIT 10`,
        args: [],
      })
      // Debug logging (development only)
      if (process.env.NODE_ENV === 'development') {
        try {
          const { logDebug } = await import('./logger')
          await logDebug('Sample reference numbers in DB', {
            sampleCount: sampleResult.rows.length,
            samples: sampleResult.rows.map((r: any) => ({
              id: r.id,
              reference_number: r.reference_number,
              name: r.name,
              status: r.status,
            })),
          })
        } catch {
          // Fallback if logger fails
        }
      }
      
      // Check what statuses the matching bookings have
      const matchingResult = await db.execute({
        sql: `SELECT reference_number, id, name, status FROM bookings ${whereClause} LIMIT 10`,
        args,
      })
      
      // Debug logging (development only)
      if (process.env.NODE_ENV === 'development') {
        try {
          const { logDebug } = await import('./logger')
          await logDebug('Matching bookings from search query', {
            matchingCount: matchingResult.rows.length,
            matches: matchingResult.rows.map((r: any) => ({
              id: r.id,
              reference_number: r.reference_number,
              name: r.name,
              status: r.status,
            })),
            totalWithReference: (await db.execute({
              sql: `SELECT COUNT(*) as count FROM bookings WHERE reference_number IS NOT NULL`,
              args: [],
            })).rows[0]?.count,
          })
        } catch {
          // Fallback if logger fails
        }
      }
    } catch (err) {
      try {
        const { logError } = await import('./logger')
        await logError('Error getting sample reference numbers', {
          error: err instanceof Error ? err.message : String(err),
        }, err instanceof Error ? err : new Error(String(err)))
      } catch {
        // Fallback if logger fails
      }
    }
  }
  
  // Debug logging (development only)
  if ((options?.referenceNumber || options?.email || options?.name || options?.phone) && process.env.NODE_ENV === 'development') {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('Search results count', { total })
    } catch {
      // Fallback if logger fails
    }
  }

  // Optimize ORDER BY based on available filters and user preferences to leverage composite indexes
  // Default: created_at DESC (uses idx_bookings_created_at)
  // CRITICAL: Validate sortBy and sortOrder to prevent SQL injection
  const ALLOWED_SORT_FIELDS = ["created_at", "start_date", "name", "updated_at"] as const
  const ALLOWED_SORT_ORDERS = ["ASC", "DESC"] as const
  
  const sortBy = (options?.sortBy && ALLOWED_SORT_FIELDS.includes(options.sortBy as any))
    ? options.sortBy
    : "created_at"
  const sortOrder = (options?.sortOrder && ALLOWED_SORT_ORDERS.includes(options.sortOrder as any))
    ? options.sortOrder
    : "DESC"
  
  // Safe: sortBy and sortOrder are validated against whitelist
  // Build ORDER BY with search match prioritization (exact matches first)
  // We'll add computed columns in SELECT for exact match priority, then order by them
  let exactMatchSelects: string[] = []
  let exactMatchArgs: any[] = []
  
  if (options?.email) {
    const emailLower = options.email.toLowerCase()
    exactMatchSelects.push(`CASE WHEN LOWER(email) = ? THEN 0 ELSE 1 END as email_exact_match`)
    exactMatchArgs.push(emailLower)
  }
  if (options?.referenceNumber) {
    const refLower = options.referenceNumber.toLowerCase().trim()
    if (refLower) {
      exactMatchSelects.push(`CASE WHEN LOWER(COALESCE(reference_number, '')) = ? THEN 0 ELSE 1 END as ref_exact_match`)
      exactMatchArgs.push(refLower)
    }
  }
  if (options?.name) {
    const nameLower = options.name.toLowerCase()
    exactMatchSelects.push(`CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END as name_exact_match`)
    exactMatchArgs.push(nameLower)
  }
  if (options?.phone) {
    exactMatchSelects.push(`CASE WHEN phone = ? THEN 0 ELSE 1 END as phone_exact_match`)
    exactMatchArgs.push(options.phone)
  }
  
  // Build SELECT clause with exact match priority columns
  const selectClause = exactMatchSelects.length > 0
    ? `*, ${exactMatchSelects.join(", ")}`
    : `*`
  
  // Build ORDER BY clause - prioritize exact matches
  let orderByClause = ""
  if (exactMatchSelects.length > 0) {
    const priorityFields = exactMatchSelects.map(select => {
      // Extract the alias from "CASE ... END as alias"
      const match = select.match(/as (\w+)/)
      return match ? match[1] : null
    }).filter(Boolean)
    
    // Order by exact match priorities first (0 = exact, 1 = contains), then user's sort preference
    orderByClause = `ORDER BY ${priorityFields.join(", ")}, ${sortBy} ${sortOrder}`
  } else {
    orderByClause = `ORDER BY ${sortBy} ${sortOrder}`
  }
  
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
  
  // Combine all args: exact match priority args (for SELECT CASE), search args (for WHERE), and limit
  // IMPORTANT: SQL binds parameters in the order they appear in the SQL string
  // Since SELECT clause comes before WHERE clause, exactMatchArgs must come before args
  const allArgs = [...exactMatchArgs, ...args, fetchLimit]
  
  // Debug logging (development only)
  if (process.env.NODE_ENV === 'development' && isSearching) {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('Executing SELECT query', {
        selectClausePreview: selectClause.substring(0, 100) + '...',
        whereClause,
        orderByClause,
        argsCount: allArgs.length,
        argsPreview: allArgs.slice(0, 5), // Log first 5 args for debugging
        fetchLimit,
      })
    } catch {
      // Fallback if logger fails
    }
  }
  
  const result = await db.execute({
    sql: `
      SELECT ${selectClause} FROM bookings 
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET 0
    `,
    args: allArgs,
  })
  
  // Debug logging (development only)
  if (process.env.NODE_ENV === 'development' && isSearching) {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('SELECT query returned', {
        rowCount: result.rows.length,
        hasRows: result.rows.length > 0,
        firstRowKeys: result.rows[0] ? Object.keys(result.rows[0]).slice(0, 10) : null,
      })
      
      await logDebug('Raw DB result', {
        rowCount: result.rows.length,
        firstRowSample: result.rows[0] ? {
          id: result.rows[0].id,
          reference_number: result.rows[0].reference_number,
          name: result.rows[0].name,
          status: result.rows[0].status,
          fee_amount: result.rows[0].fee_amount,
          fee_currency: result.rows[0].fee_currency,
          fee_amount_original: result.rows[0].fee_amount_original,
          hasFee: !!(result.rows[0].fee_amount && Number(result.rows[0].fee_amount) > 0),
          allFeeKeys: Object.keys(result.rows[0]).filter(k => k.toLowerCase().includes('fee')),
        } : null,
        rowsWithFee: result.rows.filter((r: any) => r.fee_amount && Number(r.fee_amount) > 0).length,
      })
    } catch {
      // Fallback if logger fails
    }
  }
  
  let bookings = result.rows.map((row: any) => formatBooking(row))
  
  // Debug logging (development only) - after formatBooking
  if (process.env.NODE_ENV === 'development' && isSearching) {
    try {
      const { logDebug } = await import('./logger')
      await logDebug('After formatBooking', {
        bookingsCount: bookings.length,
        firstBookingSample: bookings[0] ? {
          id: bookings[0].id,
          referenceNumber: bookings[0].referenceNumber,
          name: bookings[0].name,
          status: bookings[0].status,
          feeAmount: bookings[0].feeAmount,
          feeCurrency: bookings[0].feeCurrency,
          feeAmountOriginal: bookings[0].feeAmountOriginal,
          hasFee: !!(bookings[0].feeAmount && Number(bookings[0].feeAmount) > 0),
        } : null,
        bookingsWithFee: bookings.filter((b: Booking) => b.feeAmount && Number(b.feeAmount) > 0).length,
      })
    } catch {
      // Fallback if logger fails
    }
  }

  // Apply overlap filter if enabled
  if (options?.showOverlappingOnly) {
    const { findAllOverlappingBookings } = await import('./booking-validations')
    const bookingsWithOverlaps: Booking[] = []
    
    // Check each booking for overlaps (in parallel for better performance)
    const { createBangkokTimestamp } = await import('./timezone')
    const overlapChecks = await Promise.all(
      bookings.map(async (booking: Booking) => {
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
      .filter((check: { booking: Booking; overlapCount: number }) => check.overlapCount > 0)
      .map((check: { booking: Booking; overlapCount: number }) => check.booking)
    
    // Re-apply sorting after filtering (in case order changed)
    const sortBy = options?.sortBy || "created_at"
    const sortOrder = options?.sortOrder || "DESC"
    bookings.sort((a: Booking, b: Booking) => {
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
    // Log warning asynchronously (non-blocking)
    import('./logger').then(({ logWarn }) => {
      logWarn('Failed to parse time string', {
        timeString,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {
        // Ignore logger errors
      })
    }).catch(() => {
      // Fallback if logger import fails
    })
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
        // Log warning asynchronously (non-blocking)
        import('./logger').then(({ logWarn }) => {
          logWarn('Failed to apply start_time', {
            startTime,
            startDate,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => {
            // Ignore logger errors
          })
        }).catch(() => {
          // Fallback if logger import fails
        })
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

  // CRITICAL: If end_date equals start_date, treat as single-day booking
  // This matches the validation logic in all API routes (isEffectivelySingleDay)
  const isEffectivelySingleDay = !endDate || endDate === startDate

  // Determine which date to use
  if (isEffectivelySingleDay) {
    // Single day (including when end_date === start_date): use start_date
    endTimestamp = startDate
  } else {
    // Multiple day: use end_date
    endTimestamp = endDate
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
        // Log warning asynchronously (non-blocking)
        import('./logger').then(({ logWarn }) => {
          logWarn('Failed to apply end_time', {
            endTime,
            endDate,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => {
            // Ignore logger errors
          })
        }).catch(() => {
          // Fallback if logger import fails
        })
      }
    }
  } else if (!isEffectivelySingleDay && endTimestamp && !endTime) {
    // No endTime for multi-day booking: endDate should represent the END of that day (23:59:59), not the start (00:00:00)
    // This ensures date ranges like "16-21 Nov" don't incorrectly overlap with "22 Nov"
    try {
      const { TZDate } = await import('@date-fns/tz')
      const BANGKOK_TIMEZONE = 'Asia/Bangkok'
      const utcDate = new Date(endTimestamp * 1000)
      const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
      const year = tzDate.getFullYear()
      const month = tzDate.getMonth()
      const day = tzDate.getDate()
      // Set to end of day (23:59:59)
      const tzDateEndOfDay = new TZDate(year, month, day, 23, 59, 59, BANGKOK_TIMEZONE)
      endTimestamp = Math.floor(tzDateEndOfDay.getTime() / 1000)
    } catch (error) {
      // Log warning asynchronously (non-blocking)
      import('./logger').then(({ logWarn }) => {
        logWarn('Failed to set end of day for endDate', {
          endDate,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {
          // Ignore logger errors
        })
      }).catch(() => {
        // Fallback if logger import fails
      })
    }
  }

  // DEFENSIVE: Validate that endTimestamp is not before startDate
  // This provides an additional safety check even though validation exists elsewhere
  // Note: For single-day bookings, endTimestamp might equal startDate (which is valid)
  if (endTimestamp !== null && endTimestamp < startDate) {
    // Log warning asynchronously (non-blocking)
    import('./logger').then(({ logWarn }) => {
      logWarn('Invalid timestamp range: endTimestamp < startDate', {
        endTimestamp,
        endTimestampISO: new Date(endTimestamp * 1000).toISOString(),
        startDate,
        startDateISO: new Date(startDate * 1000).toISOString(),
      }).catch(() => {
        // Ignore logger errors
      })
    }).catch(() => {
      // Fallback if logger import fails
    })
    // Return null to indicate invalid range - caller should handle this
    return null
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
  // CRITICAL: Skip bookings updated in last 15 minutes to avoid conflicts with admin actions
  // This gives admin actions time to complete before cron processes the booking
  // Increased from 5 to 15 minutes to handle slow email sending and long admin operations
  const SKIP_RECENTLY_UPDATED_SECONDS = 15 * 60 // 15 minutes
  const skipThreshold = now - SKIP_RECENTLY_UPDATED_SECONDS
  
  const result = await db.execute({
    sql: `
      SELECT id, start_date, end_date, start_time, end_time, status, deposit_evidence_url, updated_at
      FROM bookings
      WHERE status IN ('pending', 'pending_deposit', 'paid_deposit', 'confirmed')
        AND (updated_at IS NULL OR updated_at < ?)
      ORDER BY start_date ASC
    `,
    args: [skipThreshold],
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
    
    // Check pending, pending_deposit, and paid_deposit bookings - cancel if start date passed
    if (bookingRow.status === "pending" || bookingRow.status === "pending_deposit" || bookingRow.status === "paid_deposit") {
      // If start date has passed, cancel the booking (no response received before reservation start date)
      // For bookings without start_time, compare the date itself (not time)
      let shouldCancel = false
      
      if (bookingRow.start_time && startTimestamp) {
        // Has start_time: compare timestamp directly (already in Bangkok timezone)
        shouldCancel = startTimestamp < now
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
      }
      
      if (shouldCancel) {
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
            await logInfo('Skipping auto-update for booking - booking was modified', { bookingId: bookingRow.id })
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
            await logInfo('Deleted deposit evidence blob for cancelled booking', { bookingId: bookingRow.id, blobUrl: bookingRow.deposit_evidence_url })
          } catch (blobError) {
            // Log error but continue - queue cleanup job as fallback
            await logError('Failed to delete deposit evidence blob for booking', { bookingId: bookingRow.id }, blobError instanceof Error ? blobError : new Error(String(blobError)))
            
            // Queue cleanup job for retry (fail-safe approach)
            try {
              const { enqueueJob } = await import("./job-queue")
              await enqueueJob("cleanup-orphaned-blob", { blobUrl: bookingRow.deposit_evidence_url }, { priority: 1 })
              await logInfo('Queued orphaned blob cleanup job for deposit evidence', { bookingId: bookingRow.id, blobUrl: bookingRow.deposit_evidence_url })
            } catch (queueError) {
              await logError('Failed to queue orphaned blob cleanup', { bookingId: bookingRow.id }, queueError instanceof Error ? queueError : new Error(String(queueError)))
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
            // CRITICAL: Always send cancellation notification - user needs to know booking was cancelled
            try {
              const emailBooking = { ...fullBooking, status: "cancelled" as const }
              await sendBookingStatusNotification(emailBooking, "cancelled", {
                changeReason: changeReason,
                skipDuplicateCheck: true, // Always send - user needs to know booking was cancelled
              })
              await logInfo('Cancellation email sent to user for booking (pending/postponed - start date passed)', { bookingId: bookingRow.id })
            } catch (emailError) {
              await logError('Failed to send cancellation email to user for booking', { bookingId: bookingRow.id }, emailError instanceof Error ? emailError : new Error(String(emailError)))
              // Continue even if email fails
            }
          }
        } catch (error) {
          await logError('Failed to fetch full booking details for booking', { bookingId: bookingRow.id }, error instanceof Error ? error : new Error(String(error)))
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
            await logInfo('Skipping auto-update for booking - booking was modified', { bookingId: bookingRow.id })
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
            await logInfo('Deleted deposit evidence blob for finished booking', { bookingId: bookingRow.id, blobUrl: bookingRow.deposit_evidence_url })
          } catch (blobError) {
            // Log error but continue - queue cleanup job as fallback
            await logError('Failed to delete deposit evidence blob for finished booking', { bookingId: bookingRow.id }, blobError instanceof Error ? blobError : new Error(String(blobError)))
            
            // Queue cleanup job for retry (fail-safe approach)
            try {
              const { enqueueJob } = await import("./job-queue")
              await enqueueJob("cleanup-orphaned-blob", { blobUrl: bookingRow.deposit_evidence_url }, { priority: 1 })
              await logInfo('Queued orphaned blob cleanup job for deposit evidence (finished)', { bookingId: bookingRow.id, blobUrl: bookingRow.deposit_evidence_url })
            } catch (queueError) {
              await logError('Failed to queue orphaned blob cleanup (finished)', { bookingId: bookingRow.id }, queueError instanceof Error ? queueError : new Error(String(queueError)))
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
            // CRITICAL: Always send finished notification - user should know booking is complete
            try {
              const emailBooking = { ...fullBooking, status: "finished" as const }
              await sendBookingStatusNotification(emailBooking, "finished", {
                changeReason: changeReason,
                skipDuplicateCheck: true, // Always send - user needs to know booking is finished
              })
              await logInfo('Finished email sent to user for booking', { bookingId: bookingRow.id })
            } catch (emailError) {
              await logError('Failed to send finished email to user for booking', { bookingId: bookingRow.id }, emailError instanceof Error ? emailError : new Error(String(emailError)))
              // Continue even if email fails
            }
          }
        } catch (error) {
          await logError('Failed to fetch full booking details for finished booking', { bookingId: bookingRow.id }, error instanceof Error ? error : new Error(String(error)))
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
      await logError('Failed to send admin auto-update notification', { updatedCount: updatedBookings.length }, emailError instanceof Error ? emailError : new Error(String(emailError)))
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
 * Generate a unique response token with retry logic for collision handling
 * Retries up to 3 times if unique constraint violation occurs
 */
export async function generateUniqueResponseToken(
  db: ReturnType<typeof getTursoClient> | Awaited<ReturnType<ReturnType<typeof getTursoClient>['transaction']>>,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const token = generateResponseToken()
    
    // Check if token already exists in database
    const checkResult = await db.execute({
      sql: `SELECT id FROM bookings WHERE response_token = ? LIMIT 1`,
      args: [token],
    })
    
    if (checkResult.rows.length === 0) {
      // Token is unique, return it
      return token
    }
    
    // Token collision detected (extremely rare)
    await logWarn('Token collision detected, generating new token', { attempt: attempt + 1, maxRetries })
    // Track monitoring metric
    try {
      const { trackCollisionRetry } = await import('./monitoring')
      trackCollisionRetry('token', attempt + 1)
    } catch {
      // Ignore monitoring errors
    }
  }
  
  // All retries exhausted (should never happen with 32-byte random tokens)
  throw new Error(`Failed to generate unique response token after ${maxRetries} attempts`)
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
  const transactionResult = await dbTransaction(async (db) => {
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

    // Special case: When restoring from cancelled to confirmed without deposit evidence (other channel)
    // This automatically marks deposit as verified via other channel
    if (newStatus === "confirmed" && oldStatus === "cancelled" && options?.depositVerifiedFromOtherChannel && options?.changedBy && !currentBooking.deposit_evidence_url) {
      needsDepositVerification = true
      depositVerifiedBy = options?.depositVerifiedBy || options?.changedBy || "Admin"
    }

    // FIX: Handle deposit verification when restoring to paid_deposit
    // This allows admin to verify deposit when restoring archived booking to paid_deposit
    if (newStatus === "paid_deposit" && options?.depositVerifiedBy && 
        options.depositVerifiedBy !== null && 
        typeof options.depositVerifiedBy === 'string' && 
        options.depositVerifiedBy.trim() !== "") {
      needsDepositVerification = true
      depositVerifiedBy = options.depositVerifiedBy.trim()
    }

    // Check for overlaps when setting status to confirmed (from paid_deposit)
    // This prevents creating overlapping confirmed bookings
    // CRITICAL: Use locked overlap check within transaction to prevent race conditions
    if (finalStatus === "confirmed" && oldStatus !== "confirmed") {
        const { checkBookingOverlapWithLock } = await import("./booking-validations")
        const overlapCheck = await checkBookingOverlapWithLock(
          bookingId,
          currentBooking.start_date,
          currentBooking.end_date || null,
          currentBooking.start_time,
          currentBooking.end_time,
          db // Pass transaction object for locked check
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
    // CRITICAL: Use Bangkok time for consistency with business logic
    const { getBangkokTime } = await import('./timezone')
    const now = getBangkokTime()
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
    // Token is needed for:
    // 1. pending_deposit status (user can upload deposit)
    // 2. paid_deposit status (user can access booking details via token)
    const isPendingToPendingDeposit = finalStatus === "pending_deposit" && oldStatus === "pending"
    const needsNewToken = 
      // Generate for pending_deposit if coming from pending (admin accepts booking)
      isPendingToPendingDeposit ||
      // Generate for pending_deposit if restoring from cancelled (archive restoration)
      (finalStatus === "pending_deposit" && oldStatus === "cancelled") ||
      // Generate for paid_deposit if restoring from cancelled (archive restoration - user needs token to access booking details)
      (finalStatus === "paid_deposit" && oldStatus === "cancelled") ||
      // Generate if booking doesn't have a token yet
      !currentBooking.response_token ||
      // Generate if existing token is expired
      (currentBooking.token_expires_at && currentBooking.token_expires_at < now)
    
    // CRITICAL: Log token generation decision for pending -> pending_deposit transitions
    if (isPendingToPendingDeposit) {
      await logInfo('Token generation decision for pending -> pending_deposit transition', { 
        bookingId, 
        needsNewToken, 
        hasExistingToken: !!currentBooking.response_token, 
        tokenExpired: currentBooking.token_expires_at ? currentBooking.token_expires_at < now : 'N/A' 
      })
    }
    
    // Prevent rapid token regeneration: if token was recently generated and status hasn't changed, preserve it
    if (tokenRecentlyGenerated && oldStatus === finalStatus && currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
      // Same status, token recently generated - preserve existing token to prevent invalidation
      responseToken = currentBooking.response_token
      tokenExpiresAt = currentBooking.token_expires_at
      // Don't add to updateFields - keep existing token
      await logInfo('Preserving existing token for booking (recently generated, preventing rapid regeneration)', { bookingId })
    } 
    else if (needsNewToken && (finalStatus === "pending_deposit" || finalStatus === "pending" || finalStatus === "paid_deposit")) {
      // Generate new token with collision handling
      // CRITICAL: For pending -> pending_deposit, this MUST generate a token
      if (isPendingToPendingDeposit) {
        await logInfo('Generating new token for pending -> pending_deposit transition', { bookingId })
      }
      responseToken = await generateUniqueResponseToken(db)
      updateFields.push("response_token = ?")
      updateArgs.push(responseToken)
      
      // Calculate token expiration: expires exactly at booking start date/time (Bangkok timezone)
      const { calculateStartTimestamp } = await import("./booking-validations")
      const startTimestamp = calculateStartTimestamp(
        effectiveStartDate,
        currentBooking.start_time || null
      )
      
      // FIX: Handle past dates for restored bookings
      // If booking date is in the past, extend token expiration to 30 days from now
      // This allows restoration of past bookings while still having a valid token
      if (startTimestamp < now) {
        // For past dates, set token to expire 30 days from now (allows time for deposit upload)
        tokenExpiresAt = now + (30 * 24 * 60 * 60) // 30 days in seconds
        await logInfo('Booking date is in the past, extending token expiration to 30 days from now for restored booking', { bookingId })
      } else {
        // Normal case: Token expires at start date/time
        tokenExpiresAt = startTimestamp
      }
      
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
        responseToken = await generateUniqueResponseToken(db)
        updateFields.push("response_token = ?")
        updateArgs.push(responseToken)
        
        // Calculate token expiration: expires exactly at booking start date/time (Bangkok timezone)
        const { calculateStartTimestamp } = await import("./booking-validations")
        const startTimestamp = calculateStartTimestamp(
          effectiveStartDate,
          currentBooking.start_time || null
        )
        
        // FIX: Handle past dates for restored bookings
        // If booking date is in the past, extend token expiration to 30 days from now
        if (startTimestamp < now) {
          // For past dates, set token to expire 30 days from now (allows time for deposit upload)
          tokenExpiresAt = now + (30 * 24 * 60 * 60) // 30 days in seconds
          await logInfo('Booking date is in the past, extending token expiration to 30 days from now for restored booking', { bookingId })
        } else {
          // Normal case: Token expires at start date/time
          tokenExpiresAt = startTimestamp
        }
        
        updateFields.push("token_expires_at = ?")
        updateArgs.push(tokenExpiresAt)
        
        await logInfo('Generated new token for pending_deposit status (token was missing/expired)', { bookingId, expiresAt: new Date(tokenExpiresAt * 1000).toISOString() })
      }
    } else if (finalStatus === "paid_deposit") {
      // For paid_deposit status, preserve existing token if valid (user needs token to access booking details)
      // If token is missing or expired, generate a new one
      if (currentBooking.response_token && currentBooking.token_expires_at && currentBooking.token_expires_at > now) {
        responseToken = currentBooking.response_token
        tokenExpiresAt = currentBooking.token_expires_at
        // Don't update - preserve existing token
      } else if (!currentBooking.response_token || (currentBooking.token_expires_at && currentBooking.token_expires_at < now)) {
        // If token is missing or expired, generate a new one
        // This handles the case where booking transitions to paid_deposit without a valid token (e.g., restoration from cancelled)
        responseToken = await generateUniqueResponseToken(db)
        updateFields.push("response_token = ?")
        updateArgs.push(responseToken)
        
        // Calculate token expiration: expires exactly at booking start date/time (Bangkok timezone)
        const { calculateStartTimestamp } = await import("./booking-validations")
        const startTimestamp = calculateStartTimestamp(
          effectiveStartDate,
          currentBooking.start_time || null
        )
        
        // FIX: Handle past dates for restored bookings
        // If booking date is in the past, extend token expiration to 30 days from now
        if (startTimestamp < now) {
          // For past dates, set token to expire 30 days from now (allows time for user to access booking details)
          tokenExpiresAt = now + (30 * 24 * 60 * 60) // 30 days in seconds
          await logInfo('Booking date is in the past, extending token expiration to 30 days from now for restored paid_deposit booking', { bookingId })
        } else {
          // Normal case: Token expires at start date/time
          tokenExpiresAt = startTimestamp
        }
        
        updateFields.push("token_expires_at = ?")
        updateArgs.push(tokenExpiresAt)
        
        await logInfo('Generated new token for paid_deposit status (token was missing/expired)', { bookingId, expiresAt: new Date(tokenExpiresAt * 1000).toISOString() })
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
        await logInfo('Start date passed, cancelling booking instead of rejecting deposit', { bookingId })
      } else {
        // Generate new token with expiration at start date/time (same as original)
        responseToken = await generateUniqueResponseToken(db)
        updateFields.push("response_token = ?")
        updateArgs.push(responseToken)
      
        // Token expires exactly at booking start date/time (Bangkok timezone)
        tokenExpiresAt = startTimestamp
      updateFields.push("token_expires_at = ?")
      updateArgs.push(tokenExpiresAt)
      
        await logInfo('Generated new token for deposit rejection, expires at start date/time', { bookingId, expiresAt: new Date(tokenExpiresAt * 1000).toISOString() })
      }
      
      // Clear deposit evidence URL and verification fields when rejecting or restoring to pending_deposit
      // This happens when:
      // 1. Rejecting deposit (pending_deposit -> pending_deposit)
      // 2. Restoring from cancelled/finished to pending_deposit (archive restoration)
      updateFields.push("deposit_evidence_url = NULL")
      updateFields.push("deposit_verified_at = NULL")
      updateFields.push("deposit_verified_by = NULL")
    }
    
    // Also clear deposit evidence when restoring from cancelled to pending_deposit
    // (The blob is deleted in the API route, but we also need to clear the database field)
    // NOTE: Finished bookings cannot be restored (they are immutable)
    if (finalStatus === "pending_deposit" && 
        oldStatus === "cancelled" &&
        currentBooking.deposit_evidence_url) {
      // Check if deposit_evidence_url hasn't already been cleared above
      if (!updateFields.some(field => field.includes("deposit_evidence_url"))) {
        updateFields.push("deposit_evidence_url = NULL")
        updateFields.push("deposit_verified_at = NULL")
        updateFields.push("deposit_verified_by = NULL")
      }
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
    // CRITICAL: Use updated_at (snake_case) since currentBooking is a raw database row (from line 1010), not a formatted Booking object
    const originalUpdatedAt = currentBooking.updated_at
    
    // IMPROVED: Validate field names before building SQL to prevent injection
    const { validateFieldNames, ALLOWED_BOOKING_FIELDS } = await import('./sql-field-validation')
    const fieldValidation = validateFieldNames(updateFields, ALLOWED_BOOKING_FIELDS)
    
    if (!fieldValidation.valid) {
      throw new Error(
        `Invalid field names in update: ${fieldValidation.errors?.join(', ')}`
      )
    }
    
    // Update with version check (optimistic locking)
    const updateResult = await db.execute({
      sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
      args: [...updateArgs, bookingId, originalUpdatedAt],
    })
    
    // Check if update succeeded (rows affected > 0)
    // If rows affected = 0, booking was modified by another process
    if (updateResult.rowsAffected === 0) {
      // Track monitoring metric
      try {
        const { trackOptimisticLockConflict } = await import('./monitoring')
        trackOptimisticLockConflict('booking', bookingId, { newStatus, oldStatus })
      } catch {
        // Ignore monitoring errors
      }
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
    // CRITICAL: Ensure we get the latest data including any newly generated tokens
    const result = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    if (result.rows.length === 0) {
      throw new Error(`Booking ${bookingId} not found after update`)
    }

    const dbRow = result.rows[0] as any
    const updatedBooking = formatBooking(dbRow)
    
    // CRITICAL: Verify token is present for pending_deposit status
    // For transitions that require a token (pending -> pending_deposit, cancelled -> pending_deposit),
    // throw an error if token is missing to ensure transaction rollback
    const requiresToken = (finalStatus === "pending_deposit" && oldStatus === "pending") ||
                          (finalStatus === "pending_deposit" && oldStatus === "cancelled")
    
    if (requiresToken && !updatedBooking.responseToken) {
      const errorDetails = {
        bookingId,
        oldStatus,
        finalStatus,
        wasTokenGenerated: !!responseToken,
        generatedToken: responseToken || '(null)',
        dbToken: (result.rows[0] as any).response_token || '(null)',
        updateFields: updateFields.filter(f => f.includes('response_token')),
        needsNewToken: true,
      }
      await logError('CRITICAL: Token missing for pending_deposit booking', { ...errorDetails }, new Error('Token generation failed for pending_deposit booking'))
      
      // CRITICAL: Throw error to cause transaction rollback
      // This ensures the booking status is not updated if token generation failed
      throw new Error(
        `Failed to generate deposit upload token for booking ${bookingId}. ` +
        `Token generation is required for ${oldStatus} -> ${finalStatus} transition. ` +
        `This error will cause the transaction to roll back, preventing invalid state.`
      )
    }
    
    // Log warning (non-critical) for other cases where token might be missing
    // This handles edge cases but doesn't require transaction rollback
    if (finalStatus === "pending_deposit" && !updatedBooking.responseToken && !requiresToken) {
      await logWarn('Token missing for pending_deposit booking (non-critical)', {
        bookingId,
        oldStatus,
        finalStatus,
        wasTokenGenerated: !!responseToken,
        generatedToken: responseToken || '(null)',
        dbToken: (result.rows[0] as any).response_token || '(null)',
      })
    }
    
    // Invalidate cache for this booking
    await invalidateCache(CacheKeys.booking(bookingId))
    
    // Invalidate token cache if token exists
    if (currentBooking.response_token) {
      await invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // If new token was generated, invalidate old token cache
    if (responseToken && currentBooking.response_token && responseToken !== currentBooking.response_token) {
      await invalidateCache(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // Invalidate list caches (bookings list may have changed)
    await invalidateCache('bookings:list')
    
    // CRITICAL-1: Store broadcast data to send AFTER transaction commits
    // This prevents broadcasts from being sent if transaction fails or before commit
    const broadcastData = {
      oldStatus,
      finalStatus,
      updatedBooking,
      currentBooking,
      dbRow,
      options,
    }
    
    return { updatedBooking, broadcastData }
  })
  
  // Extract results from transaction
  const { updatedBooking, broadcastData } = transactionResult
  
  // CRITICAL-1: Broadcasts happen AFTER transaction commits successfully
  // This ensures data is committed before clients are notified
  // Only broadcast if transaction succeeded (we have updatedBooking)
  if (updatedBooking) {
    try {
      const { broadcastBookingEvent } = await import('../../app/api/v1/admin/bookings/stream/route')
      const { broadcastUserBookingEvent } = await import('../../app/api/v1/booking/[token]/stream/route')
      
      const { oldStatus, finalStatus, currentBooking, dbRow, options } = broadcastData
      
      // Determine event type based on what changed
      // MEDIUM-4: Always broadcast status changes - if status changed, it's a status change event
      let eventType: 'booking:status_changed' | 'booking:updated' = 'booking:updated'
      if (oldStatus !== finalStatus) {
        eventType = 'booking:status_changed'
        // MEDIUM-4: Status change always triggers broadcast (handled below)
      } else {
        // MEDIUM-4: Even if status didn't change, if booking was updated, broadcast it
        eventType = 'booking:updated'
      }
      
      // Check if user response was added/updated
      const hasUserResponse = updatedBooking.userResponse && updatedBooking.responseDate
      const hadUserResponse = currentBooking.user_response && currentBooking.response_date
      const isNewUserResponse = hasUserResponse && (!hadUserResponse || updatedBooking.responseDate !== currentBooking.response_date)
      
      // Check if deposit was uploaded
      const hasDeposit = updatedBooking.depositEvidenceUrl
      const hadDeposit = currentBooking.deposit_evidence_url
      const isNewDeposit = hasDeposit && !hadDeposit
      
      // Check if deposit was verified (only when deposit_verified_at actually changes)
      // Explicit null/undefined checks for extra safety
      const currentDepositVerifiedAt = currentBooking.deposit_verified_at ?? null
      const updatedDepositVerifiedAt = updatedBooking.depositVerifiedAt ?? null
      
      // Deposit is verified if deposit_verified_at changed:
      // 1. Changed from null to a value (new verification), OR
      // 2. Timestamp increased (re-verification or update)
      // NOTE: Status change to confirmed does NOT imply new verification if deposit was already verified
      // We only broadcast verification events when the timestamp actually changes to avoid false notifications
      const depositWasVerified = updatedDepositVerifiedAt !== null && 
        (currentDepositVerifiedAt === null || updatedDepositVerifiedAt !== currentDepositVerifiedAt)
      
      // CRITICAL-4: Fetch fresh booking data AFTER transaction commits to prevent staleness
      // This ensures broadcast data matches the committed state
      const { getTursoClient } = await import('./turso')
      const { prepareBookingDataForSSE } = await import('./booking-sse-data')
      const db = getTursoClient()
      const freshBookingRow = await db.execute({
        sql: "SELECT * FROM bookings WHERE id = ?",
        args: [updatedBooking.id],
      })
      
      if (freshBookingRow.rows.length === 0) {
        // Booking was deleted or doesn't exist - don't broadcast
        const { logWarn } = await import('./logger')
        await logWarn('Cannot broadcast: booking not found after transaction', {
          bookingId: updatedBooking.id,
        })
        return updatedBooking
      }
      
      // Use fresh data from database (guaranteed to match committed state)
      const freshDbRow = freshBookingRow.rows[0] as any
      const bookingData = {
        ...prepareBookingDataForSSE(freshDbRow),
        responseToken: freshDbRow.response_token ?? null, // Include token for user SSE
      }
      
      // HIGH-1: Consolidate broadcasts to prevent duplicate events
      // Send primary event (status change takes priority), then additional events only if needed
      
      // Primary event: Status change (highest priority)
      if (eventType === 'booking:status_changed') {
        await broadcastBookingEvent(
          'booking:status_changed',
          bookingData,
          {
            previousStatus: oldStatus,
            changedBy: options?.changedBy,
            changeReason: options?.changeReason,
            // HIGH-1: Include flags in metadata to indicate what else changed
            hasNewUserResponse: Boolean(isNewUserResponse),
            hasNewDeposit: Boolean(isNewDeposit),
            depositWasVerified: Boolean(depositWasVerified),
          }
        )
        
        // Broadcast to user clients (status change)
        await broadcastUserBookingEvent(
          'booking:status_changed',
          bookingData,
          {
            previousStatus: oldStatus,
            depositWasVerified: depositWasVerified,
          }
        )
        
        // HIGH-1: Don't send separate events if status changed (already included in status_changed metadata)
        // Only send additional events if they happened WITHOUT a status change
      } else {
        // No status change - send specific events for what changed
        
        // Broadcast user response if new response was added (admin only - user already knows they submitted)
        if (isNewUserResponse) {
          await broadcastBookingEvent(
            'booking:user_response',
            bookingData
          )
        }
        
        // Broadcast deposit upload if new deposit was uploaded (admin only - user already knows they uploaded)
        if (isNewDeposit) {
          await broadcastBookingEvent(
            'booking:deposit_uploaded',
            bookingData
          )
        }
        
        // Broadcast deposit verification to user clients (only if no status change)
        if (depositWasVerified) {
          await broadcastUserBookingEvent(
            'booking:deposit_verified',
            bookingData
          )
        }
        
        // Broadcast general update if nothing specific changed but booking was updated
        if (eventType === 'booking:updated' && !isNewUserResponse && !isNewDeposit && !depositWasVerified) {
          await broadcastBookingEvent(
            'booking:updated',
            bookingData
          )
          
          // Also broadcast to user clients for general updates
          await broadcastUserBookingEvent(
            'booking:updated',
            bookingData
          )
        }
      }

      // Broadcast stats update (when booking status changes affect pending count)
      // Only broadcast if status changed to/from pending states that affect stats
      const pendingStatuses = ['pending', 'pending_deposit', 'paid_deposit']
      const oldStatusWasPending = pendingStatuses.includes(oldStatus)
      const newStatusIsPending = pendingStatuses.includes(finalStatus)
      
      if (oldStatusWasPending !== newStatusIsPending || eventType === 'booking:status_changed') {
        try {
          const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
          const { getEmailQueueStats } = await import('./email-queue')
          
          // Get updated stats
          const pendingBookingsResult = await listBookings({
            statuses: ['pending', 'pending_deposit', 'paid_deposit'],
            excludeArchived: true,
            limit: 0,
            offset: 0,
          })
          const emailQueueStats = await getEmailQueueStats()
          const pendingEmailCount = (emailQueueStats.pending || 0) + (emailQueueStats.failed || 0)
          
          await broadcastStatsUpdate({
            bookings: {
              pending: pendingBookingsResult.total,
            },
            emailQueue: {
              pending: emailQueueStats.pending || 0,
              failed: emailQueueStats.failed || 0,
              total: pendingEmailCount,
            },
          })
        } catch (statsBroadcastError) {
          // Don't fail if stats broadcast fails - logging is optional
          const errorMessage = statsBroadcastError instanceof Error ? statsBroadcastError.message : String(statsBroadcastError)
          try {
            const { logWarn } = await import('./logger')
            await logWarn('Failed to broadcast stats update', {
              bookingId: updatedBooking.id,
              error: errorMessage,
            })
          } catch (logError) {
            // Fallback: if logger fails, silently continue (avoid infinite loops)
          }
        }
      }
    } catch (broadcastError) {
      // CRITICAL-2: Log broadcast failures but don't fail the request
      // Broadcasts are best-effort and shouldn't block the main operation
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      
      // Log with structured logger
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to broadcast booking update', {
          bookingId: updatedBooking.id,
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }
  }
  
  return updatedBooking
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
 * Update booking fee
 * Handles fee recording, updates, and clearing with conversion rate tracking
 * 
 * To clear a fee, pass null for feeAmountOriginal and feeCurrency
 */
export async function updateBookingFee(
  bookingId: string,
  feeAmountOriginal: number | null,
  feeCurrency: string | null,
  options?: {
    feeConversionRate?: number | null
    feeAmount?: number | null
    feeNotes?: string | null
    changedBy?: string
    changeReason?: string
    isRestorationChange?: boolean
  }
): Promise<Booking> {
  const { randomUUID } = await import('crypto')
  const { getBangkokTime } = await import('./timezone')
  const { validateFee } = await import('./booking-validations')
  const { invalidateCache, CacheKeys } = await import('./cache')
  
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
    const currentFeeAmount = currentBooking.fee_amount != null ? Number(currentBooking.fee_amount) : null
    
    // Validate status allows fee recording/updating/clearing
    const validation = validateFee(
      feeAmountOriginal,
      feeCurrency,
      options?.feeConversionRate ?? null,
      options?.feeAmount ?? null,
      currentBooking.status,
      currentFeeAmount
    )
    
    if (!validation.valid) {
      throw new Error(validation.reason || "Fee validation failed")
    }

    const now = getBangkokTime()
    
    // Handle fee clearing (null feeAmountOriginal)
    if (feeAmountOriginal === null || feeAmountOriginal === undefined) {
      // Clear all fee fields
      const updateFields: string[] = ["updated_at = ?"]
      const updateArgs: any[] = [now]
      
      updateFields.push("fee_amount = NULL")
      updateFields.push("fee_amount_original = NULL")
      updateFields.push("fee_currency = NULL")
      updateFields.push("fee_conversion_rate = NULL")
      updateFields.push("fee_rate_date = NULL")
      updateFields.push("fee_recorded_at = NULL")
      updateFields.push("fee_recorded_by = NULL")
      
      if (options?.feeNotes !== undefined) {
        updateFields.push("fee_notes = ?")
        updateArgs.push(options.feeNotes || null)
      } else {
        updateFields.push("fee_notes = NULL")
      }
      
      // Validate field names
      const { validateFieldNames, ALLOWED_BOOKING_FIELDS } = await import('./sql-field-validation')
      const fieldValidation = validateFieldNames(updateFields, ALLOWED_BOOKING_FIELDS)
      
      if (!fieldValidation.valid) {
        throw new Error(
          `Invalid field names in update: ${fieldValidation.errors?.join(', ')}`
        )
      }
      
      // Update booking
      const originalUpdatedAt = currentBooking.updated_at
      const updateResult = await db.execute({
        sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
        args: [...updateArgs, bookingId, originalUpdatedAt],
      })
      
      if (updateResult.rowsAffected === 0) {
        throw new Error(
          "Booking was modified by another process. Please refresh the page and try again."
        )
      }
      
      // Record in fee history (clearing fee)
      const historyId = randomUUID()
      await db.execute({
        sql: `
          INSERT INTO booking_fee_history (
            id, booking_id,
            old_fee_amount, old_fee_amount_original, old_fee_currency,
            old_fee_conversion_rate, old_fee_rate_date, old_fee_notes,
            new_fee_amount, new_fee_amount_original, new_fee_currency,
            new_fee_conversion_rate, new_fee_rate_date, new_fee_notes,
            changed_by, change_reason, booking_status_at_change, is_restoration_change, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          historyId,
          bookingId,
          currentFeeAmount,
          currentBooking.fee_amount_original != null ? Number(currentBooking.fee_amount_original) : null,
          currentBooking.fee_currency || null,
          currentBooking.fee_conversion_rate != null ? Number(currentBooking.fee_conversion_rate) : null,
          currentBooking.fee_rate_date || null,
          currentBooking.fee_notes || null,
          null, // new_fee_amount
          null, // new_fee_amount_original
          null, // new_fee_currency
          null, // new_fee_conversion_rate
          null, // new_fee_rate_date
          options?.feeNotes || null, // new_fee_notes
          options?.changedBy || "Admin",
          options?.changeReason || "Fee cleared",
          currentBooking.status,
          options?.isRestorationChange ? 1 : 0,
          now,
        ],
      })
      
      // Fetch updated booking
      const result = await db.execute({
        sql: "SELECT * FROM bookings WHERE id = ?",
        args: [bookingId],
      })
      
      const updatedBooking = formatBooking(result.rows[0] as any)
      
      // Invalidate cache
      await invalidateCache(CacheKeys.booking(bookingId))
      await invalidateCache('bookings:list')
      
      return updatedBooking
    }
    
    // Handle fee recording/updating (non-null feeAmountOriginal)
    if (!feeCurrency) {
      throw new Error("feeCurrency is required when recording or updating a fee")
    }
    
    // Calculate missing values
    let finalFeeAmount: number
    let finalConversionRate: number | null = null
    let finalRateDate: number | null = null
    const currencyUpper = feeCurrency.toUpperCase()
    
    if (currencyUpper === "THB") {
      // THB: no conversion needed
      finalFeeAmount = feeAmountOriginal
      finalConversionRate = null
      finalRateDate = null
    } else {
      // Foreign currency: need conversion
      if (options?.feeConversionRate !== null && options?.feeConversionRate !== undefined) {
        // Rate provided, calculate base amount
        finalConversionRate = options.feeConversionRate
        // FIXED: Round to 2 decimal places to prevent floating point precision errors (Issue #17)
        finalFeeAmount = Math.round((feeAmountOriginal * finalConversionRate) * 100) / 100
        finalRateDate = now
      } else if (options?.feeAmount !== null && options?.feeAmount !== undefined) {
        // Base amount provided, calculate rate
        finalFeeAmount = options.feeAmount
        // FIXED: Round to 4 decimal places for conversion rate, then round fee amount (Issue #17)
        finalConversionRate = Math.round((finalFeeAmount / feeAmountOriginal) * 10000) / 10000
        finalFeeAmount = Math.round((feeAmountOriginal * finalConversionRate) * 100) / 100
        finalRateDate = now
      } else {
        throw new Error("Either conversion rate or base amount (THB) must be provided for non-THB currency")
      }
      
      // Validate calculated rate is reasonable
      if (finalConversionRate < 0.01 || finalConversionRate > 10000) {
        throw new Error("Calculated conversion rate is outside reasonable range (0.01 to 10000)")
      }
    }

    // Store old values for history
    const oldFeeAmount = currentBooking.fee_amount != null ? Number(currentBooking.fee_amount) : null
    const oldFeeAmountOriginal = currentBooking.fee_amount_original != null ? Number(currentBooking.fee_amount_original) : null
    const oldFeeCurrency = currentBooking.fee_currency || null
    const oldFeeConversionRate = currentBooking.fee_conversion_rate != null ? Number(currentBooking.fee_conversion_rate) : null
    const oldFeeRateDate = currentBooking.fee_rate_date || null
    const oldFeeNotes = currentBooking.fee_notes || null
    const isFirstRecording = oldFeeAmount === null

    // Determine fee_recorded_at and fee_recorded_by
    // If first recording, set these; if updating, keep original values
    const feeRecordedAt = isFirstRecording ? now : (currentBooking.fee_recorded_at || now)
    const feeRecordedBy = isFirstRecording 
      ? (options?.changedBy || "Admin")
      : (currentBooking.fee_recorded_by || options?.changedBy || "Admin")

    // Build update fields
    const updateFields: string[] = ["updated_at = ?"]
    const updateArgs: any[] = [now]
    
    updateFields.push("fee_amount = ?")
    updateArgs.push(finalFeeAmount)
    
    updateFields.push("fee_amount_original = ?")
    updateArgs.push(feeAmountOriginal)
    
    updateFields.push("fee_currency = ?")
    updateArgs.push(currencyUpper)
    
    if (finalConversionRate !== null) {
      updateFields.push("fee_conversion_rate = ?")
      updateArgs.push(finalConversionRate)
    } else {
      updateFields.push("fee_conversion_rate = NULL")
    }
    
    if (finalRateDate !== null) {
      updateFields.push("fee_rate_date = ?")
      updateArgs.push(finalRateDate)
    } else {
      updateFields.push("fee_rate_date = NULL")
    }
    
    updateFields.push("fee_recorded_at = ?")
    updateArgs.push(feeRecordedAt)
    
    updateFields.push("fee_recorded_by = ?")
    updateArgs.push(feeRecordedBy)
    
    if (options?.feeNotes !== undefined) {
      updateFields.push("fee_notes = ?")
      updateArgs.push(options.feeNotes || null)
    }

    // Validate field names
    const { validateFieldNames, ALLOWED_BOOKING_FIELDS } = await import('./sql-field-validation')
    const fieldValidation = validateFieldNames(updateFields, ALLOWED_BOOKING_FIELDS)
    
    if (!fieldValidation.valid) {
      throw new Error(
        `Invalid field names in update: ${fieldValidation.errors?.join(', ')}`
      )
    }

    // Update booking
    const originalUpdatedAt = currentBooking.updated_at
    const updateResult = await db.execute({
      sql: `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ? AND updated_at = ?`,
      args: [...updateArgs, bookingId, originalUpdatedAt],
    })

    if (updateResult.rowsAffected === 0) {
      throw new Error(
        "Booking was modified by another process. Please refresh the page and try again."
      )
    }

    // Record in fee history
    const historyId = randomUUID()
    await db.execute({
      sql: `
        INSERT INTO booking_fee_history (
          id, booking_id,
          old_fee_amount, old_fee_amount_original, old_fee_currency,
          old_fee_conversion_rate, old_fee_rate_date, old_fee_notes,
          new_fee_amount, new_fee_amount_original, new_fee_currency,
          new_fee_conversion_rate, new_fee_rate_date, new_fee_notes,
          changed_by, change_reason, booking_status_at_change, is_restoration_change, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        historyId,
        bookingId,
        oldFeeAmount,
        oldFeeAmountOriginal,
        oldFeeCurrency,
        oldFeeConversionRate,
        oldFeeRateDate,
        oldFeeNotes,
        finalFeeAmount,
        feeAmountOriginal,
        currencyUpper,
        finalConversionRate,
        finalRateDate,
        options?.feeNotes || null,
        options?.changedBy || "Admin",
        options?.changeReason || null,
        currentBooking.status,
        options?.isRestorationChange ? 1 : 0,
        now,
      ],
    })

    // Fetch updated booking
    const result = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })

    const updatedBooking = formatBooking(result.rows[0] as any)
    const dbRow = result.rows[0] as any
    
    // Invalidate cache
    await invalidateCache(CacheKeys.booking(bookingId))
    await invalidateCache('bookings:list')
    
    // CRITICAL: Broadcast fee update event to admin clients (for real-time updates)
    // Use raw database row data (Unix timestamps, not formatted dates)
    try {
      const { broadcastBookingEvent } = await import('../../app/api/v1/admin/bookings/stream/route')
      
      // Prepare booking data with raw timestamps (Unix timestamps, not date strings)
      // FIXED: Use prepareBookingDataForSSE for consistent data preparation (Bug #83)
      // This ensures all required fields have proper fallbacks and prevents type violations
      const { prepareBookingDataForSSE } = await import('./booking-sse-data')
      const bookingData = prepareBookingDataForSSE(dbRow)
      
      await broadcastBookingEvent('booking:updated', bookingData, {
        changedBy: options?.changedBy,
        changeReason: options?.changeReason || 'Fee updated',
      })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - it's non-critical
      // Use logger if available, otherwise console.warn
      try {
        const { createRequestLogger } = await import('./logger')
        const logger = createRequestLogger('updateBookingFee', 'updateBookingFee')
        await logger.warn('Failed to broadcast fee update event', {
          bookingId,
          error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
        })
      } catch {
        // Fallback to console if logger fails (shouldn't happen, but fail-safe)
        if (process.env.NODE_ENV === 'development') {
          console.warn('Failed to broadcast fee update event', broadcastError)
        }
      }
    }
    
    return updatedBooking
  })
}

/**
 * Get booking fee history
 */
export async function getBookingFeeHistory(
  bookingId: string
): Promise<BookingFeeHistory[]> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: `
      SELECT * FROM booking_fee_history 
      WHERE booking_id = ?
      ORDER BY created_at DESC
    `,
    args: [bookingId],
  })

  return result.rows.map((row: any) => ({
    id: row.id,
    bookingId: row.booking_id,
    oldFeeAmount: row.old_fee_amount != null ? Number(row.old_fee_amount) : null,
    oldFeeAmountOriginal: row.old_fee_amount_original != null ? Number(row.old_fee_amount_original) : null,
    oldFeeCurrency: row.old_fee_currency || null,
    oldFeeConversionRate: row.old_fee_conversion_rate != null ? Number(row.old_fee_conversion_rate) : null,
    oldFeeRateDate: row.old_fee_rate_date || null,
    oldFeeNotes: row.old_fee_notes || null,
    newFeeAmount: row.new_fee_amount != null ? Number(row.new_fee_amount) : null,
    newFeeAmountOriginal: row.new_fee_amount_original != null ? Number(row.new_fee_amount_original) : null,
    newFeeCurrency: row.new_fee_currency || null,
    newFeeConversionRate: row.new_fee_conversion_rate != null ? Number(row.new_fee_conversion_rate) : null,
    newFeeRateDate: row.new_fee_rate_date || null,
    newFeeNotes: row.new_fee_notes || null,
    changedBy: row.changed_by,
    changeReason: row.change_reason || null,
    bookingStatusAtChange: row.booking_status_at_change,
    isRestorationChange: Boolean(Number(row.is_restoration_change)),
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
  // CRITICAL: Use Bangkok time for consistency with business logic
  const { getBangkokTime } = await import('./timezone')
  const now = getBangkokTime()

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
    // FIXED: Use ES6 import instead of require() for consistency
    const BANGKOK_TIMEZONE = 'Asia/Bangkok'
    const utcDate = new Date(timestamp * 1000)
    const tzDate = new TZDate(utcDate.getTime(), BANGKOK_TIMEZONE)
    return format(tzDate, 'yyyy-MM-dd')
  }
  
  // Generate reference number if missing (for backward compatibility with old records)
  // Updated to match new format: 3 chars timestamp + 3 chars random (HU-XXXXXX)
  const getReferenceNumber = (): string => {
    if (row.reference_number) {
      return row.reference_number
    }
    // For old records without reference_number, generate one based on ID
    // Use last 8 characters of UUID and convert to base36-like format
    // Updated to new format: 3 chars + 3 chars (was 3 chars + 2 chars)
    const idPart = row.id.replace(/-/g, '').slice(-8)
    const numValue = parseInt(idPart, 16) % 46656 // 36^3
    const deterministicPart = parseInt(idPart.slice(0, 4), 16) % 46656 // 36^3
    return `HU-${numValue.toString(36).toUpperCase().padStart(3, '0')}${deterministicPart.toString(36).toUpperCase().padStart(3, '0')}`
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
    // Handle deposit_verified_from_other_channel: SQLite stores as INTEGER (0 or 1), need to convert properly
    // Check for null/undefined first, then convert number to boolean
    // IMPORTANT: If deposit_verified_at exists but no deposit_evidence_url, infer other channel verification
    // This handles historical bookings that were verified via other channel before the flag was added
    depositVerifiedFromOtherChannel: (() => {
      const hasVerifiedAt = row.deposit_verified_at != null && row.deposit_verified_at > 0
      const hasEvidenceUrl = row.deposit_evidence_url != null && String(row.deposit_evidence_url).trim() !== ""
      const explicitOtherChannel = row.deposit_verified_from_other_channel != null 
        ? Boolean(Number(row.deposit_verified_from_other_channel))
        : false
      // Infer other channel verification if verified but no evidence (historical data fix)
      const inferredOtherChannel = hasVerifiedAt && !hasEvidenceUrl && !explicitOtherChannel
      return explicitOtherChannel || inferredOtherChannel
    })(),
    feeAmount: row.fee_amount != null ? Number(row.fee_amount) : null,
    feeAmountOriginal: row.fee_amount_original != null ? Number(row.fee_amount_original) : null,
    feeCurrency: row.fee_currency || null,
    feeConversionRate: row.fee_conversion_rate != null ? Number(row.fee_conversion_rate) : null,
    feeRateDate: row.fee_rate_date || null,
    feeRecordedAt: row.fee_recorded_at || null,
    feeRecordedBy: row.fee_recorded_by || null,
    feeNotes: row.fee_notes || null,
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
    await logWarn('No booking found with token', { tokenPrefix: token.substring(0, 8) + '...' })
    return null
  }

  const booking = result.rows[0] as any

  // Check if token is expired (with 5-minute grace period for better UX)
  // This allows users who are mid-submission to complete their action even if token expires during submission
  // The grace period is small enough to maintain security while improving user experience
  const TOKEN_GRACE_PERIOD = 5 * 60 // 5 minutes in seconds
  const effectiveExpirationTime = booking.token_expires_at 
    ? booking.token_expires_at + TOKEN_GRACE_PERIOD 
    : null
  
  if (effectiveExpirationTime && now > effectiveExpirationTime) {
    // Token expired (even with grace period) - log for debugging
    // CRITICAL: Format timestamps in Bangkok timezone for debug logging
    const { TZDate } = await import('@date-fns/tz')
    const { format } = await import('date-fns')
    const BANGKOK_TIMEZONE = 'Asia/Bangkok'
    const expiredDate = new TZDate(booking.token_expires_at * 1000, BANGKOK_TIMEZONE)
    const currentDate = new TZDate(now * 1000, BANGKOK_TIMEZONE)
    const expiredAtStr = format(expiredDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
    const currentTimeStr = format(currentDate, 'yyyy-MM-dd HH:mm:ss') + ' GMT+7'
    await logWarn('Token expired for booking', { bookingId: booking.id, expiredAt: expiredAtStr, currentTime: currentTimeStr, gracePeriod: '5 minutes' })
    return null
  }
  
  // Log successful token lookup for debugging
  await logInfo('Found booking with valid token', { bookingId: booking.id, status: booking.status })

  const formattedBooking = formatBooking(booking)
  
  // Cache for shorter time (2 minutes) since tokens are time-sensitive
  setCached(cacheKey, formattedBooking, 120)
  
  return formattedBooking
}

/**
 * Submit user response to booking
 * 
 * NOTE: Only "cancel" response is supported in the current booking flow.
 * Legacy responses ("accept", "propose", "check-in") have been removed.
 */
export async function submitUserResponse(
  bookingId: string,
  response: "cancel",
  options?: {
    message?: string
  }
): Promise<Booking> {
  const transactionResult = await dbTransaction(async (db) => {
    // CRITICAL: Use Bangkok time for consistency with business logic
    const { getBangkokTime } = await import('./timezone')
    const now = getBangkokTime()

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
    
    // CRITICAL: Store original updated_at for optimistic locking
    // This prevents race conditions when multiple users submit responses simultaneously
    const originalUpdatedAt = currentBooking.updated_at

    // Only "cancel" is supported - set status to cancelled
    const newStatus = "cancelled"
    const userResponseText = "User cancelled the booking"

    // Update booking - simplified for cancel-only flow
    const updateFields: string[] = [
      "status = ?",
      "user_response = ?",
      "response_date = ?",
      "updated_at = ?"
    ]
    const updateArgs: any[] = [
        newStatus,
        userResponseText + (options?.message ? `\n\nMessage: ${options.message}` : ""),
        now,
        now,
    ]

    // CRITICAL: Use optimistic locking to prevent race conditions
    // Check updated_at to ensure booking hasn't been modified by another process
    const updateResult = await db.execute({
      sql: `
        UPDATE bookings 
        SET ${updateFields.join(", ")}
        WHERE id = ? AND updated_at = ?
      `,
      args: [...updateArgs, bookingId, originalUpdatedAt],
    })
    
    // Check if update succeeded (rows affected > 0)
    // If rows affected = 0, booking was modified by another process
    if (updateResult.rowsAffected === 0) {
      // Track monitoring metric
      try {
        const { trackOptimisticLockConflict } = await import('./monitoring')
        trackOptimisticLockConflict('booking', bookingId, { 
          action: 'submitUserResponse', 
          response, 
          oldStatus, 
          attemptedNewStatus: newStatus 
        })
      } catch {
        // Ignore monitoring errors
      }
      throw new Error(
        "Booking was modified by another process. Please refresh the page and try again."
      )
    }

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
    
    // Don't invalidate cache inside transaction - move outside after commit
    // Cache invalidation can be slow and shouldn't block transaction commit
    
    // Store cache keys to invalidate after transaction commits
    const cacheKeysToInvalidate: string[] = [CacheKeys.booking(bookingId)]
    
    if (currentBooking.response_token) {
      cacheKeysToInvalidate.push(CacheKeys.bookingByToken(currentBooking.response_token))
    }
    
    // Return booking and cache keys (no token changes for cancel)
    return {
      booking: updatedBooking,
      cacheKeys: cacheKeysToInvalidate,
      oldToken: currentBooking.response_token,
      newToken: null // No new token for cancellation
    }
  })
  
  // IMPROVED: Invalidate cache AFTER transaction commits successfully
  // This prevents cache invalidation from blocking or delaying transaction commit
  try {
    const { invalidateCache } = await import('./cache')
    
    // Invalidate booking cache
    if (transactionResult.cacheKeys.length > 0) {
      await invalidateCache(transactionResult.cacheKeys[0])
    }
    
    // Invalidate token caches
    for (let i = 1; i < transactionResult.cacheKeys.length; i++) {
      await invalidateCache(transactionResult.cacheKeys[i])
    }
    
    // Invalidate list caches (bookings list may have changed)
    await invalidateCache('bookings:list')
  } catch (cacheError) {
    // Don't fail if cache invalidation fails - it's non-critical
    await logWarn('Cache invalidation failed after user response submission', { bookingId, error: cacheError instanceof Error ? cacheError.message : String(cacheError) })
  }
  
  // CRITICAL: Broadcast user response event to admin clients (for real-time updates)
  // Fetch booking from DB to get raw timestamps (not formatted dates)
  try {
    const db = getTursoClient()
    const bookingRow = await db.execute({
      sql: "SELECT * FROM bookings WHERE id = ?",
      args: [bookingId],
    })
    
    if (bookingRow.rows.length > 0) {
      const dbRow = bookingRow.rows[0] as any
      const { broadcastBookingEvent } = await import('../../app/api/v1/admin/bookings/stream/route')
      
      // Prepare booking data with raw timestamps (Unix timestamps, not date strings)
      // FIXED: Use prepareBookingDataForSSE for consistent data preparation (Bug #83)
      // This ensures all required fields have proper fallbacks and prevents type violations
      const { prepareBookingDataForSSE } = await import('./booking-sse-data')
      const bookingData = prepareBookingDataForSSE(dbRow)
      
      await broadcastBookingEvent('booking:user_response', bookingData, {
        changeReason: `User ${response} response submitted`,
      })
    }
  } catch (broadcastError) {
    // Don't fail if broadcast fails - it's non-critical
    // Use logger if available, otherwise console.warn
    try {
      const { createRequestLogger } = await import('./logger')
      const logger = createRequestLogger('submitUserResponse', 'submitUserResponse')
      await logger.warn('Failed to broadcast user response event', {
        bookingId,
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      })
    } catch {
      // Fallback to console if logger fails (shouldn't happen, but fail-safe)
      if (process.env.NODE_ENV === 'development') {
        console.warn('Failed to broadcast user response event', broadcastError)
      }
    }
  }
  
  return transactionResult.booking
}

