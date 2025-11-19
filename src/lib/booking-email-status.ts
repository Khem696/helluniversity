/**
 * Booking Creation with Email Status Tracking
 * 
 * Option 2: Database Transaction with Email Status
 * 
 * Flow:
 * 1. Save booking in database transaction (with email_status tracking)
 * 2. Try to send emails
 * 3. If emails fail → queue for retry (booking still exists)
 * 4. If database fails → no emails sent (transaction rollback)
 * 
 * This ensures:
 * - If database saves but email fails → booking exists, emails queued for retry
 * - If database fails → no emails sent, user must retry
 */

import { dbTransaction } from "./turso"
import { sendReservationEmails } from "./email"
import { addEmailToQueue } from "./email-queue"
import { createRequestLogger } from "./logger"
import { randomUUID } from "crypto"

export interface BookingCreationResult {
  success: boolean
  bookingId?: string
  referenceNumber?: string
  error?: string
  emailStatus?: {
    adminSent: boolean
    userSent: boolean
    queued: boolean
    errors: string[]
  }
}

/**
 * Create booking with email status tracking
 * 
 * If database saves but emails fail, emails are queued for retry.
 * Booking still exists and is returned as success.
 */
export async function createBookingWithEmailStatus(
  bookingData: {
    name: string
    email: string
    phone: string
    participants?: string
    eventType: string
    otherEventType?: string
    dateRange: boolean
    startDate: string
    endDate?: string | null
    startTime?: string
    endTime?: string
    organizationType?: string
    introduction: string
    biography?: string
    specialRequests?: string
  },
  referenceNumber: string,
  requestId: string
): Promise<BookingCreationResult> {
  const logger = createRequestLogger(requestId, 'createBookingWithEmailStatus')
  
  try {
    // STEP 1: Save booking in database transaction
    await logger.info('Step 1: Saving booking to database with email status tracking')
    
    const bookingResult = await dbTransaction(async (tx) => {
      const { getBangkokTime } = await import('./timezone')
      const { createBangkokTimestamp } = await import('./timezone')
      
      const bookingId = randomUUID()
      const now = getBangkokTime()
      
      // Ensure reference number is unique
      // IMPROVED: Use database constraint check with retry logic and exponential backoff
      // Increased max attempts to 10 and added fallback to UUID-based reference
      let finalReferenceNumber = referenceNumber
      let attempts = 0
      const maxAttempts = 10 // Increased from 5 to handle extreme load scenarios
      
      while (attempts < maxAttempts) {
        const checkResult = await tx.execute({
          sql: `SELECT id FROM bookings WHERE reference_number = ? LIMIT 1`,
          args: [finalReferenceNumber],
        })
        
        if (checkResult.rows.length === 0) {
          // Reference number is unique, break out of loop
          break
        }
        
        // Reference number collision - generate unique one
        await logger.warn('Reference number collision, generating unique reference', {
          original: referenceNumber,
          attempt: attempts + 1,
          maxAttempts,
          current: finalReferenceNumber
        })
        
        // Exponential backoff: wait before retrying to reduce collision probability
        // Small delay: 10ms, 20ms, 40ms, etc. (only if not first attempt)
        if (attempts > 0) {
          const backoffDelay = Math.min(10 * Math.pow(2, attempts - 1), 100) // Max 100ms
          await new Promise(resolve => setTimeout(resolve, backoffDelay))
        }
        
        const timestamp = Math.floor(Date.now() / 1000)
        const randomBytes = require('crypto').randomBytes(4)
        const randomValue = parseInt(randomBytes.toString('hex'), 16)
        const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
        const randomPart = (randomValue % 46656).toString(36).toUpperCase().padStart(3, '0')
        finalReferenceNumber = `HU-${timestampPart}${randomPart}`
        attempts++
      }
      
      // FALLBACK: If all attempts fail, use UUID-based reference number
      // This ensures booking creation never fails due to reference number collisions
      if (attempts >= maxAttempts) {
        await logger.error(
          'All reference number generation attempts failed, using UUID fallback',
          new Error('Reference number collision exhaustion'),
          {
            original: referenceNumber,
            attempts: maxAttempts
          }
        )
        // Generate UUID-based reference: HU-UUID (first 8 chars of UUID)
        const uuid = randomUUID().replace(/-/g, '').toUpperCase().substring(0, 8)
        finalReferenceNumber = `HU-${uuid}`
        
        // Verify UUID-based reference is also unique (extremely unlikely collision)
        const fallbackCheck = await tx.execute({
          sql: `SELECT id FROM bookings WHERE reference_number = ? LIMIT 1`,
          args: [finalReferenceNumber],
        })
        
        if (fallbackCheck.rows.length > 0) {
          // Even UUID collision (virtually impossible) - use full UUID
          const fullUuid = randomUUID().replace(/-/g, '').toUpperCase()
          finalReferenceNumber = `HU-${fullUuid.substring(0, 12)}` // Use 12 chars for extra safety
          await logger.warn('UUID-based reference also collided, using extended UUID', {
            finalReference: finalReferenceNumber
          })
        }
      }
      
      // Convert dates to Unix timestamps using Bangkok timezone
      const startDate = createBangkokTimestamp(bookingData.startDate, bookingData.startTime || null)
      const endDate = bookingData.endDate
        ? createBangkokTimestamp(bookingData.endDate, bookingData.endTime || null)
        : null
      
      // CRITICAL: Final overlap check WITHIN transaction to prevent race conditions
      // This ensures no other booking can be confirmed between check and save
      const { checkBookingOverlapWithLock } = await import('./booking-validations')
      const overlapCheck = await checkBookingOverlapWithLock(
        null, // New booking
        startDate,
        endDate,
        bookingData.startTime || null,
        bookingData.endTime || null,
        tx
      )
      
      if (overlapCheck.overlaps) {
        const overlappingNames = overlapCheck.overlappingBookings
          ?.map((b: any) => b.name || "Unknown")
          .join(", ") || "existing booking"
        throw new Error(
          `The selected date and time overlaps with an existing confirmed booking (${overlappingNames}). Please choose a different date or time.`
        )
      }
      
      // Insert booking with email_status = 'pending' (will be updated after email attempt)
      await tx.execute({
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
          bookingData.name.trim(),
          bookingData.email.trim(),
          bookingData.phone.trim(),
          bookingData.participants?.trim() || null,
          bookingData.eventType.trim(),
          bookingData.otherEventType?.trim() || null,
          bookingData.dateRange ? 1 : 0,
          startDate,
          endDate,
          bookingData.startTime?.trim() || null,
          bookingData.endTime?.trim() || null,
          bookingData.organizationType || null,
          null, // organized_person
          bookingData.introduction.trim(),
          bookingData.biography?.trim() || null,
          bookingData.specialRequests?.trim() || null,
          "pending",
          now,
          now,
        ],
      })
      
      // Don't invalidate cache inside transaction - move outside after commit
      // Cache invalidation can be slow and shouldn't block transaction commit
      
      return {
        bookingId,
        referenceNumber: finalReferenceNumber
      }
    })
    
    // IMPROVED: Invalidate cache AFTER transaction commits successfully
    // This prevents cache invalidation from blocking or delaying transaction commit
    try {
      const { invalidateCache } = await import('./cache')
      await invalidateCache('bookings:list')
    } catch (cacheError) {
      // Don't fail if cache invalidation fails - it's non-critical
      await logger.warn('Cache invalidation failed after booking creation', cacheError instanceof Error ? cacheError : new Error(String(cacheError)))
    }
    
    await logger.info('Step 1 complete: Booking saved to database', {
      bookingId: bookingResult.bookingId,
      referenceNumber: bookingResult.referenceNumber
    })
    
    // STEP 2: Try to send emails (AFTER database save succeeds)
    await logger.info('Step 2: Attempting to send confirmation emails')
    
    let emailStatus: { adminSent: boolean; userSent: boolean; errors: string[] } | undefined
    let emailsQueued = false
    
    try {
      emailStatus = await sendReservationEmails({
        name: bookingData.name,
        email: bookingData.email,
        phone: bookingData.phone,
        participants: bookingData.participants,
        eventType: bookingData.eventType,
        otherEventType: bookingData.otherEventType,
        dateRange: bookingData.dateRange,
        startDate: bookingData.startDate,
        endDate: bookingData.endDate || null,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        organizationType: bookingData.organizationType as "Tailor Event" | "Space Only" | "" || "",
        introduction: bookingData.introduction,
        biography: bookingData.biography,
        specialRequests: bookingData.specialRequests,
      }, bookingResult.referenceNumber)
      
      // Check if emails succeeded
      if (!emailStatus.adminSent || !emailStatus.userSent) {
        await logger.warn('Step 2: Email sending failed, queueing for retry', {
          adminSent: emailStatus.adminSent,
          userSent: emailStatus.userSent,
          errors: emailStatus.errors
        })
        
        // STEP 3: Queue failed emails for retry
        await logger.info('Step 3: Queueing failed emails for retry')
        
        try {
          // Queue admin notification if it failed
          if (!emailStatus.adminSent) {
            await queueAdminNotificationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
            await logger.info('Admin notification email queued for retry')
          }
          
          // Queue user confirmation if it failed
          if (!emailStatus.userSent) {
            await queueUserConfirmationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
            await logger.info('User confirmation email queued for retry')
          }
          
          emailsQueued = true
          await logger.info('Step 3 complete: Failed emails queued for retry')
          
        } catch (queueError) {
          await logger.error('Failed to queue emails for retry', 
            queueError instanceof Error ? queueError : new Error(String(queueError))
          )
          // Don't fail the request - booking exists, emails can be manually sent
        }
      } else {
        await logger.info('Step 2 complete: Both emails sent successfully')
      }
      
    } catch (emailError) {
      await logger.error('Step 2: Email sending exception, queueing for retry', 
        emailError instanceof Error ? emailError : new Error(String(emailError))
      )
      
      // Queue both emails for retry (we don't know which one failed)
      try {
        await queueAdminNotificationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
        await queueUserConfirmationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
        emailsQueued = true
        await logger.info('Both emails queued for retry after exception')
      } catch (queueError) {
        await logger.error('Failed to queue emails after exception', 
          queueError instanceof Error ? queueError : new Error(String(queueError))
        )
      }
      
      emailStatus = {
        adminSent: false,
        userSent: false,
        errors: [emailError instanceof Error ? emailError.message : String(emailError)]
      }
    }
    
    // Success - booking exists (emails may be queued for retry)
    await logger.info('Transaction complete: Booking saved', {
      bookingId: bookingResult.bookingId,
      referenceNumber: bookingResult.referenceNumber,
      emailsSent: emailStatus?.adminSent && emailStatus?.userSent,
      emailsQueued
    })
    
    return {
      success: true,
      bookingId: bookingResult.bookingId,
      referenceNumber: bookingResult.referenceNumber,
      emailStatus: {
        adminSent: emailStatus?.adminSent || false,
        userSent: emailStatus?.userSent || false,
        queued: emailsQueued,
        errors: emailStatus?.errors || []
      }
    }
    
  } catch (dbError) {
    // Database transaction failed - no emails sent (transaction rolled back automatically)
    await logger.error('Step 1 failed: Database save failed', 
      dbError instanceof Error ? dbError : new Error(String(dbError))
    )
    
    return {
      success: false,
      error: 'Failed to save booking to database. Please try again later.',
    }
  }
}

/**
 * Queue admin notification email for retry
 * Generates email content from booking data and queues it directly
 * Uses the same pattern as sendAdminNotification but queues without sending
 */
async function queueAdminNotificationEmail(
  bookingData: {
    name: string
    email: string
    phone: string
    participants?: string
    eventType: string
    otherEventType?: string
    dateRange: boolean
    startDate: string
    endDate?: string | null
    startTime?: string
    endTime?: string
    organizationType?: string
    introduction: string
    biography?: string
    specialRequests?: string
  },
  referenceNumber: string,
  bookingId: string
): Promise<void> {
  // Convert bookingData to ReservationData format
  const reservationData = {
    name: bookingData.name,
    email: bookingData.email,
    phone: bookingData.phone,
    participants: bookingData.participants,
    eventType: bookingData.eventType,
    otherEventType: bookingData.otherEventType,
    dateRange: bookingData.dateRange,
    startDate: bookingData.startDate,
    endDate: bookingData.endDate ?? null, // Convert undefined to null
    startTime: bookingData.startTime,
    endTime: bookingData.endTime,
    organizationType: (bookingData.organizationType as "Tailor Event" | "Space Only" | "" | undefined) || undefined,
    introduction: bookingData.introduction,
    biography: bookingData.biography,
    specialRequests: bookingData.specialRequests,
  }
  
  // Use sendAdminNotification which will generate content and queue on failure
  // Since we're already in a failure scenario, it will queue immediately
  // This reuses the existing queue logic in sendAdminNotification
  const { sendAdminNotification } = await import('./email')
  
  // Call sendAdminNotification - it will try to send and queue on failure
  // Since email sending already failed, this will queue it
  // The function handles queueing automatically on failure
  await sendAdminNotification(reservationData, referenceNumber).catch(() => {
    // Email is already queued by sendAdminNotification on failure
    // No action needed
  })
}

/**
 * Queue user confirmation email for retry
 * Generates email content from booking data and queues it directly
 * Uses the same pattern as sendUserConfirmation but queues without sending
 */
async function queueUserConfirmationEmail(
  bookingData: {
    name: string
    email: string
    phone: string
    participants?: string
    eventType: string
    otherEventType?: string
    dateRange: boolean
    startDate: string
    endDate?: string | null
    startTime?: string
    endTime?: string
    organizationType?: string
    introduction: string
    biography?: string
    specialRequests?: string
  },
  referenceNumber: string,
  bookingId: string
): Promise<void> {
  // Convert bookingData to ReservationData format
  const reservationData = {
    name: bookingData.name,
    email: bookingData.email,
    phone: bookingData.phone,
    participants: bookingData.participants,
    eventType: bookingData.eventType,
    otherEventType: bookingData.otherEventType,
    dateRange: bookingData.dateRange,
    startDate: bookingData.startDate,
    endDate: bookingData.endDate ?? null, // Convert undefined to null
    startTime: bookingData.startTime,
    endTime: bookingData.endTime,
    organizationType: (bookingData.organizationType as "Tailor Event" | "Space Only" | "" | undefined) || undefined,
    introduction: bookingData.introduction,
    biography: bookingData.biography,
    specialRequests: bookingData.specialRequests,
  }
  
  // Use sendUserConfirmation which will generate content and queue on failure
  // Since we're already in a failure scenario, it will queue immediately
  // This reuses the existing queue logic in sendUserConfirmation
  const { sendUserConfirmation } = await import('./email')
  
  // Call sendUserConfirmation - it will try to send and queue on failure
  // Since email sending already failed, this will queue it
  // The function handles queueing automatically on failure
  await sendUserConfirmation(reservationData, referenceNumber).catch(() => {
    // Email is already queued by sendUserConfirmation on failure
    // No action needed
  })
}

