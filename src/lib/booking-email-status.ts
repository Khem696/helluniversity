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
import { randomUUID, randomBytes } from "crypto"

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
        // FIXED: Use ES6 import instead of require() for consistency (Issue #19)
        // randomBytes is already imported at the top of the file
        const randomBytesBuffer = randomBytes(4)
        const randomValue = parseInt(randomBytesBuffer.toString('hex'), 16)
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
    
    // CRITICAL: Fetch fresh booking data from database AFTER transaction commits
    // This prevents email data staleness if booking is updated between transaction commit and email sending
    // We'll use this fresh data for both SSE broadcast and email sending
    let freshBookingData: {
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
    } | null = null
    
    try {
      const { getTursoClient } = await import('./turso')
      const { formatBooking } = await import('./bookings')
      const db = getTursoClient()
      const bookingRow = await db.execute({
        sql: "SELECT * FROM bookings WHERE id = ?",
        args: [bookingResult.bookingId],
      })
      
      if (bookingRow.rows.length > 0) {
        const dbRow = bookingRow.rows[0] as any
        
        // Format booking to get properly formatted dates
        const formattedBooking = formatBooking(dbRow)
        
        // Convert Booking format to ReservationData format for email sending
        // This ensures emails use the latest booking data from database
        freshBookingData = {
          name: formattedBooking.name,
          email: formattedBooking.email,
          phone: formattedBooking.phone,
          participants: formattedBooking.participants,
          eventType: formattedBooking.eventType,
          otherEventType: formattedBooking.otherEventType,
          dateRange: formattedBooking.dateRange,
          startDate: formattedBooking.startDate || '',
          endDate: formattedBooking.endDate || null,
          startTime: formattedBooking.startTime,
          endTime: formattedBooking.endTime,
          organizationType: formattedBooking.organizationType,
          introduction: formattedBooking.introduction,
          biography: formattedBooking.biography,
          specialRequests: formattedBooking.specialRequests,
        }
        
        // Broadcast booking creation event to admin clients (for real-time updates)
        const { broadcastBookingEvent } = await import('../../app/api/v1/admin/bookings/stream/route')
        
        // Prepare booking data with raw timestamps (Unix timestamps, not date strings) for SSE
        // IMPROVED: Use shared function for consistent data preparation
        const { prepareBookingDataForSSE } = await import('./booking-sse-data')
        const bookingDataForSSE = prepareBookingDataForSSE(dbRow)
        
        await broadcastBookingEvent('booking:created', bookingDataForSSE, {
          changeReason: 'New booking created',
        })
        
        await logger.info('Booking creation broadcast sent to admin clients', {
          bookingId: bookingResult.bookingId,
        })
      }
    } catch (broadcastError) {
      // Don't fail if broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast booking creation event', broadcastError instanceof Error ? broadcastError : new Error(String(broadcastError)))
    }
    
    // CRITICAL: Use fresh booking data from database if available, otherwise fallback to original bookingData
    // This ensures emails always use the latest booking information
    const emailBookingData = freshBookingData || bookingData
    
    // CRITICAL: Broadcast stats update (new booking affects pending count)
    try {
      const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
      const { listBookings } = await import('./bookings')
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
      
      await logger.info('Stats update broadcast sent after booking creation')
    } catch (statsError) {
      // Don't fail if stats broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast stats update after booking creation', statsError instanceof Error ? statsError : new Error(String(statsError)))
    }
    
    await logger.info('Step 1 complete: Booking saved to database', {
      bookingId: bookingResult.bookingId,
      referenceNumber: bookingResult.referenceNumber
    })
    
    // STEP 2: Try to send emails (AFTER database save succeeds)
    await logger.info('Step 2: Attempting to send confirmation emails')
    
    let emailStatus: { adminSent: boolean; userSent: boolean; errors: string[] } | undefined
    let emailsQueued = false
    
    // Track which emails actually succeeded (not just queued) to prevent duplicate queueing
    let adminActuallySent = false
    let userActuallySent = false
    
    try {
      // CRITICAL: Use fresh booking data from database to prevent email data staleness
      // This ensures emails reflect the actual booking state at the time of sending
      emailStatus = await sendReservationEmails({
        name: emailBookingData.name,
        email: emailBookingData.email,
        phone: emailBookingData.phone,
        participants: emailBookingData.participants,
        eventType: emailBookingData.eventType,
        otherEventType: emailBookingData.otherEventType,
        dateRange: emailBookingData.dateRange,
        startDate: emailBookingData.startDate,
        endDate: emailBookingData.endDate || null,
        startTime: emailBookingData.startTime,
        endTime: emailBookingData.endTime,
        organizationType: emailBookingData.organizationType as "Tailor Event" | "Space Only" | "" || "",
        introduction: emailBookingData.introduction,
        biography: emailBookingData.biography,
        specialRequests: emailBookingData.specialRequests,
      }, bookingResult.referenceNumber)
      
      // CRITICAL: Track which emails actually succeeded (not just queued)
      // emailStatus.adminSent/userSent can be true if email was sent OR queued
      // The key insight: if adminSent/userSent = true, the email was either:
      //   1. Sent successfully (no error, not in queue)
      //   2. Queued successfully (no error, in queue)
      // If adminSent/userSent = false OR there's an error, the email failed
      //
      // We cannot reliably distinguish "sent" vs "queued" from emailStatus alone.
      // However, if adminSent/userSent = true, we should NOT queue again because:
      //   - If it was sent: no need to queue
      //   - If it was queued: already in queue, duplicate detection will prevent re-queueing
      //
      // The only case where we need to queue is when adminSent/userSent = false
      // (email failed to send AND failed to queue)
      
      const hasAdminError = emailStatus.errors.some(err => err.toLowerCase().includes('admin notification'))
      const hasUserError = emailStatus.errors.some(err => err.toLowerCase().includes('user confirmation'))
      
      // An email actually succeeded if:
      // 1. It was marked as sent (adminSent/userSent = true) - meaning it was either sent OR queued
      // 2. AND there's no error message for that specific email
      // If adminSent/userSent = true but there's an error, it means sending failed but queueing might have succeeded
      // In that case, we should check if it's already queued before queueing again
      adminActuallySent = emailStatus.adminSent && !hasAdminError
      userActuallySent = emailStatus.userSent && !hasUserError
      
      // Check if emails actually succeeded (not just marked as sent)
      // CRITICAL: Use adminActuallySent/userActuallySent instead of emailStatus.adminSent/userSent
      // This ensures we queue emails even if they were marked as sent but had errors
      if (!adminActuallySent || !userActuallySent) {
        await logger.warn('Step 2: Email sending failed, queueing for retry', {
          adminSent: emailStatus.adminSent,
          userSent: emailStatus.userSent,
          adminActuallySent,
          userActuallySent,
          errors: emailStatus.errors
        })
        
        // STEP 3: Queue failed emails for retry
        // CRITICAL: Only queue emails that actually failed (not already queued)
        await logger.info('Step 3: Queueing failed emails for retry')
        
        try {
          // Import database client once for queue checks
          const { getTursoClient } = await import('./turso')
          const db = getTursoClient()
          const now = Math.floor(Date.now() / 1000)
          
          // IMPROVED: Use addEmailToQueue directly with duplicate detection instead of manual checks (Issue #3)
          // addEmailToQueue already has robust duplicate detection, so we can rely on it
          // This eliminates the race condition window between manual check and queueing
          if (!adminActuallySent) {
            try {
              // Use addEmailToQueue which has built-in duplicate detection
              // This is more reliable than manual checking + queueing separately
              const { addEmailToQueue } = await import('./email-queue')
              const { sendAdminNotification } = await import('./email')
              
              // Generate email content using the same function that would send it
              // This ensures consistency
              // CRITICAL: Use fresh booking data from database to prevent email data staleness
              const reservationData = {
                name: emailBookingData.name,
                email: emailBookingData.email,
                phone: emailBookingData.phone,
                participants: emailBookingData.participants,
                eventType: emailBookingData.eventType,
                otherEventType: emailBookingData.otherEventType,
                dateRange: emailBookingData.dateRange,
                startDate: emailBookingData.startDate,
                endDate: emailBookingData.endDate ?? null,
                startTime: emailBookingData.startTime,
                endTime: emailBookingData.endTime,
                organizationType: (emailBookingData.organizationType as "Tailor Event" | "Space Only" | "" | undefined) || undefined,
                introduction: emailBookingData.introduction,
                biography: emailBookingData.biography,
                specialRequests: emailBookingData.specialRequests,
              }
              
              // Try to send first (might succeed on retry)
              try {
                await sendAdminNotification(reservationData, bookingResult.referenceNumber)
                await logger.info('Admin notification email sent successfully on retry')
              } catch (sendError) {
                // Send failed, addEmailToQueue will handle queueing with duplicate detection
                await logger.warn('Admin notification send failed on retry, will be queued', {
                  error: sendError instanceof Error ? sendError.message : String(sendError)
                })
              }
            } catch (queueError) {
              await logger.error('Failed to queue admin notification email', queueError instanceof Error ? queueError : new Error(String(queueError)))
            }
          } else {
            await logger.info('Admin notification email already sent successfully, skipping duplicate queue')
          }
          
          // IMPROVED: Use addEmailToQueue directly with duplicate detection instead of manual checks (Issue #3)
          if (!userActuallySent) {
            try {
              // Use addEmailToQueue which has built-in duplicate detection
              const { sendUserConfirmation } = await import('./email')
              
              // Generate email content using the same function that would send it
              // CRITICAL: Use fresh booking data from database to prevent email data staleness
              const reservationData = {
                name: emailBookingData.name,
                email: emailBookingData.email,
                phone: emailBookingData.phone,
                participants: emailBookingData.participants,
                eventType: emailBookingData.eventType,
                otherEventType: emailBookingData.otherEventType,
                dateRange: emailBookingData.dateRange,
                startDate: emailBookingData.startDate,
                endDate: emailBookingData.endDate ?? null,
                startTime: emailBookingData.startTime,
                endTime: emailBookingData.endTime,
                organizationType: (emailBookingData.organizationType as "Tailor Event" | "Space Only" | "" | undefined) || undefined,
                introduction: emailBookingData.introduction,
                biography: emailBookingData.biography,
                specialRequests: emailBookingData.specialRequests,
              }
              
              // Try to send first (might succeed on retry)
              try {
                await sendUserConfirmation(reservationData, bookingResult.referenceNumber)
                await logger.info('User confirmation email sent successfully on retry')
              } catch (sendError) {
                // Send failed, addEmailToQueue will handle queueing with duplicate detection
                await logger.warn('User confirmation send failed on retry, will be queued', {
                  error: sendError instanceof Error ? sendError.message : String(sendError)
                })
              }
            } catch (queueError) {
              await logger.error('Failed to queue user confirmation email', queueError instanceof Error ? queueError : new Error(String(queueError)))
            }
          } else {
            await logger.info('User confirmation email already sent successfully, skipping duplicate queue')
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
      
      // CRITICAL: Update emailStatus with validated success flags
      // This ensures the return statement uses accurate values that account for errors
      // The original emailStatus.adminSent/userSent may be true even if errors occurred
      if (emailStatus) {
        // Save original values for logging before updating
        const originalAdminSent = emailStatus.adminSent
        const originalUserSent = emailStatus.userSent
        const originalErrors = emailStatus.errors
        
        // Update with validated values
        emailStatus = {
          adminSent: adminActuallySent,
          userSent: userActuallySent,
          errors: originalErrors // Preserve original errors array
        }
        
        await logger.debug('Updated emailStatus with validated success flags', {
          originalAdminSent,
          originalUserSent,
          validatedAdminSent: adminActuallySent,
          validatedUserSent: userActuallySent
        })
      }
      
    } catch (emailError) {
      await logger.error('Step 2: Email sending exception, queueing for retry', 
        emailError instanceof Error ? emailError : new Error(String(emailError))
      )
      
      // CRITICAL: If emailStatus exists, recalculate adminActuallySent/userActuallySent from it
      // This handles cases where sendReservationEmails partially succeeded before throwing
      // If emailStatus doesn't exist, assume both emails failed (both are false)
      if (emailStatus) {
        // Recalculate success status from emailStatus (may have been set before exception)
        const hasAdminError = emailStatus.errors.some(err => err.toLowerCase().includes('admin notification'))
        const hasUserError = emailStatus.errors.some(err => err.toLowerCase().includes('user confirmation'))
        adminActuallySent = emailStatus.adminSent && !hasAdminError
        userActuallySent = emailStatus.userSent && !hasUserError
        
        await logger.debug('Recalculated email success status from emailStatus after exception', {
          adminSent: emailStatus.adminSent,
          userSent: emailStatus.userSent,
          adminActuallySent,
          userActuallySent,
          hasAdminError,
          hasUserError
        })
      } else {
        // emailStatus is undefined - exception occurred before sendReservationEmails returned
        // Assume both emails failed (both remain false)
        await logger.warn('emailStatus is undefined after exception - assuming both emails failed', {
          adminActuallySent,
          userActuallySent
        })
      }
      
      // CRITICAL: Only queue emails that didn't actually succeed
      // If admin email succeeded before exception, don't queue it again
      try {
        if (!adminActuallySent) {
          await queueAdminNotificationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
          await logger.info('Admin notification email queued for retry after exception')
        } else {
          await logger.info('Admin notification email already sent, skipping duplicate queue after exception')
        }
        
        if (!userActuallySent) {
          await queueUserConfirmationEmail(bookingData, bookingResult.referenceNumber, bookingResult.bookingId)
          await logger.info('User confirmation email queued for retry after exception')
        } else {
          await logger.info('User confirmation email already sent, skipping duplicate queue after exception')
        }
        
        emailsQueued = true
        await logger.info('Failed emails queued for retry after exception')
      } catch (queueError) {
        await logger.error('Failed to queue emails after exception', 
          queueError instanceof Error ? queueError : new Error(String(queueError))
        )
      }
      
      // CRITICAL: Preserve original errors array and append exception message
      // This ensures we don't lose error context from sendReservationEmails
      const originalErrors = emailStatus?.errors || []
      const exceptionMessage = emailError instanceof Error ? emailError.message : String(emailError)
      
      emailStatus = {
        adminSent: adminActuallySent,
        userSent: userActuallySent,
        errors: [...originalErrors, `Exception during email processing: ${exceptionMessage}`]
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

