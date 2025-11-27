/**
 * Admin Bulk Delete Bookings API v1
 * 
 * Versioned endpoint for admin bulk booking deletion
 * 
 * POST /api/v1/admin/bookings/delete-all - Delete all active or archive bookings
 * - Requires Google Workspace authentication
 * - Deletes all active or archive bookings
 * - Body: { type: "active" | "archive" }
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { logAdminAction, formatBooking } from "@/lib/bookings"
import { sendAdminBookingDeletionNotification } from "@/lib/email"
import {
  requireAuthorizedDomain,
  getAuthSession,
} from "@/lib/auth"
import { deleteImage } from "@/lib/blob"
import { enqueueJob } from "@/lib/job-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

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

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
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

    // FIXED: Get all bookings to delete BEFORE deletion (Issue #7)
    // This ensures we can check status and send emails for all bookings, even if they're already cancelled/finished
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
    
    // FIXED: Filter bookings that need user cancellation emails BEFORE deletion
    // This ensures we send emails for all active bookings, even if some are already cancelled/finished
    const bookingsNeedingUserNotification = bookings.filter((booking: any) => {
      // Only send user cancellation emails for active bookings that weren't already cancelled/finished
      return bookingType === "active" &&
             booking.status !== "cancelled" &&
             booking.status !== "finished"
    })

    // CRITICAL: Acquire action lock to prevent concurrent bulk deletions
    // Use dynamic resource ID based on bookingType to allow independent locks for active vs archive
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        const resourceId = `delete_all_${bookingType}_bookings` // Dynamic resource ID based on bookingType
        const actionType = `delete_all_${bookingType}`
        actionLockId = await acquireActionLock('dashboard', resourceId, actionType, adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is performing bulk deletion', {
            bookingType,
            resourceId,
            action: actionType,
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            `Another admin is currently performing a bulk deletion of ${bookingType} bookings. Please wait a moment and try again.`,
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { bookingType, resourceId, action: actionType, lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          bookingType
        })
      }
    }
    
    // Ensure lock is released even if deletion fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { lockId: actionLockId })
          // Clear lock ID to make function idempotent
          actionLockId = null
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            lockId: actionLockId
          })
        }
      }
    }

    // CRITICAL: Set up automatic lock extension for long operations
    // Bulk deletion can take longer than 30 seconds, so we need to extend the lock automatically
    // Declare lockManager outside try block so it's accessible in finally block
    let lockManager: Awaited<ReturnType<typeof import('@/lib/action-lock').createLockExtensionManager>> | null = null
    if (actionLockId && adminEmail) {
      try {
        const { createLockExtensionManager } = await import('@/lib/action-lock')
        lockManager = createLockExtensionManager(actionLockId, adminEmail)
        if (lockManager) {
          // FIXED: Wrap start() in try-catch to ensure cleanup on failure (Issue #1)
          try {
            lockManager.start()
            await logger.debug('Automatic lock extension started for bulk deletion', { bookingType, lockId: actionLockId })
          } catch (startError) {
            // If start() fails, stop the manager to prevent memory leaks
            lockManager.stop()
            await logger.warn('Failed to start lock extension manager for bulk deletion', {
              bookingType,
              lockId: actionLockId,
              error: startError instanceof Error ? startError.message : String(startError),
            })
            lockManager = null // Clear manager reference
          }
        }
      } catch (importError) {
        // If import fails, log but continue (lock extension is optional)
        await logger.warn('Failed to import lock extension manager for bulk deletion', {
          bookingType,
          error: importError instanceof Error ? importError.message : String(importError),
        })
      }
    }

    // CRITICAL: Use try-finally to ensure lock is ALWAYS released, even on unhandled exceptions
    try {
      // CRITICAL: Broadcast booking deletion events BEFORE deletion (need booking data)
    // Loop through bookings array and broadcast each deletion
    try {
      const { broadcastBookingEvent } = await import('../stream/route')
      
      for (const bookingRow of bookings) {
        try {
          // Prepare booking data with raw timestamps (Unix timestamps, not date strings)
          const bookingData = {
            id: bookingRow.id,
            reference_number: bookingRow.reference_number ?? null,
            name: bookingRow.name,
            email: bookingRow.email,
            phone: bookingRow.phone ?? null,
            participants: bookingRow.participants ?? null,
            event_type: bookingRow.event_type,
            other_event_type: bookingRow.other_event_type ?? null,
            date_range: bookingRow.date_range ?? 0,
            start_date: bookingRow.start_date ?? null,
            end_date: bookingRow.end_date ?? null,
            start_time: bookingRow.start_time ?? null,
            end_time: bookingRow.end_time ?? null,
            organization_type: bookingRow.organization_type ?? null,
            organized_person: bookingRow.organized_person ?? null,
            introduction: bookingRow.introduction ?? null,
            biography: bookingRow.biography ?? null,
            special_requests: bookingRow.special_requests ?? null,
            status: bookingRow.status,
            admin_notes: bookingRow.admin_notes ?? null,
            response_token: bookingRow.response_token ?? null,
            token_expires_at: bookingRow.token_expires_at ?? null,
            proposed_date: bookingRow.proposed_date ?? null,
            proposed_end_date: bookingRow.proposed_end_date ?? null,
            user_response: bookingRow.user_response ?? null,
            response_date: bookingRow.response_date ?? null,
            deposit_evidence_url: bookingRow.deposit_evidence_url ?? null,
            deposit_verified_at: bookingRow.deposit_verified_at ?? null,
            deposit_verified_by: bookingRow.deposit_verified_by ?? null,
            deposit_verified_from_other_channel: bookingRow.deposit_verified_from_other_channel ?? false,
            fee_amount: bookingRow.fee_amount ?? null,
            fee_amount_original: bookingRow.fee_amount_original ?? null,
            fee_currency: bookingRow.fee_currency ?? null,
            fee_conversion_rate: bookingRow.fee_conversion_rate ?? null,
            fee_rate_date: bookingRow.fee_rate_date ?? null,
            fee_recorded_at: bookingRow.fee_recorded_at ?? null,
            fee_recorded_by: bookingRow.fee_recorded_by ?? null,
            fee_notes: bookingRow.fee_notes ?? null,
            created_at: bookingRow.created_at,
            updated_at: bookingRow.updated_at,
          }
          
          await broadcastBookingEvent('booking:deleted', bookingData, {
            changedBy: deletedBy,
            changeReason: `All ${bookingType} bookings deleted by administrator`,
          })
        } catch (broadcastError) {
          // Log but continue with other bookings
          await logger.warn('Failed to broadcast deletion for booking', {
            bookingId: bookingRow.id,
            error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
          })
        }
      }
      
      await logger.info(`Bulk deletion broadcasts sent for ${bookingCount} bookings`, { bookingType })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast bulk deletion events', {
        bookingType,
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      })
    }
    
    try {
      // Delete all bookings
      await db.execute({
        sql: `DELETE FROM bookings WHERE status IN (${placeholders})`,
        args: statusesToDelete,
      })
    } catch (error) {
      await releaseLock()
      throw error
    }
    
    // CRITICAL: Broadcast stats update (bulk deletion affects pending count)
    try {
      const { broadcastStatsUpdate } = await import('../../stats/stream/route')
      const { listBookings } = await import('@/lib/bookings')
      const { getEmailQueueStats } = await import('@/lib/email-queue')
      
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
      
      await logger.info('Stats update broadcast sent after bulk deletion')
    } catch (statsError) {
      // Don't fail if stats broadcast fails - it's non-critical
      await logger.warn('Failed to broadcast stats update after bulk deletion', {
        bookingType,
        error: statsError instanceof Error ? statsError.message : String(statsError),
      })
    }

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
      // Format booking to ensure proper field mapping (reference_number -> referenceNumber, etc.)
      const formattedBooking = formatBooking(booking)

      // Queue blob deletion
      if (formattedBooking.depositEvidenceUrl) {
        backgroundOperations.push(
          (async () => {
            try {
              await deleteImage(formattedBooking.depositEvidenceUrl!)
              await logger.info('Deleted deposit evidence blob', { blobUrl: formattedBooking.depositEvidenceUrl, bookingId: formattedBooking.id })
            } catch (blobError) {
              await logger.error("Failed to delete deposit evidence blob", blobError instanceof Error ? blobError : new Error(String(blobError)), { blobUrl: formattedBooking.depositEvidenceUrl, bookingId: formattedBooking.id })
              
              // Queue cleanup job for retry
              try {
                await enqueueJob("cleanup-orphaned-blob", { blobUrl: formattedBooking.depositEvidenceUrl! }, { priority: 1 })
                await logger.info('Queued orphaned blob cleanup job', { blobUrl: formattedBooking.depositEvidenceUrl })
              } catch (queueError) {
                await logger.error("Failed to queue orphaned blob cleanup", queueError instanceof Error ? queueError : new Error(String(queueError)), { blobUrl: formattedBooking.depositEvidenceUrl })
              }
            }
          })()
        )
      }

      // FIXED: Queue user notification email for bookings that need it (Issue #7)
      // Check if this booking needs user notification (determined BEFORE deletion)
      const needsUserNotification = bookingsNeedingUserNotification.some(
        (b: any) => b.id === formattedBooking.id
      )
      
      if (needsUserNotification) {
        backgroundOperations.push(
          (async () => {
            try {
              const { sendBookingStatusNotification } = await import("@/lib/email")
              await sendBookingStatusNotification(
                { ...formattedBooking, status: "cancelled" as const },
                "cancelled",
                {
                  changeReason: "All bookings have been deleted by administrator",
                  skipDuplicateCheck: true,
                }
              )
              await logger.info("Cancellation notification sent to user", { bookingId: formattedBooking.id, referenceNumber: formattedBooking.referenceNumber })
            } catch (emailError) {
              await logger.warn("User notification send failed", { bookingId: formattedBooking.id, error: emailError instanceof Error ? emailError.message : String(emailError) })
            }
          })()
        )
      }

      // Queue admin notification email for each booking
      backgroundOperations.push(
        (async () => {
          try {
            await sendAdminBookingDeletionNotification(formattedBooking, deletedBy)
            await logger.info("Admin deletion notification sent", { bookingId: formattedBooking.id, referenceNumber: formattedBooking.referenceNumber })
          } catch (emailError) {
            await logger.warn("Admin notification send failed", { bookingId: formattedBooking.id, error: emailError instanceof Error ? emailError.message : String(emailError) })
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

    await releaseLock()

    return successResponse(
      {
        message: `Successfully deleted ${bookingCount} ${bookingType} booking${bookingCount !== 1 ? "s" : ""}`,
        deletedCount: bookingCount,
        bookingType,
      },
      { requestId }
    )
    } finally {
      // CRITICAL: Stop automatic lock extension before releasing lock
      // FIXED: Ensure lockManager is stopped even if it was created but start() failed (Issue #2)
      // FIXED: Add defensive cleanup if stop() throws to prevent memory leaks (HIGH-3)
      if (lockManager) {
        try {
          lockManager.stop()
          await logger.debug('Automatic lock extension stopped for bulk deletion', { bookingType, lockId: actionLockId })
        } catch (stopError) {
          // FIXED: Log error but continue - lock release is more important (Issue #2)
          await logger.warn('Error stopping lock extension manager for bulk deletion', {
            bookingType,
            lockId: actionLockId,
            error: stopError instanceof Error ? stopError.message : String(stopError),
          })
          
          // FIXED: Defensive cleanup - try to manually clear interval if stop() failed (HIGH-3)
          // This is a last resort to prevent memory leaks if stop() throws unexpectedly
          try {
            // Access private intervalId via type assertion (last resort defensive measure)
            const manager = lockManager as any
            if (manager.intervalId) {
              clearInterval(manager.intervalId)
              manager.intervalId = null
              manager.isActive = false
              await logger.warn('Manually cleared lock extension interval after stop() failure for bulk deletion', {
                bookingType,
                lockId: actionLockId,
              })
            }
          } catch (cleanupError) {
            // Ignore cleanup errors - already logged the original error
            // This is a defensive measure, so failure here is acceptable
          }
        }
      }
      
      // CRITICAL: Always release lock, even if an unhandled exception occurs
      // This ensures locks are never left hanging, preventing other admins from being blocked
      // Note: releaseLock is idempotent, so calling it multiple times is safe
      await releaseLock()
    }
  }, { endpoint: getRequestPath(request) })
})

