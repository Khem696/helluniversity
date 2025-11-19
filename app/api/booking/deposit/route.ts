import { NextResponse } from "next/server"
import { getBookingByToken, updateBookingStatus } from "@/lib/bookings"
import { processAndUploadImage, validateImageFile } from "@/lib/image-processor"
import { sendAdminStatusChangeNotification, sendBookingStatusNotification } from "@/lib/email"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Deposit Upload API
 * 
 * POST /api/booking/deposit
 * - Uploads deposit evidence image
 * - Updates booking status to "pending_deposit" (if coming from pending_deposit without deposit)
 * - Status remains "pending_deposit" after upload (admin needs to accept/reject)
 * 
 * Body (FormData):
 * - token: Response token from booking email
 * - file: Deposit evidence image (File)
 */

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/booking/deposit')
    
    await logger.info('Deposit upload request received')
    
    // CRITICAL: Validate FormData size before parsing to prevent DoS
    const { validateFormDataSize } = await import('@/lib/formdata-validation')
    const formDataSizeCheck = await validateFormDataSize(request) // Uses MAX_FORMDATA_SIZE env var (default: 20MB)
    if (!formDataSizeCheck.valid) {
      await logger.warn('Deposit upload rejected: FormData too large', { 
        error: formDataSizeCheck.error,
        size: formDataSizeCheck.size 
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        formDataSizeCheck.error || "Request body is too large. Please reduce the file size and try again.",
        undefined,
        413, // 413 Payload Too Large
        { requestId }
      )
    }
    
    const formData = await request.formData()
    const token = formData.get("token") as string | null
    const file = formData.get("file") as File | null

    if (!token) {
      await logger.warn('Deposit upload rejected: missing token')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Token is required",
        undefined,
        400,
        { requestId }
      )
    }

    if (!file) {
      await logger.warn('Deposit upload rejected: missing file')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Deposit evidence file is required",
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.info('Deposit file received', { 
      fileName: file.name, 
      fileSize: file.size,
      fileType: file.type,
      tokenPrefix: token.substring(0, 8) + '...'
    })

    // Validate image file
    const validation = validateImageFile(file)
    if (!validation.valid) {
      await logger.warn('Deposit upload rejected: invalid file', { error: validation.error })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        validation.error || "Invalid image file",
        undefined,
        400,
        { requestId }
      )
    }

    // Get booking by token
    const booking = await getBookingByToken(token)
    if (!booking) {
      await logger.warn('Deposit upload rejected: invalid or expired token', { tokenPrefix: token.substring(0, 8) + '...' })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Invalid or expired token",
        undefined,
        404,
        { requestId }
      )
    }
    
    await logger.info('Booking found for deposit upload', { bookingId: booking.id, currentStatus: booking.status })

    // Validate booking status - must be "pending_deposit"
    // User can upload deposit when booking is in pending_deposit status
    const canUploadDeposit = booking.status === "pending_deposit"
    
    if (!canUploadDeposit) {
      await logger.warn('Deposit upload rejected: invalid status', { bookingId: booking.id, status: booking.status })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Deposit can only be uploaded for bookings with pending_deposit status. Current status: ${booking.status}`,
        undefined,
        400,
        { requestId }
      )
    }
    
    // Check if token is valid and not expired
    const { getBangkokTime } = await import("@/lib/timezone")
    const { calculateStartTimestamp } = await import("@/lib/booking-validations")
    const bangkokNow = getBangkokTime()
    
    // Token should match current token
    if (booking.responseToken !== token) {
      await logger.warn('Deposit upload rejected: token mismatch', { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "This token is no longer valid. Please use the latest token from your email.",
        undefined,
        400,
        { requestId }
      )
    }
    
    // Check if token expired (expires at start date/time) with 5-minute grace period
    // This allows users who are mid-upload to complete their action
    const TOKEN_GRACE_PERIOD = 5 * 60 // 5 minutes in seconds
    const effectiveExpirationTime = booking.tokenExpiresAt 
      ? booking.tokenExpiresAt + TOKEN_GRACE_PERIOD 
      : null
    
    if (effectiveExpirationTime && bangkokNow > effectiveExpirationTime) {
      await logger.warn('Deposit upload rejected: token expired (after grace period)', { 
        bookingId: booking.id, 
        tokenExpiresAt: booking.tokenExpiresAt, 
        now: bangkokNow,
        gracePeriod: TOKEN_GRACE_PERIOD
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Token has expired. The booking start date has passed.",
        undefined,
        400,
        { requestId }
      )
    }
    
    // Check if booking start date has passed
    // Convert startDate string (YYYY-MM-DD) to timestamp
    if (!booking.startDate) {
      await logger.warn('Deposit upload rejected: missing start date', { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Booking is missing start date.",
        undefined,
        400,
        { requestId }
      )
    }
    
    const { createBangkokTimestamp } = await import("@/lib/timezone")
    const startDateTimestamp = createBangkokTimestamp(booking.startDate)
    const startTimestamp = calculateStartTimestamp(
      startDateTimestamp,
      booking.startTime || null
    )
    
    if (startTimestamp < bangkokNow) {
      await logger.warn('Deposit upload rejected: start date passed', { bookingId: booking.id, startTimestamp, now: bangkokNow })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Cannot upload deposit: booking start date has passed.",
        undefined,
        400,
        { requestId }
      )
    }

    // Prevent concurrent deposit uploads - check if deposit was recently uploaded (within last 5 seconds)
    const DEPOSIT_UPLOAD_COOLDOWN = 5 // seconds
    const now = bangkokNow
    if (booking.updatedAt && (now - booking.updatedAt) < DEPOSIT_UPLOAD_COOLDOWN && booking.depositEvidenceUrl) {
      await logger.warn('Deposit upload rejected: cooldown period', { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        "Deposit was recently uploaded. Please wait a moment before uploading again.",
        undefined,
        429,
        { requestId }
      )
    }

    // Delete old deposit evidence image if it exists (before uploading new one)
    if (booking.depositEvidenceUrl) {
      try {
        const { deleteImage } = await import("@/lib/blob")
        await deleteImage(booking.depositEvidenceUrl)
        await logger.info('Deleted old deposit evidence blob before uploading new one', { oldBlobUrl: booking.depositEvidenceUrl, bookingId: booking.id })
      } catch (blobError) {
        // Log error but continue with upload - queue cleanup job as fallback
        await logger.error("Failed to delete old deposit evidence blob", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: booking.depositEvidenceUrl, bookingId: booking.id })
        
        // Queue cleanup job for retry (fail-safe approach)
        try {
          const { enqueueJob } = await import("@/lib/job-queue")
          await enqueueJob("cleanup-orphaned-blob", { blobUrl: booking.depositEvidenceUrl }, { priority: 1 })
          await logger.info('Queued orphaned blob cleanup job for old deposit evidence', { blobUrl: booking.depositEvidenceUrl })
        } catch (queueError) {
          await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: booking.depositEvidenceUrl })
        }
      }
    }

    // Process and upload deposit evidence image
    await logger.info('Processing deposit image', { bookingId: booking.id })
    const processed = await processAndUploadImage(
      file,
      `deposit-${booking.id}-${Date.now()}`,
      {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 85,
        format: "webp",
      }
    )
    
    await logger.info('Deposit image processed and uploaded', { bookingId: booking.id, depositUrl: processed.url })

    // RE-CHECK BOOKING RIGHT BEFORE UPDATE (minimize race condition window)
    // This ensures we have the latest booking state before updating
    const { getBookingById } = await import("@/lib/bookings")
    const recheckBooking = await getBookingById(booking.id)
    
    if (!recheckBooking) {
      await logger.error('Deposit upload failed: booking not found during re-check', new Error('Booking not found during re-check'), { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Booking not found. Please refresh and try again.",
        undefined,
        404,
        { requestId }
      )
    }

    // Verify booking status still allows deposit upload
    if (recheckBooking.status !== "pending_deposit" && recheckBooking.status !== "pending") {
      await logger.warn('Deposit upload rejected: booking status changed', { 
        bookingId: booking.id, 
        oldStatus: booking.status, 
        newStatus: recheckBooking.status 
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Booking status changed to "${recheckBooking.status}". Deposit can only be uploaded for pending or pending_deposit bookings.`,
        undefined,
        400,
        { requestId }
      )
    }

    // CRITICAL: Re-validate token before database update
    // This prevents token expiration during long image processing operations
    // Use extended grace period (15 min) for deposit uploads since image processing can take time
    try {
      const { revalidateTokenBeforeOperation } = await import("@/lib/token-validation")
      revalidateTokenBeforeOperation(recheckBooking, "deposit_upload", true) // true = use extended grace period
      await logger.info('Token re-validated before database update', { bookingId: booking.id })
    } catch (tokenError) {
      // CRITICAL: Cleanup orphaned blob if token validation failed
      // The blob was uploaded successfully but token validation failed
      try {
        const { deleteImage } = await import("@/lib/blob")
        await deleteImage(processed.url)
        await logger.info('Cleaned up orphaned deposit blob after token validation failure', {
          bookingId: booking.id,
          blobUrl: processed.url
        })
      } catch (cleanupError) {
        // If cleanup fails, queue it for background cleanup
        await logger.error('Failed to cleanup orphaned deposit blob after token failure, queueing for background cleanup', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)), {
          bookingId: booking.id,
          blobUrl: processed.url
        })
        try {
          const { enqueueJob } = await import("@/lib/job-queue")
          await enqueueJob("cleanup-orphaned-blob", { blobUrl: processed.url }, { priority: 1 })
          await logger.info('Queued orphaned blob cleanup job for token validation failure', { blobUrl: processed.url })
        } catch (queueError) {
          await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: processed.url })
        }
      }
      
      await logger.warn('Token expired during deposit upload operation', {
        bookingId: booking.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError),
        depositUrl: processed.url // Blob was uploaded successfully (now cleaned up)
      })
      return errorResponse(
        ErrorCodes.TOKEN_EXPIRED,
        "Your session expired during the upload process. Please try again.",
        {
          error: "Token expired during operation"
        },
        410, // 410 Gone
        { requestId }
      )
    }

    // Get old status and updatedAt from re-checked booking (for optimistic locking)
    const oldStatus = recheckBooking.status
    const originalUpdatedAt = recheckBooking.updatedAt

    // Update booking with deposit evidence (status changes to "paid_deposit")
    // updateBookingStatus already has optimistic locking, so if booking was modified, it will throw
    try {
      const updatedBooking = await updateBookingStatus(booking.id, "paid_deposit", {
        depositEvidenceUrl: processed.url,
        sendNotification: false, // We'll send email manually
      })

      // Send user notification for deposit upload
      try {
        await sendBookingStatusNotification(updatedBooking, "paid_deposit", {
          changeReason: "Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your booking shortly.",
          responseToken: updatedBooking.responseToken, // Token for future access if needed
        })
        await logger.info('User notification sent for deposit upload', { bookingId: booking.id })
      } catch (userEmailError) {
        await logger.error('Failed to send user notification for deposit upload', userEmailError instanceof Error ? userEmailError : new Error(String(userEmailError)))
        // Don't fail the request - email is secondary
      }

      // Send admin notification for deposit upload
      try {
        await sendAdminStatusChangeNotification(
          updatedBooking,
          oldStatus,
          "paid_deposit",
          "User uploaded deposit evidence",
          "system"
        )
        await logger.info('Admin notification sent for deposit upload', { bookingId: booking.id })
      } catch (adminEmailError) {
        await logger.error('Failed to send admin notification for deposit upload', adminEmailError instanceof Error ? adminEmailError : new Error(String(adminEmailError)))
        // Don't fail the request - email is secondary
      }

      await logger.info('Deposit upload completed successfully', { bookingId: booking.id, depositUrl: processed.url })
      return successResponse(
        {
          message: "Deposit evidence uploaded successfully. Admin will review and confirm your booking shortly.",
          depositUrl: processed.url,
        },
        { requestId }
      )
    } catch (updateError) {
      // CRITICAL: Cleanup orphaned blob if database update failed
      // The blob was uploaded successfully but booking update failed, leaving it orphaned
      try {
        const { deleteImage } = await import("@/lib/blob")
        await deleteImage(processed.url)
        await logger.info('Cleaned up orphaned deposit blob after database update failure', {
          bookingId: booking.id,
          blobUrl: processed.url
        })
      } catch (cleanupError) {
        // If cleanup fails, queue it for background cleanup
        await logger.error('Failed to cleanup orphaned deposit blob, queueing for background cleanup', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)), {
          bookingId: booking.id,
          blobUrl: processed.url
        })
        try {
          const { enqueueJob } = await import("@/lib/job-queue")
          await enqueueJob("cleanup-orphaned-blob", { blobUrl: processed.url }, { priority: 1 })
          await logger.info('Queued orphaned blob cleanup job for failed deposit upload', { blobUrl: processed.url })
        } catch (queueError) {
          await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: processed.url })
        }
      }
      
      // Check if error is due to optimistic locking conflict
      const errorMessage = updateError instanceof Error ? updateError.message : "Failed to update booking"
      
      // Log the full error for debugging
      await logger.error('Deposit upload failed: database update error', updateError instanceof Error ? updateError : new Error(String(updateError)), {
        bookingId: booking.id,
        errorMessage,
        depositUrl: processed.url, // Blob was uploaded successfully (now cleaned up)
      })
      
      if (errorMessage.includes("modified by another process") || errorMessage.includes("Invalid status transition")) {
        await logger.warn('Deposit upload failed: booking conflict', { 
          bookingId: booking.id, 
          error: errorMessage 
        })
        // Track monitoring metric
        try {
          const { trackOptimisticLockConflict } = await import('@/lib/monitoring')
          trackOptimisticLockConflict('booking', booking.id, { requestId, action: 'deposit_upload' })
        } catch {
          // Ignore monitoring errors
        }
        return errorResponse(
          ErrorCodes.CONFLICT,
          "Booking was modified by another process. Please refresh and try again.",
          undefined,
          409,
          { requestId }
        )
      }
      
      // Check if error is due to missing database column
      if (errorMessage.includes("no such column") || errorMessage.includes("deposit_verified_from_other_channel")) {
        await logger.error('Deposit upload failed: database schema missing column', updateError instanceof Error ? updateError : new Error(String(updateError)), {
          bookingId: booking.id,
          suggestion: "Database needs to be reinitialized to add the new deposit_verified_from_other_channel column"
        })
        return errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Database schema error. Please contact administrator. The deposit image upload was rolled back.",
          {
            error: "Database column missing. Please reinitialize the database.",
          },
          500,
          { requestId }
        )
      }
      
      // Re-throw other errors with more context
      throw new Error(`Failed to update booking after deposit upload: ${errorMessage}. Deposit image upload was rolled back.`)
    }
  }, { endpoint: '/api/booking/deposit' })
}

