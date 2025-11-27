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
 * Register all job handlers
 * Call this function during application startup or in the job queue processing endpoint
 */
export function registerAllJobHandlers(): void {
  registerJobHandler('cleanup-orphaned-blob', cleanupOrphanedBlob)
  registerJobHandler('cleanup-orphaned-blobs-batch', cleanupOrphanedBlobsBatch)
  registerJobHandler('send-booking-reminder', sendBookingReminder)
  
  // Only log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('✓ All job handlers registered')
  }
}

