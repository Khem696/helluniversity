/**
 * Job Handlers
 * 
 * Register all background job handlers here
 */

import { registerJobHandler } from './job-queue'
import { deleteImage } from './blob'
import { logInfo, logError } from './logger'

/**
 * Cleanup orphaned blob (blob exists but not referenced in database)
 */
async function cleanupOrphanedBlob(payload: { blobUrl: string }): Promise<void> {
  const { blobUrl } = payload
  
  try {
    await logInfo('Cleaning up orphaned blob', { blobUrl })
    
    // Delete the blob
    await deleteImage(blobUrl)
    
    await logInfo('Orphaned blob cleaned up successfully', { blobUrl })
  } catch (error) {
    await logError(
      'Failed to cleanup orphaned blob',
      { blobUrl },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error // Will trigger retry
  }
}

/**
 * Delete orphaned blob (from event image deletion)
 * This is a separate job type for blob deletion to make event image deletion non-blocking
 */
async function deleteOrphanedBlob(payload: { blobUrl: string; imageId?: string }): Promise<void> {
  const { blobUrl, imageId } = payload
  
  try {
    await logInfo('Deleting orphaned blob', { blobUrl, imageId })
    
    // Delete the blob
    await deleteImage(blobUrl)
    
    await logInfo('Orphaned blob deleted successfully', { blobUrl, imageId })
  } catch (error) {
    await logError(
      'Failed to delete orphaned blob',
      { blobUrl, imageId },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error // Will trigger retry
  }
}

/**
 * Cleanup multiple orphaned blobs
 */
async function cleanupOrphanedBlobsBatch(payload: { blobUrls: string[] }): Promise<void> {
  const { blobUrls } = payload
  
  for (const blobUrl of blobUrls) {
    try {
      await cleanupOrphanedBlob({ blobUrl })
    } catch (error) {
      // Continue with other blobs even if one fails
      await logError('Failed to cleanup blob in batch', { blobUrl })
    }
  }
}

/**
 * Send booking reminder
 */
async function sendBookingReminder(payload: {
  bookingId: string
  reminderType: 'check-in' | 'deposit' | 'confirmation'
}): Promise<void> {
  const { bookingId, reminderType } = payload
  
  try {
    await logInfo('Sending booking reminder', { bookingId, reminderType })
    
    // Fetch booking
    const { getBookingById } = await import('./bookings')
    const booking = await getBookingById(bookingId)
    
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`)
    }
    
    // Send appropriate reminder email
    const { sendBookingStatusNotification } = await import('./email')
    await sendBookingStatusNotification(booking, booking.status, {
      changeReason: `Reminder: ${reminderType === 'check-in' ? 'Please confirm your check-in' : reminderType === 'deposit' ? 'Please upload your deposit evidence' : 'Please confirm your booking'}`,
      responseToken: booking.responseToken,
    })
    
    await logInfo('Booking reminder sent', { bookingId, reminderType })
  } catch (error) {
    await logError(
      'Failed to send booking reminder',
      { bookingId, reminderType },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error
  }
}

/**
 * Delete event image (background job)
 * Handles deletion of event_images record and orphaned image/blob cleanup
 */
async function deleteEventImage(payload: {
  eventId: string
  eventImageId: string
  imageId: string
}): Promise<void> {
  const { eventId, eventImageId, imageId } = payload
  
  try {
    await logInfo('Deleting event image', { eventId, eventImageId, imageId })
    
    const { getTursoClient } = await import('./turso')
    const db = getTursoClient()
    
    // Verify event_image still exists and belongs to the event
    const eventImageResult = await db.execute({
      sql: "SELECT image_id FROM event_images WHERE id = ? AND event_id = ?",
      args: [eventImageId, eventId],
    })
    
    let linkedImageId: string | null = null
    let eventImageWasDeleted = false
    
    if (eventImageResult.rows.length === 0) {
      // Event image link already deleted (e.g., by CASCADE when event was deleted)
      // This is OK - we still need to check if the image is orphaned
      await logInfo('Event image link already deleted (may be from CASCADE)', { eventId, eventImageId })
      eventImageWasDeleted = true
      // Use the provided imageId since we can't get it from the deleted record
      linkedImageId = imageId
    } else {
      linkedImageId = (eventImageResult.rows[0] as any).image_id
      
      // Verify imageId matches
      if (linkedImageId !== imageId) {
        await logError(
          'Image ID mismatch in delete job',
          { eventId, eventImageId, expectedImageId: imageId, actualImageId: linkedImageId },
          new Error('Image ID mismatch')
        )
        throw new Error('Image ID mismatch')
      }
      
      // Delete the event_images link
      await db.execute({
        sql: "DELETE FROM event_images WHERE id = ?",
        args: [eventImageId],
      })
      
      await logInfo('Event image link deleted', { eventId, eventImageId, linkedImageId })
    }
    
    // Check if the image is still used elsewhere (other events or event_images)
    const usageCheck = await db.execute({
      sql: `
        SELECT 
          (SELECT COUNT(*) FROM events WHERE image_id = ?) as event_count,
          (SELECT COUNT(*) FROM event_images WHERE image_id = ?) as event_image_count
      `,
      args: [linkedImageId, linkedImageId],
    })
    
    const usage = usageCheck.rows[0] as any
    const isStillUsed = (usage.event_count > 0) || (usage.event_image_count > 0)
    
    if (!isStillUsed) {
      // Image is orphaned - delete it and its blob
      // CRITICAL: Use atomic check-and-delete pattern to prevent race conditions
      // Multiple jobs might see the image as orphaned simultaneously, so we need to ensure
      // only one job actually deletes it
      await logInfo('Image is orphaned, attempting to delete image record and blob', { imageId: linkedImageId })
      
      try {
        // CRITICAL: Get blob URL BEFORE attempting to delete (atomic operation)
        // This ensures we have the blob URL even if another job deletes the record
        const imageResult = await db.execute({
          sql: "SELECT blob_url FROM images WHERE id = ?",
          args: [linkedImageId],
        })
        
        let blobUrl: string | null = null
        if (imageResult.rows.length > 0) {
          blobUrl = (imageResult.rows[0] as any).blob_url || null
        }
        
        // CRITICAL: Atomic delete with orphan check in WHERE clause
        // This ensures the image is only deleted if it's STILL orphaned at the moment of deletion
        // Prevents race condition where another process adds a reference between check and delete
        // Only one job will succeed (rowsAffected > 0) if image is still orphaned
        // If another job already deleted it or it's no longer orphaned, rowsAffected will be 0
        const deleteResult = await db.execute({
          sql: `
            DELETE FROM images 
            WHERE id = ? 
            AND (SELECT COUNT(*) FROM events WHERE image_id = ?) = 0 
            AND (SELECT COUNT(*) FROM event_images WHERE image_id = ?) = 0
          `,
          args: [linkedImageId, linkedImageId, linkedImageId],
        })
        
        const wasDeleted = (deleteResult.rowsAffected || 0) > 0
        
        if (wasDeleted) {
          // We successfully deleted the image record - now queue blob deletion (non-blocking)
          await logInfo('Deleted orphaned image record', { imageId: linkedImageId })
          
          if (blobUrl) {
            try {
              // OPTION C: Queue blob deletion as separate job (non-blocking)
              // This makes the main job much faster (~1-2 seconds instead of 4-6 seconds)
              const { enqueueJob } = await import('./job-queue')
              await enqueueJob(
                'delete-orphaned-blob',
                { blobUrl, imageId: linkedImageId },
                {
                  priority: 3, // Lower priority than event image deletion
                  maxRetries: 3,
                }
              )
              await logInfo('Queued orphaned blob deletion job', { imageId: linkedImageId, blobUrl })
            } catch (queueError) {
              // If we can't queue the job, try to delete immediately as fallback
              await logError(
                'Failed to queue blob deletion job, attempting immediate deletion',
                { imageId: linkedImageId, blobUrl },
                queueError instanceof Error ? queueError : new Error(String(queueError))
              )
              try {
                const { deleteImage } = await import('./blob')
                await deleteImage(blobUrl)
                await logInfo('Deleted orphaned image blob (fallback)', { imageId: linkedImageId, blobUrl })
              } catch (blobError) {
                await logError(
                  'Failed to delete orphaned image blob (fallback also failed)',
                  { imageId: linkedImageId, blobUrl },
                  blobError instanceof Error ? blobError : new Error(String(blobError))
                )
                // Image record is already deleted, blob deletion failure is logged but doesn't fail job
              }
            }
          } else {
            await logInfo('Image record deleted but no blob_url to delete', { imageId: linkedImageId })
          }
        } else {
          // Another job already deleted the image record - this is OK, just log it
          await logInfo('Image record already deleted by another job', { imageId: linkedImageId })
        }
      } catch (deleteError) {
        await logError(
          'Failed to delete orphaned image',
          { imageId: linkedImageId },
          deleteError instanceof Error ? deleteError : new Error(String(deleteError))
        )
        // Don't fail the job - the link is already deleted
      }
    } else {
      await logInfo('Image is still in use, keeping image record', {
        imageId: linkedImageId,
        eventCount: usage.event_count,
        eventImageCount: usage.event_image_count,
      })
    }
    
    await logInfo('Event image deletion completed successfully', { eventId, eventImageId, imageId })
  } catch (error) {
    await logError(
      'Failed to delete event image',
      { eventId, eventImageId, imageId },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error // Will trigger retry
  }
}

/**
 * Cleanup orphaned image (optimized - skips event_image check since it's already deleted)
 * Used when event_image was already deleted and we just need to check if image is orphaned
 */
async function cleanupOrphanedImage(payload: {
  imageId: string
  eventId?: string // For logging context
}): Promise<void> {
  const { imageId, eventId } = payload
  
  try {
    await logInfo('Cleaning up orphaned image', { imageId, eventId })
    
    const { getTursoClient } = await import('./turso')
    const db = getTursoClient()
    
    // Check if the image is still used elsewhere (other events or event_images)
    const usageCheck = await db.execute({
      sql: `
        SELECT 
          (SELECT COUNT(*) FROM events WHERE image_id = ?) as event_count,
          (SELECT COUNT(*) FROM event_images WHERE image_id = ?) as event_image_count
      `,
      args: [imageId, imageId],
    })
    
    const usage = usageCheck.rows[0] as any
    const isStillUsed = (usage.event_count > 0) || (usage.event_image_count > 0)
    
    if (!isStillUsed) {
      // Image is orphaned - delete it and queue blob deletion
      await logInfo('Image is orphaned, attempting to delete image record', { imageId })
      
      try {
        // Get blob URL BEFORE attempting to delete
        const imageResult = await db.execute({
          sql: "SELECT blob_url FROM images WHERE id = ?",
          args: [imageId],
        })
        
        let blobUrl: string | null = null
        if (imageResult.rows.length > 0) {
          blobUrl = (imageResult.rows[0] as any).blob_url || null
        }
        
        // Atomic delete with orphan check in WHERE clause
        const deleteResult = await db.execute({
          sql: `
            DELETE FROM images 
            WHERE id = ? 
            AND (SELECT COUNT(*) FROM events WHERE image_id = ?) = 0 
            AND (SELECT COUNT(*) FROM event_images WHERE image_id = ?) = 0
          `,
          args: [imageId, imageId, imageId],
        })
        
        const wasDeleted = (deleteResult.rowsAffected || 0) > 0
        
        if (wasDeleted) {
          await logInfo('Deleted orphaned image record', { imageId })
          
          if (blobUrl) {
            try {
              // Queue blob deletion as separate job (non-blocking)
              const { enqueueJob } = await import('./job-queue')
              await enqueueJob(
                'delete-orphaned-blob',
                { blobUrl, imageId },
                {
                  priority: 3,
                  maxRetries: 3,
                }
              )
              await logInfo('Queued orphaned blob deletion job', { imageId, blobUrl })
            } catch (queueError) {
              // Fallback to immediate deletion if queueing fails
              await logError(
                'Failed to queue blob deletion job, attempting immediate deletion',
                { imageId, blobUrl },
                queueError instanceof Error ? queueError : new Error(String(queueError))
              )
              try {
                const { deleteImage } = await import('./blob')
                await deleteImage(blobUrl)
                await logInfo('Deleted orphaned image blob (fallback)', { imageId, blobUrl })
              } catch (blobError) {
                await logError(
                  'Failed to delete orphaned image blob (fallback also failed)',
                  { imageId, blobUrl },
                  blobError instanceof Error ? blobError : new Error(String(blobError))
                )
              }
            }
          }
        } else {
          await logInfo('Image record already deleted by another job or no longer orphaned', { imageId })
        }
      } catch (deleteError) {
        await logError(
          'Failed to delete orphaned image',
          { imageId },
          deleteError instanceof Error ? deleteError : new Error(String(deleteError))
        )
        throw deleteError
      }
    } else {
      await logInfo('Image is still in use, keeping image record', {
        imageId,
        eventCount: usage.event_count,
        eventImageCount: usage.event_image_count,
      })
    }
    
    await logInfo('Orphaned image cleanup completed', { imageId, eventId })
  } catch (error) {
    await logError(
      'Failed to cleanup orphaned image',
      { imageId, eventId },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error
  }
}

/**
 * Register all job handlers
 * Call this function during application startup or in the job queue processing endpoint
 */
export function registerAllJobHandlers(): void {
  registerJobHandler('cleanup-orphaned-blob', cleanupOrphanedBlob)
  registerJobHandler('cleanup-orphaned-blobs-batch', cleanupOrphanedBlobsBatch)
  registerJobHandler('send-booking-reminder', sendBookingReminder)
  registerJobHandler('delete-event-image', deleteEventImage)
  registerJobHandler('delete-orphaned-blob', deleteOrphanedBlob)
  registerJobHandler('cleanup-orphaned-image', cleanupOrphanedImage) // New optimized handler
  
  console.log('✓ All job handlers registered')
}

