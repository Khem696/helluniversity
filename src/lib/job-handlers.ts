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
          // We successfully deleted the image record - now delete the blob
          await logInfo('Deleted orphaned image record', { imageId: linkedImageId })
          
          if (blobUrl) {
            try {
              const { deleteImage } = await import('./blob')
              await deleteImage(blobUrl)
              await logInfo('Deleted orphaned image blob', { imageId: linkedImageId, blobUrl })
            } catch (blobError) {
              await logError(
                'Failed to delete orphaned image blob',
                { imageId: linkedImageId, blobUrl },
                blobError instanceof Error ? blobError : new Error(String(blobError))
              )
              // Image record is already deleted, blob deletion failure is logged but doesn't fail job
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
 * Register all job handlers
 * Call this function during application startup or in the job queue processing endpoint
 */
export function registerAllJobHandlers(): void {
  registerJobHandler('cleanup-orphaned-blob', cleanupOrphanedBlob)
  registerJobHandler('cleanup-orphaned-blobs-batch', cleanupOrphanedBlobsBatch)
  registerJobHandler('send-booking-reminder', sendBookingReminder)
  registerJobHandler('delete-event-image', deleteEventImage)
  
  console.log('✓ All job handlers registered')
}

