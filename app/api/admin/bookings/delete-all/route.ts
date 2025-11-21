import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { logAdminAction } from "@/lib/bookings"
import { sendAdminBookingDeletionNotification } from "@/lib/email"
import {
  requireAuthorizedDomain,
  getAuthSession,
} from "@/lib/auth"
import { deleteImage } from "@/lib/blob"
import { enqueueJob } from "@/lib/job-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Admin Bulk Delete Bookings API
 * 
 * POST /api/admin/bookings/delete-all
 * - Requires Google Workspace authentication
 * - Deletes all active or archive bookings
 * - Body: { type: "active" | "archive" }
 */

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

export const POST = async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = "/api/admin/bookings/delete-all"
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin bulk delete bookings request')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin bulk delete rejected: authentication failed')
      return authError
    }

    // Parse request body
    let body: { type?: string }
    try {
      body = await request.json()
    } catch (error) {
      await logger.warn('Admin bulk delete failed: invalid request body', { error: error instanceof Error ? error.message : String(error) })
      return errorResponse(
        ErrorCodes.INVALID_INPUT,
        "Invalid request body",
        undefined,
        400,
        { requestId }
      )
    }

    const bookingType = body.type
    if (bookingType !== "active" && bookingType !== "archive") {
      await logger.warn('Admin bulk delete failed: invalid booking type', { bookingType })
      return errorResponse(
        ErrorCodes.INVALID_INPUT,
        "Invalid booking type. Must be 'active' or 'archive'",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined
    let deletedBy: string | undefined

    try {
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
        deletedBy = adminName ? `${adminName} (${adminEmail})` : adminEmail
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // Determine statuses to delete
    const statusesToDelete = bookingType === "active"
      ? ["pending", "pending_deposit", "paid_deposit", "confirmed"]
      : ["finished", "cancelled"]

    // Get all bookings to delete (for logging and notifications)
    const placeholders = statusesToDelete.map(() => "?").join(", ")
    const bookingsResult = await db.execute({
      sql: `SELECT * FROM bookings WHERE status IN (${placeholders})`,
      args: statusesToDelete,
    })

    const bookings = bookingsResult.rows as any[]
    const bookingCount = bookings.length

    if (bookingCount === 0) {
      await logger.info('No bookings found to delete', { bookingType })
      return successResponse(
        {
          message: `No ${bookingType} bookings found to delete`,
          deletedCount: 0,
        },
        { requestId }
      )
    }

    await logger.info(`Deleting ${bookingCount} ${bookingType} bookings`, { bookingType, count: bookingCount })

    // Delete all bookings
    await db.execute({
      sql: `DELETE FROM bookings WHERE status IN (${placeholders})`,
      args: statusesToDelete,
    })

    // Log admin action
    try {
      await logAdminAction({
        actionType: "delete_all_bookings",
        resourceType: "bookings",
        resourceId: "bulk",
        adminEmail,
        adminName,
        description: `Deleted all ${bookingType} bookings (${bookingCount} bookings)`,
        metadata: {
          bookingType,
          deletedCount: bookingCount,
          statuses: statusesToDelete,
        },
      })
    } catch (logError) {
      await logger.error("Failed to log admin action", logError instanceof Error ? logError : new Error(String(logError)))
    }

    // Queue background operations for each booking
    const backgroundOperations: Promise<void>[] = []

    for (const booking of bookings) {
      // Queue blob deletion
      if (booking.depositEvidenceUrl) {
        backgroundOperations.push(
          (async () => {
            try {
              await deleteImage(booking.depositEvidenceUrl)
              await logger.info('Deleted deposit evidence blob', { blobUrl: booking.depositEvidenceUrl, bookingId: booking.id })
            } catch (blobError) {
              await logger.error("Failed to delete deposit evidence blob", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: booking.depositEvidenceUrl, bookingId: booking.id })
              
              // Queue cleanup job for retry
              try {
                await enqueueJob("cleanup-orphaned-blob", { blobUrl: booking.depositEvidenceUrl }, { priority: 1 })
                await logger.info('Queued orphaned blob cleanup job', { blobUrl: booking.depositEvidenceUrl })
              } catch (queueError) {
                await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: booking.depositEvidenceUrl })
              }
            }
          })()
        )
      }

      // Queue user notification email (only for active bookings that weren't already cancelled/finished)
      if (
        bookingType === "active" &&
        booking.status !== "cancelled" &&
        booking.status !== "finished"
      ) {
        backgroundOperations.push(
          (async () => {
            try {
              const { sendBookingStatusNotification } = await import("@/lib/email")
              await sendBookingStatusNotification(
                { ...booking, status: "cancelled" as const },
                "cancelled",
                {
                  changeReason: "All bookings have been deleted by administrator",
                  skipDuplicateCheck: true,
                }
              )
              await logger.info("Cancellation notification sent to user", { bookingId: booking.id })
            } catch (emailError) {
              await logger.warn("User notification send failed", { bookingId: booking.id, error: emailError instanceof Error ? emailError.message : String(emailError) })
            }
          })()
        )
      }

      // Queue admin notification email for each booking
      backgroundOperations.push(
        (async () => {
          try {
            await sendAdminBookingDeletionNotification(booking, deletedBy)
            await logger.info("Admin deletion notification sent", { bookingId: booking.id })
          } catch (emailError) {
            await logger.warn("Admin notification send failed", { bookingId: booking.id, error: emailError instanceof Error ? emailError.message : String(emailError) })
          }
        })()
      )
    }

    // Start background operations but don't wait
    const backgroundPromise = Promise.allSettled(backgroundOperations)
      .then(async (results) => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          await logger.warn(`Some background operations failed during bulk deletion`, { 
            bookingType,
            failedCount: failed, 
            totalCount: results.length,
          })
        } else {
          await logger.info('All background operations completed for bulk deletion', { bookingType })
        }
      })
      .catch(async (error) => {
        await logger.error('Unexpected error in background operations promise handler', 
          error instanceof Error ? error : new Error(String(error)), 
          { bookingType }
        )
      })
    
    void backgroundPromise

    await logger.info(`Bulk deletion completed: ${bookingCount} ${bookingType} bookings deleted`, { bookingType, count: bookingCount })

    return successResponse(
      {
        message: `Successfully deleted ${bookingCount} ${bookingType} booking${bookingCount !== 1 ? "s" : ""}`,
        deletedCount: bookingCount,
        bookingType,
      },
      { requestId }
    )
  }, { endpoint: "/api/admin/bookings/delete-all" })
}

