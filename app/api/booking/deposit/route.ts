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
 * - Updates booking status to "paid_deposit"
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

    // Validate booking status - must be "accepted", "pending_deposit", or "postponed" (if no deposit uploaded yet)
    // Allow postponed status if:
    // 1. No deposit evidence uploaded yet (user hasn't uploaded)
    // 2. No proposed_date (admin just postponed, not user proposing) OR has proposed_date but still no deposit
    // This handles the case where admin postpones from "accepted" and preserves the deposit link
    const canUploadDeposit = 
      booking.status === "accepted" || 
      booking.status === "pending_deposit" ||
      (booking.status === "postponed" && !booking.depositEvidenceUrl)
    
    if (!canUploadDeposit) {
      await logger.warn('Deposit upload rejected: invalid status', { bookingId: booking.id, status: booking.status, hasDeposit: !!booking.depositEvidenceUrl })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Deposit can only be uploaded for accepted, pending_deposit, or postponed bookings (without existing deposit). Current status: ${booking.status}`,
        undefined,
        400,
        { requestId }
      )
    }

    // Prevent concurrent deposit uploads - check if deposit was recently uploaded (within last 5 seconds)
    const DEPOSIT_UPLOAD_COOLDOWN = 5 // seconds
    const { getBangkokTime } = await import("@/lib/timezone")
    const now = getBangkokTime()
    if (booking.updated_at && (now - booking.updated_at) < DEPOSIT_UPLOAD_COOLDOWN && booking.deposit_evidence_url) {
      await logger.warn('Deposit upload rejected: cooldown period', { bookingId: booking.id })
      return errorResponse(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        "Deposit was recently uploaded. Please wait a moment before uploading again.",
        undefined,
        429,
        { requestId }
      )
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

    // Get old status and updated_at before update (for optimistic locking)
    const oldStatus = booking.status
    const originalUpdatedAt = booking.updated_at

    // Update booking with deposit evidence and change status to "paid_deposit"
    // updateBookingStatus already has optimistic locking, so if booking was modified, it will throw
    try {
      const updatedBooking = await updateBookingStatus(booking.id, "paid_deposit", {
        depositEvidenceUrl: processed.url,
        sendNotification: false, // We'll send email manually with proper token
      })

      // Send user notification for deposit upload (status: paid_deposit)
      try {
        await sendBookingStatusNotification(updatedBooking, "paid_deposit", {
          changeReason: "Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your check-in shortly.",
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
          message: "Deposit evidence uploaded successfully. Admin will verify and confirm check-in.",
          depositUrl: processed.url,
        },
        { requestId }
      )
    } catch (updateError) {
      // Check if error is due to optimistic locking conflict
      const errorMessage = updateError instanceof Error ? updateError.message : "Failed to update booking"
      if (errorMessage.includes("modified by another process") || errorMessage.includes("Invalid status transition")) {
        await logger.warn('Deposit upload failed: booking conflict', { 
          bookingId: booking.id, 
          error: errorMessage 
        })
        return errorResponse(
          ErrorCodes.CONFLICT,
          "Booking was modified by another process. Please refresh and try again.",
          undefined,
          409,
          { requestId }
        )
      }
      // Re-throw other errors
      throw updateError
    }
  }, { endpoint: '/api/booking/deposit' })
}

