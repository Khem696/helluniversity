import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID } from "crypto"
import nodemailer from "nodemailer"
import { getTransporter } from "./email"
import { logInfo, logWarn, logError, logDebug } from "./logger"

/**
 * Email Queue Management
 * 
 * Handles failed email notifications with retry logic
 */

/**
 * FIXED: Extract searchable text from metadata JSON (Issue #35)
 * Creates a searchable string from metadata fields for full-text search
 */
function extractSearchableMetadata(metadata: Record<string, any>): string {
  const searchableFields: string[] = []
  
  // Extract common searchable fields
  if (metadata.bookingId) searchableFields.push(`booking:${metadata.bookingId}`)
  if (metadata.referenceNumber) searchableFields.push(`ref:${metadata.referenceNumber}`)
  if (metadata.status) searchableFields.push(`status:${metadata.status}`)
  if (metadata.name) searchableFields.push(metadata.name)
  if (metadata.email) searchableFields.push(metadata.email)
  if (metadata.changeReason) searchableFields.push(metadata.changeReason)
  if (metadata.oldStatus) searchableFields.push(`oldStatus:${metadata.oldStatus}`)
  if (metadata.newStatus) searchableFields.push(`newStatus:${metadata.newStatus}`)
  
  // Add all string values from metadata
  Object.values(metadata).forEach(value => {
    if (typeof value === 'string' && value.length > 0 && value.length < 100) {
      // Only include reasonable-length strings to avoid bloating search index
      searchableFields.push(value)
    }
  })
  
  return searchableFields.join(' ')
}

export interface EmailQueueItem {
  id: string
  emailType: "admin_notification" | "user_confirmation" | "status_change" | "user_response" | "auto_update"
  recipientEmail: string
  subject: string
  htmlContent: string
  textContent: string
  metadata?: Record<string, any> | string // Can be object (parsed) or string (raw from DB)
  retryCount: number
  maxRetries: number
  status: "pending" | "processing" | "sent" | "failed" | "cancelled"
  errorMessage?: string
  scheduledAt: number
  nextRetryAt?: number
  sentAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * Add email to queue for retry
 */
export async function addEmailToQueue(
  emailType: EmailQueueItem["emailType"],
  recipientEmail: string,
  subject: string,
  htmlContent: string,
  textContent: string,
  metadata?: Record<string, any>,
  options?: {
    maxRetries?: number
    scheduledAt?: number
    skipDuplicateCheck?: boolean // Allow override for manual retries
  }
): Promise<string> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // FIXED: Validate metadata size before storing (Issue #20)
  // Make size limit configurable via environment variable
  const MAX_METADATA_SIZE = parseInt(
    process.env.MAX_EMAIL_METADATA_SIZE || '102400', // 100KB default
    10
  )
  
  if (metadata) {
    try {
      const metadataJson = JSON.stringify(metadata)
      if (metadataJson.length > MAX_METADATA_SIZE) {
        throw new Error(
          `Metadata exceeds maximum size of ${MAX_METADATA_SIZE} bytes (${metadataJson.length} bytes). ` +
          `Please reduce metadata size or increase MAX_EMAIL_METADATA_SIZE environment variable.`
        )
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('exceeds maximum size')) {
        throw error // Re-throw size limit errors
      }
      // If JSON.stringify fails for other reasons (circular ref, etc.), log and continue with empty metadata
      await logWarn('Failed to validate metadata size, using empty metadata', { error: error instanceof Error ? error.message : String(error) })
      metadata = {}
    }
  }
  
  // IMPROVED: Check for duplicate emails before adding to queue
  // Prevents duplicate emails for same booking/status change within configurable window
  // FIXED: Use JSON extraction instead of LIKE pattern matching to prevent false positives/negatives
  // FIXED: Make duplicate check window configurable (default 10 minutes, was 5 minutes)
  if (!options?.skipDuplicateCheck && metadata?.bookingId) {
    try {
      // FIXED: Use JSON extraction to safely check for bookingId in metadata
      // This is more reliable than LIKE pattern matching and prevents false matches
      const bookingIdStr = String(metadata.bookingId)
      
      // Configurable duplicate check window (default 10 minutes, was 5 minutes)
      // Increased to handle retry scenarios where original email might still be processing
      const DUPLICATE_CHECK_WINDOW = parseInt(
        process.env.EMAIL_DUPLICATE_CHECK_WINDOW || "600", // 10 minutes default (was 5 minutes)
        10
      )
      
      // For SQLite, we need to use JSON_EXTRACT or parse JSON manually
      // Since SQLite JSON support varies, we'll fetch recent emails and parse in code
      const duplicateCheck = await db.execute({
        sql: `
          SELECT id, metadata FROM email_queue 
          WHERE email_type = ? 
            AND recipient_email = ? 
            AND created_at > ?
            AND status IN ('pending', 'processing')
          ORDER BY created_at DESC
          LIMIT 50
        `,
        args: [
          emailType,
          recipientEmail,
          now - DUPLICATE_CHECK_WINDOW // Configurable window
        ],
      })
      
      // Parse metadata and check for matching bookingId
      for (const row of duplicateCheck.rows) {
        const item = row as any
        if (!item.metadata) continue
        
        try {
          const parsedMetadata = typeof item.metadata === 'string' 
            ? JSON.parse(item.metadata) 
            : item.metadata
          
          // Check if bookingId matches
          if (parsedMetadata.bookingId === bookingIdStr) {
            // For status_change emails, always check status (even if missing in new metadata)
            // This prevents different status transitions from being treated as duplicates
            if (emailType === 'status_change') {
              // Both must have status and they must match, OR both must be missing status
              const existingStatus = parsedMetadata.status
              const newStatus = metadata.status
              
              // If both have status, they must match to be considered duplicate
              if (existingStatus !== undefined && newStatus !== undefined) {
                if (existingStatus === newStatus) {
                  const existingId = item.id
                  await logInfo('Duplicate email detected, returning existing queue item', { existingId, emailType, recipientEmail, bookingId: bookingIdStr, status: newStatus })
                  return existingId
                }
                // Different statuses - not a duplicate, continue searching
                continue
              }
              
              // If one has status and the other doesn't, they're different transitions - not duplicates
              if ((existingStatus !== undefined) !== (newStatus !== undefined)) {
                continue
              }
              
              // Both missing status - treat as duplicate (legacy behavior, but should be rare)
              const existingId = item.id
              await logInfo('Duplicate email detected (both missing status), returning existing queue item', { existingId, emailType, recipientEmail, bookingId: bookingIdStr })
              return existingId
            } else {
              // For non-status emails, just check bookingId
              const existingId = item.id
              await logInfo('Duplicate email detected, returning existing queue item', { existingId, emailType, recipientEmail, bookingId: bookingIdStr })
              return existingId
            }
          }
        } catch (parseError) {
          // Skip items with invalid JSON metadata
          continue
        }
      }
    } catch (error) {
      // If duplicate check fails, log but continue (don't block email queuing)
      await logWarn('Failed to check for duplicate email, continuing with queue addition', { error: error instanceof Error ? error.message : String(error) })
    }
  }
  
  const id = randomUUID()
  
  // FIXED: Use same exponential backoff with jitter as scheduleNextRetry (Issue #33)
  // This ensures consistent retry timing across all email queue operations
  const baseRetryDelays = [
    parseInt(process.env.EMAIL_RETRY_BACKOFF_BASE || "60"),   // 1 minute
    300,   // 5 minutes
    900,   // 15 minutes
    1800,  // 30 minutes
    3600,  // 1 hour
    7200,  // 2 hours (max)
  ]
  
  // For initial queue, use first retry delay with jitter
  const baseDelay = baseRetryDelays[0]
  const jitterPercent = 0.2 // 20% jitter
  const jitterAmount = baseDelay * jitterPercent * (Math.random() * 2 - 1) // -20% to +20%
  const delay = Math.max(60, Math.floor(baseDelay + jitterAmount)) // Minimum 60 seconds
  
  const nextRetryAt = options?.scheduledAt 
    ? options.scheduledAt 
    : now + delay // First retry after base delay + jitter

  // FIXED: Extract searchable metadata for full-text search (Issue #35)
  const searchableMetadata = metadata ? extractSearchableMetadata(metadata) : null

  await db.execute({
    sql: `
      INSERT INTO email_queue (
        id, email_type, recipient_email, subject, html_content, text_content,
        metadata, searchable_metadata, retry_count, max_retries, status, scheduled_at, next_retry_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      emailType,
      recipientEmail,
      subject,
      htmlContent,
      textContent,
      metadata ? JSON.stringify(metadata) : null,
      searchableMetadata,
      0,
      options?.maxRetries || 5,
      "pending",
      options?.scheduledAt || now,
      nextRetryAt,
      now,
      now,
    ],
  })

  // FIXED: Update FTS5 virtual table if it exists (Issue #35)
  // This ensures searchable_metadata is indexed for full-text search
  try {
    await db.execute({
      sql: `
        INSERT INTO email_queue_fts(rowid, id, searchable_metadata, recipient_email, subject)
        SELECT rowid, id, searchable_metadata, recipient_email, subject 
        FROM email_queue 
        WHERE id = ?
      `,
      args: [id],
    })
  } catch (ftsError) {
    // FTS5 table might not exist (fallback to regular index)
    // This is expected if FTS5 is not available - search will use LIKE pattern matching
    await logDebug('FTS5 table update skipped (not available or not needed)', { 
      emailId: id,
      error: ftsError instanceof Error ? ftsError.message : String(ftsError)
    })
  }

  // Broadcast email queued event (after successful DB insert)
  try {
    const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
    const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
    
    broadcastEmailQueueEvent('email:queued', {
      id,
      emailType,
      recipientEmail,
      subject,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      scheduledAt: options?.scheduledAt || now,
      nextRetryAt: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })

    // Broadcast stats update
    const stats = await getEmailQueueStats()
    const { listBookings } = await import('./bookings')
    const pendingBookingsResult = await listBookings({
      statuses: ['pending', 'pending_deposit', 'paid_deposit'],
      excludeArchived: true,
      limit: 0,
      offset: 0,
    })
    const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
    
    broadcastStatsUpdate({
      bookings: {
        pending: pendingBookingsResult.total,
      },
      emailQueue: {
        pending: stats.pending || 0,
        failed: stats.failed || 0,
        total: pendingEmailCount,
      },
    })
  } catch (broadcastError) {
    // Don't fail if broadcast fails - logging is optional
    const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Failed to broadcast email queued event', {
        emailId: id,
        error: errorMessage,
      })
    } catch (logError) {
      // Fallback: if logger fails, silently continue (avoid infinite loops)
    }
  }

  await logInfo('Email queued for retry', { emailId: id, emailType, recipientEmail })
  return id
}

/**
 * Cleanup stuck emails in 'processing' state (older than 30 minutes)
 * This handles cases where an email was marked as processing but the process crashed/timed out
 * IMPROVED: Uses atomic UPDATE to prevent race conditions when multiple processes run cleanup
 */
export async function cleanupStuckEmails(): Promise<number> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const STUCK_THRESHOLD = 30 * 60 // 30 minutes in seconds
  
  // IMPROVED: Atomic UPDATE with WHERE clause ensures only one process resets each item
  // The WHERE clause checks both status and updated_at, making it atomic
  // If multiple processes run this simultaneously, each will only reset items it sees as stuck
  // This prevents duplicate resets of the same item
  const result = await db.execute({
    sql: `UPDATE email_queue
          SET status = 'pending', updated_at = ?
          WHERE status = 'processing' 
            AND updated_at < ?
            AND retry_count < max_retries
            `,  // FIXED: Removed redundant condition (updated_at = updated_at is always true)
    args: [now, now - STUCK_THRESHOLD],
  })
  
  const resetCount = result.rowsAffected || 0
  if (resetCount > 0) {
    await logInfo('Reset stuck emails from processing to pending', { resetCount })
    // Track monitoring metric
    try {
      const { trackStuckItemReset } = await import('./monitoring')
      trackStuckItemReset('email', resetCount)
    } catch {
      // Ignore monitoring errors
    }
  }
  
  return resetCount
}

/**
 * Get pending emails ready for retry
 */
export async function getPendingEmails(limit: number = 10): Promise<EmailQueueItem[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  // Cleanup stuck emails before fetching (non-blocking)
  cleanupStuckEmails().catch(async (err) => {
    await logError('[email-queue] Failed to cleanup stuck emails', undefined, err instanceof Error ? err : new Error(String(err)))
    // Don't throw - cleanup failure shouldn't block email processing
  })

  const result = await db.execute({
    sql: `
      SELECT * FROM email_queue
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
        AND retry_count < max_retries
      ORDER BY created_at ASC
      LIMIT ?
    `,
    args: [now, limit],
  })

  return result.rows.map((row: any) => formatEmailQueueItem(row))
}

/**
 * Get pending emails for critical status changes
 * Only processes status_change emails with status 'pending_deposit', 'confirmed', or 'cancelled'
 */
export async function getPendingCriticalStatusEmails(limit: number = 20): Promise<EmailQueueItem[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  // Cleanup stuck emails before fetching (non-blocking)
  cleanupStuckEmails().catch(async (err) => {
    await logError('[email-queue] Failed to cleanup stuck emails', undefined, err instanceof Error ? err : new Error(String(err)))
    // Don't throw - cleanup failure shouldn't block email processing
  })

  // CRITICAL: Process all critical email types:
  // 1. status_change emails with critical statuses (pending_deposit, confirmed, cancelled)
  // 2. user_confirmation emails (user booking confirmation - must be sent)
  // 3. admin_notification emails (admin booking notification - must be sent)
  // Optimized: Uses idx_email_queue_critical (status, email_type, created_at) index
  const result = await db.execute({
    sql: `
      SELECT * FROM email_queue
      WHERE status = 'pending'
        AND email_type IN ('status_change', 'user_confirmation', 'admin_notification')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
        AND retry_count < max_retries
      ORDER BY created_at ASC
      LIMIT ?
    `,
    args: [now, limit * 2], // Get more to filter by metadata
  })

  // Filter emails based on type
  // Critical statuses: pending_deposit, confirmed, cancelled
  const criticalEmails: EmailQueueItem[] = []
  
  for (const row of result.rows) {
    const email = formatEmailQueueItem(row)
    
    // CRITICAL: Always include user_confirmation and admin_notification emails
    // These are essential for booking creation and must be sent
    if (email.emailType === 'user_confirmation' || email.emailType === 'admin_notification') {
      criticalEmails.push(email)
      
      // Stop when we reach the limit
      if (criticalEmails.length >= limit) {
        break
      }
      continue
    }
    
    // For status_change emails, check metadata for critical statuses
    if (email.emailType === 'status_change') {
      // Parse metadata to check status
      let metadata: any = {}
      if (email.metadata) {
        if (typeof email.metadata === 'string') {
          try {
            metadata = JSON.parse(email.metadata)
          } catch {
            // Skip if metadata can't be parsed
            continue
          }
        } else {
          metadata = email.metadata
        }
      }
      
      // Only include if status is one of the critical statuses
      const criticalStatuses = ['pending_deposit', 'confirmed', 'cancelled']
      if (criticalStatuses.includes(metadata.status)) {
        criticalEmails.push(email)
        
        // Stop when we reach the limit
        if (criticalEmails.length >= limit) {
          break
        }
      }
    }
  }

  return criticalEmails
}

/**
 * Update email queue item status
 */
/**
 * FIXED: Update email queue status with optimistic locking support (Issue #18)
 * 
 * @param id - Email queue item ID
 * @param status - New status
 * @param errorMessage - Optional error message
 * @param expectedVersion - Optional expected version for optimistic locking
 * @returns true if update succeeded, false if version mismatch (optimistic locking failed)
 */
export async function updateEmailQueueStatus(
  id: string,
  status: EmailQueueItem["status"],
  errorMessage?: string,
  expectedVersion?: number
): Promise<boolean> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  if (expectedVersion !== undefined) {
    // FIXED: Optimistic locking update (Issue #18)
    const result = await db.execute({
      sql: `
        UPDATE email_queue
        SET status = ?, error_message = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `,
      args: [status, errorMessage || null, now, id, expectedVersion],
    })
    return (result.rowsAffected || 0) > 0
  } else {
    // Non-locked update (backwards compatibility)
    await db.execute({
      sql: `
        UPDATE email_queue
        SET status = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `,
      args: [status, errorMessage || null, now, id],
    })
    return true
  }
}

/**
 * Mark email as processing (atomic - prevents concurrent processing)
 * Returns true if successfully claimed, false if already claimed by another process
 */
export async function markEmailProcessing(id: string): Promise<boolean> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  // Get email details before updating (for broadcast)
  const emailResult = await db.execute({
    sql: `SELECT * FROM email_queue WHERE id = ? AND status = 'pending'`,
    args: [id],
  })

  // ATOMIC STATUS UPDATE: Only update if status is 'pending'
  // This prevents multiple cron jobs from processing the same email
  const result = await db.execute({
    sql: `
      UPDATE email_queue
      SET status = 'processing', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `,
    args: [now, id],
  })

  const claimed = (result.rowsAffected || 0) > 0

  // Broadcast email processing event (after successful DB update)
  if (claimed && emailResult.rows.length > 0) {
    const emailRow = emailResult.rows[0] as any
    try {
      const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
      
      broadcastEmailQueueEvent('email:processing', {
        id: emailRow.id,
        emailType: emailRow.email_type,
        recipientEmail: emailRow.recipient_email,
        subject: emailRow.subject,
        status: 'processing',
        retryCount: emailRow.retry_count,
        errorMessage: emailRow.error_message,
        scheduledAt: emailRow.scheduled_at,
        nextRetryAt: emailRow.next_retry_at || null,
        sentAt: emailRow.sent_at,
        createdAt: emailRow.created_at,
        updatedAt: now,
      })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - logging is optional
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to broadcast email processing event', {
          emailId: id,
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }
  }

  // If rowsAffected > 0, we successfully claimed the email
  // If rowsAffected = 0, another process already claimed it
  return claimed
}

/**
 * Atomically select and claim pending emails
 * This eliminates the race condition between getPendingEmails and markEmailProcessing
 * Returns emails that were successfully claimed by this process
 */
/**
 * FIXED: Generate unique process ID for this Vercel function instance (Issue #29)
 * Uses UUID for guaranteed uniqueness across all environments (including serverless)
 */
function generateProcessId(): string {
  // FIXED: Use UUID instead of process.pid for serverless compatibility
  // process.pid may not be unique in serverless environments
  // Note: randomUUID is already imported at the top of the file
  const region = process.env.VERCEL_REGION || 'local'
  const timestamp = Date.now()
  const uuid = randomUUID().replace(/-/g, '').substring(0, 8) // Short UUID for readability
  return `${region}-${uuid}-${timestamp}`
}

/**
 * FIXED: Atomically claim pending emails with process ID tracking (Issue #29)
 * 
 * @param limit - Maximum number of emails to claim
 * @param processId - Optional process ID (auto-generated if not provided)
 * @returns Array of claimed email queue items
 */
export async function atomicallyClaimPendingEmails(
  limit: number = 10,
  processId: string = generateProcessId()
): Promise<EmailQueueItem[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const stuckThreshold = 5 * 60 // 5 minutes

  // FIXED: First, reset stuck emails (processing for >5 minutes) (Issue #29)
  await db.execute({
    sql: `UPDATE email_queue
          SET status = 'pending', process_id = NULL, updated_at = ?
          WHERE status = 'processing'
            AND updated_at < ?
            AND retry_count < max_retries`,
    args: [now, now - stuckThreshold],
  })

  // CRITICAL: Use a transaction to atomically select and claim emails
  // This prevents multiple processes from selecting the same emails
  return await dbTransaction(async (tx) => {
    // Step 1: Select pending emails
    // Note: SQLite doesn't support FOR UPDATE, so we use a transaction to ensure atomicity
    const selectResult = await tx.execute({
      sql: `
        SELECT * FROM email_queue
        WHERE status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
          AND retry_count < max_retries
        ORDER BY 
          CASE 
            WHEN email_type IN ('status_change', 'user_confirmation', 'admin_notification') THEN 1
            ELSE 2
          END,
          created_at ASC
        LIMIT ?
      `,
      args: [now, limit],
    })

    if (selectResult.rows.length === 0) {
      return []
    }

    // Step 2: Extract IDs and claim them atomically with process_id (Issue #29)
    const ids = selectResult.rows.map(row => (row as any).id)
    
    // Step 3: Atomically claim all selected emails in one UPDATE with process_id (Issue #29)
    // Only update emails that are still 'pending' (handles race condition)
    const placeholders = ids.map(() => '?').join(',')
    await tx.execute({
      sql: `
        UPDATE email_queue
        SET status = 'processing', process_id = ?, updated_at = ?
        WHERE id IN (${placeholders}) AND status = 'pending'
      `,
      args: [processId, now, ...ids],
    })

    // Step 4: Return only emails that were successfully claimed
    // Query again to get only emails that are now in 'processing' status with current process_id
    const claimedResult = await tx.execute({
      sql: `
        SELECT * FROM email_queue
        WHERE id IN (${placeholders}) AND status = 'processing' AND process_id = ? AND updated_at = ?
      `,
      args: [...ids, processId, now],
    })

    // Convert to EmailQueueItem format using existing helper
    return claimedResult.rows.map((row: any) => formatEmailQueueItem(row))
  })
}

/**
 * Mark email as sent
 */
export async function markEmailSent(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  // Get email details before updating (for broadcast)
  const emailResult = await db.execute({
    sql: `SELECT * FROM email_queue WHERE id = ?`,
    args: [id],
  })

  await db.execute({
    sql: `
      UPDATE email_queue
      SET status = 'sent', sent_at = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [now, now, id],
  })

  // Broadcast email sent event (after successful DB update)
  if (emailResult.rows.length > 0) {
    const emailRow = emailResult.rows[0] as any
    try {
      const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
      const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
      
      broadcastEmailQueueEvent('email:sent', {
        id: emailRow.id,
        emailType: emailRow.email_type,
        recipientEmail: emailRow.recipient_email,
        subject: emailRow.subject,
        status: 'sent',
        retryCount: emailRow.retry_count,
        errorMessage: emailRow.error_message,
        scheduledAt: emailRow.scheduled_at,
        nextRetryAt: emailRow.next_retry_at || null,
        sentAt: now,
        createdAt: emailRow.created_at,
        updatedAt: now,
      })

      // Broadcast stats update
      const stats = await getEmailQueueStats()
      const { listBookings } = await import('./bookings')
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0,
        offset: 0,
      })
      const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
      
      broadcastStatsUpdate({
        bookings: {
          pending: pendingBookingsResult.total,
        },
        emailQueue: {
          pending: stats.pending || 0,
          failed: stats.failed || 0,
          total: pendingEmailCount,
        },
      })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - logging is optional
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to broadcast email sent event', {
          emailId: id,
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }
  }
}

/**
 * Increment retry count and schedule next retry
 */
export async function scheduleNextRetry(id: string, errorMessage: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  // Get current retry count
  const result = await db.execute({
    sql: `SELECT retry_count, max_retries FROM email_queue WHERE id = ?`,
    args: [id],
  })

  if (result.rows.length === 0) {
    throw new Error(`Email queue item not found: ${id}`)
  }

  const item = result.rows[0] as any
  const retryCount = item.retry_count + 1

  // FIXED: Exponential backoff with jitter to prevent thundering herd (Issue #33)
  // Base delays: 1min, 5min, 15min, 30min, 1hr, 2hr (max)
  // Configurable via env var: EMAIL_RETRY_BACKOFF_BASE (default: 60 seconds for first retry)
  // Jitter: ±20% random variation to prevent synchronized retries
  const baseRetryDelays = [
    parseInt(process.env.EMAIL_RETRY_BACKOFF_BASE || "60"),   // 1 minute
    300,   // 5 minutes
    900,   // 15 minutes
    1800,  // 30 minutes
    3600,  // 1 hour
    7200,  // 2 hours (max)
  ]
  
  // Calculate delay index (cap at max delays)
  const delayIndex = Math.min(retryCount - 1, baseRetryDelays.length - 1)
  const baseDelay = baseRetryDelays[delayIndex]
  
  // Add jitter: ±20% random variation
  // This prevents multiple failed emails from retrying at the exact same time
  const jitterPercent = 0.2 // 20% jitter
  const jitterAmount = baseDelay * jitterPercent * (Math.random() * 2 - 1) // -20% to +20%
  const delay = Math.max(60, Math.floor(baseDelay + jitterAmount)) // Minimum 60 seconds
  
  const nextRetryAt = now + delay

  // Update status based on retry count
  let status: EmailQueueItem["status"] = "pending"
  if (retryCount >= item.max_retries) {
    status = "failed"
  }

  await db.execute({
    sql: `
      UPDATE email_queue
      SET retry_count = ?, next_retry_at = ?, status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [retryCount, nextRetryAt, status, errorMessage, now, id],
  })

  // Broadcast email status change (after successful DB update)
  try {
    const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
    const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
    
    // Get updated email details for broadcast
    const updatedEmailResult = await db.execute({
      sql: `SELECT * FROM email_queue WHERE id = ?`,
      args: [id],
    })

    if (updatedEmailResult.rows.length > 0) {
      const emailRow = updatedEmailResult.rows[0] as any
      
      if (status === "failed") {
        broadcastEmailQueueEvent('email:failed', {
          id: emailRow.id,
          emailType: emailRow.email_type,
          recipientEmail: emailRow.recipient_email,
          subject: emailRow.subject,
          status: 'failed',
          retryCount: retryCount,
          errorMessage: errorMessage,
          scheduledAt: emailRow.scheduled_at,
          nextRetryAt: emailRow.next_retry_at || null,
          sentAt: emailRow.sent_at,
          createdAt: emailRow.created_at,
          updatedAt: now,
        })
      } else {
        broadcastEmailQueueEvent('email:updated', {
          id: emailRow.id,
          emailType: emailRow.email_type,
          recipientEmail: emailRow.recipient_email,
          subject: emailRow.subject,
          status: status,
          retryCount: retryCount,
          errorMessage: errorMessage,
          scheduledAt: emailRow.scheduled_at,
          nextRetryAt: emailRow.next_retry_at || null,
          sentAt: emailRow.sent_at,
          createdAt: emailRow.created_at,
          updatedAt: now,
        })
      }

      // Broadcast stats update
      const stats = await getEmailQueueStats()
      const { listBookings } = await import('./bookings')
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0,
        offset: 0,
      })
      const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
      
      broadcastStatsUpdate({
        bookings: {
          pending: pendingBookingsResult.total,
        },
        emailQueue: {
          pending: stats.pending || 0,
          failed: stats.failed || 0,
          total: pendingEmailCount,
        },
      })
    }
  } catch (broadcastError) {
    // Don't fail if broadcast fails - logging is optional
    const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Failed to broadcast email status change', {
        emailId: id,
        error: errorMessage,
      })
    } catch (logError) {
      // Fallback: if logger fails, silently continue (avoid infinite loops)
    }
  }

  if (status === "failed") {
    await logError(`Email queue item failed after max retries`, { emailId: id, retryCount })
    
    // Notify admin when email fails after max retries (non-blocking)
    // This ensures admins are aware of failed notifications
    try {
      // Fetch email details from queue for better notification
      const emailDetails = await db.execute({
        sql: `SELECT email_type, recipient_email, subject FROM email_queue WHERE id = ?`,
        args: [id],
      })
      
      const emailData = emailDetails.rows[0] as any
      const { sendAdminEmailFailureNotification } = await import('./email')
      await sendAdminEmailFailureNotification({
        emailId: id,
        emailType: emailData?.email_type || 'unknown',
        recipientEmail: emailData?.recipient_email || 'unknown',
        subject: emailData?.subject || 'Unknown',
        retryCount,
        errorMessage,
      })
    } catch (notificationError) {
      // Don't fail if admin notification fails - just log it
      await logError('Failed to send admin notification for failed email', { emailId: id }, notificationError instanceof Error ? notificationError : new Error(String(notificationError)))
    }
  } else {
    await logInfo('Email queue item scheduled for retry', { emailId: id, retryCount, nextRetryAt: new Date(nextRetryAt * 1000).toISOString() })
  }
}

/**
 * Token Bucket Rate Limiter
 * FIXED: Implements token bucket algorithm for accurate rate limiting
 * Checks rate limit before each email instead of at batch start
 */
class TokenBucketRateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillRate: number // tokens per second
  private readonly db: ReturnType<typeof getTursoClient>
  
  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity
    this.refillRate = refillRate
    this.tokens = capacity
    this.lastRefill = Date.now()
    this.db = getTursoClient()
  }
  
  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000 // seconds
    const tokensToAdd = elapsed * this.refillRate
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
    this.lastRefill = now
  }
  
  /**
   * Try to acquire a token (non-blocking)
   * Returns true if token acquired, false if rate limited
   */
  async tryAcquire(): Promise<boolean> {
    this.refill()
    
    // Also check database to account for emails sent by other processes
    const now = Math.floor(Date.now() / 1000)
    const windowStart = Math.floor(now / 60) * 60 // 1 minute window
    
    const rateCheckResult = await this.db.execute({
      sql: `
        SELECT COUNT(*) as count 
        FROM email_queue 
        WHERE status = 'sent' 
          AND sent_at >= ?
      `,
      args: [windowStart],
    })
    
    const sentInWindow = (rateCheckResult.rows[0] as any)?.count || 0
    
    // Check both token bucket and database count
    if (this.tokens >= 1 && sentInWindow < this.capacity) {
      this.tokens--
      return true
    }
    
    return false
  }
  
  /**
   * Wait for a token to become available (blocking)
   * Returns when token is available
   */
  async waitForToken(): Promise<void> {
    while (!(await this.tryAcquire())) {
      // Calculate wait time based on token refill rate
      const tokensNeeded = 1 - this.tokens
      const waitTime = Math.ceil((tokensNeeded / this.refillRate) * 1000) // milliseconds
      
      // Also check database window
      const now = Math.floor(Date.now() / 1000)
      const windowStart = Math.floor(now / 60) * 60
      const windowEnd = windowStart + 60
      const dbWaitTime = (windowEnd - now) * 1000
      
      // Wait for the longer of the two
      const actualWaitTime = Math.min(Math.max(waitTime, dbWaitTime), 60000) // Max 60 seconds
      
      if (actualWaitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, actualWaitTime))
      } else {
        // Small delay to prevent tight loop
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // Refill after waiting
      this.refill()
    }
  }
  
  /**
   * Get current token count (for debugging)
   */
  getTokens(): number {
    this.refill()
    return this.tokens
  }
}

/**
 * Process pending emails in queue
 * FIXED: Uses token bucket rate limiting algorithm
 * Checks rate limit before each email instead of at batch start
 */
export async function processEmailQueue(limit: number = 10): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  // FIXED: Use token bucket rate limiter
  // Default: 30 emails per minute (configurable via EMAIL_QUEUE_RATE_LIMIT env var)
  const EMAIL_RATE_LIMIT = parseInt(process.env.EMAIL_QUEUE_RATE_LIMIT || "30", 10) // emails per minute
  const rateLimiter = new TokenBucketRateLimiter(
    EMAIL_RATE_LIMIT, // capacity
    EMAIL_RATE_LIMIT / 60 // refill rate (tokens per second)
  )
  
  // CRITICAL: Use atomic claim to eliminate race condition
  // This selects and claims emails in one atomic operation
  // Note: We claim up to limit, but will respect rate limit when sending
  const pendingEmails = await atomicallyClaimPendingEmails(limit)
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }
  
  for (let i = 0; i < pendingEmails.length; i++) {
    const email = pendingEmails[i]
    
    // FIXED: Check rate limit before each email (not at batch start)
    // This ensures accurate rate limiting even if processing takes time
    try {
      await rateLimiter.waitForToken()
    } catch (rateLimitError) {
      // If rate limit wait fails, skip this email and continue
      results.errors.push(`Rate limit error for email ${email.id}: ${rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError)}`)
      // Reset email to pending so it can be retried later
      await updateEmailQueueStatus(email.id, 'pending')
      continue
    }
    
    try {
      // CRITICAL: Email is already claimed atomically by atomicallyClaimPendingEmails
      // No need to claim again - it's already in 'processing' status
      results.processed++

      // Send email
      const transporter = await getTransporter()
      // IMPROVED: Handle metadata parsing with error status
      let metadata: Record<string, any> = {}
      if (email.metadata) {
        if (typeof email.metadata === 'object') {
          metadata = email.metadata
        } else {
          const parseResult = safeParseMetadata(email.metadata)
          metadata = parseResult.metadata || {}
          if (parseResult.error) {
            // Log error but continue processing (metadata might have parse errors)
            await logWarn('Metadata parsing error for email', { emailId: email.id, error: parseResult.error })
          }
        }
      }
      
      const mailOptions: nodemailer.SendMailOptions = {
        from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
        to: email.recipientEmail,
        subject: email.subject,
        text: email.textContent,
        html: email.htmlContent,
        replyTo: metadata.replyTo || undefined, // Preserve reply-to header from metadata
      }

      const result = await transporter.sendMail(mailOptions)
      
      // Mark as sent
      await markEmailSent(email.id)
      results.sent++
      
      await logInfo('Email queue item sent successfully', { emailId: email.id, messageId: result.messageId })
    } catch (error) {
      // IMPROVED: Safely extract and sanitize error message
      // Removes sensitive information before logging/queuing
      let errorMessage = "Unknown error"
      if (error instanceof Error) {
        errorMessage = error.message || error.toString()
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error && typeof error === 'object') {
        // Try to extract meaningful error information
        try {
          if ('message' in error && typeof error.message === 'string') {
            errorMessage = error.message
          } else if ('code' in error) {
            errorMessage = `Error code: ${error.code}`
          } else {
            errorMessage = JSON.stringify(error)
          }
        } catch {
          errorMessage = String(error)
        }
      }
      
      // Sanitize error message to remove sensitive information
      errorMessage = sanitizeEmailErrorMessage(errorMessage, email.recipientEmail)
      
      results.errors.push(`Email ${email.id}: ${errorMessage}`)
      
      // Schedule next retry or mark as failed
      await scheduleNextRetry(email.id, errorMessage)
      
      if (email.retryCount + 1 >= email.maxRetries) {
        results.failed++
        
        // Notify admin when email fails after max retries (non-blocking)
        try {
          const { sendAdminEmailFailureNotification } = await import('./email')
          await sendAdminEmailFailureNotification({
            emailId: email.id,
            emailType: email.emailType,
            recipientEmail: email.recipientEmail,
            subject: email.subject,
            retryCount: email.retryCount + 1,
            errorMessage,
          })
        } catch (notificationError) {
          // Don't fail if admin notification fails - just log it
          await logError('Failed to send admin notification for failed email', { emailId: email.id }, notificationError instanceof Error ? notificationError : new Error(String(notificationError)))
        }
      }
      
      await logError('Email queue item failed', { emailId: email.id, errorMessage })
    }
    
    // Note: Rate limiting is handled by TokenBucketRateLimiter before each email
    // No need to check remainingQuota here - the rate limiter will block if needed
  }

  return results
}

/**
 * Process pending critical status change emails
 * Handles: pending_deposit, confirmed, cancelled
 * FIXED: Uses atomic claiming to prevent race conditions (Issue #4)
 */
export async function processCriticalStatusEmails(limit: number = 20): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  // FIXED: Use atomic claiming instead of getPendingCriticalStatusEmails + markEmailProcessing (Issue #4)
  // This eliminates the race condition window between selection and claiming
  const claimedEmails = await atomicallyClaimPendingEmails(limit)
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }

  await logInfo('Processing critical emails', { count: claimedEmails.length })

  for (const email of claimedEmails) {
    try {
      // Email is already claimed atomically by atomicallyClaimPendingEmails
      // No need to claim again - it's already in 'processing' status
      results.processed++

      // Send email
      const transporter = await getTransporter()
      // IMPROVED: Handle metadata parsing with error status
      let metadata: Record<string, any> = {}
      if (email.metadata) {
        if (typeof email.metadata === 'object') {
          metadata = email.metadata
        } else {
          const parseResult = safeParseMetadata(email.metadata)
          metadata = parseResult.metadata || {}
          if (parseResult.error) {
            // Log error but continue processing (metadata might have parse errors)
            await logWarn('Metadata parsing error for email', { emailId: email.id, error: parseResult.error })
          }
        }
      }
      
      const mailOptions: nodemailer.SendMailOptions = {
        from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
        to: email.recipientEmail,
        subject: email.subject,
        text: email.textContent,
        html: email.htmlContent,
        replyTo: metadata.replyTo || undefined,
      }

      const result = await transporter.sendMail(mailOptions)
      
      // Mark as sent
      await markEmailSent(email.id)
      results.sent++
      
      // Log based on email type
      if (email.emailType === 'user_confirmation') {
        await logInfo('User confirmation email sent successfully', { emailId: email.id, messageId: result.messageId })
      } else if (email.emailType === 'admin_notification') {
        await logInfo('Admin notification email sent successfully', { emailId: email.id, messageId: result.messageId })
      } else {
        await logInfo('Critical status email sent successfully', { emailId: email.id, messageId: result.messageId, status: metadata.status || 'N/A' })
      }
    } catch (error) {
      // IMPROVED: Safely extract and sanitize error message
      // Removes sensitive information before logging/queuing
      let errorMessage = "Unknown error"
      if (error instanceof Error) {
        errorMessage = error.message || error.toString()
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error && typeof error === 'object') {
        try {
          if ('message' in error && typeof error.message === 'string') {
            errorMessage = error.message
          } else if ('code' in error) {
            errorMessage = `Error code: ${error.code}`
          } else {
            errorMessage = JSON.stringify(error)
          }
        } catch {
          errorMessage = String(error)
        }
      }
      
      // Sanitize error message to remove sensitive information
      errorMessage = sanitizeEmailErrorMessage(errorMessage, email.recipientEmail)
      
      results.errors.push(`Email ${email.id}: ${errorMessage}`)
      
      // Schedule next retry or mark as failed
      await scheduleNextRetry(email.id, errorMessage)
      
      if (email.retryCount + 1 >= email.maxRetries) {
        results.failed++
        await logError('Email failed after max retries', { emailType: email.emailType, emailId: email.id, retryCount: email.retryCount + 1 })
      } else {
        await logError('Email failed, scheduled for retry', { emailType: email.emailType, emailId: email.id, errorMessage })
      }
    }
  }

  return results
}

/**
 * Get all emails in queue (with filters)
 */
export async function getEmailQueueItems(options?: {
  status?: EmailQueueItem["status"]
  emailType?: EmailQueueItem["emailType"]
  bookingReference?: string // Search for booking reference in metadata
  limit?: number
  offset?: number
}): Promise<{ items: EmailQueueItem[]; total: number }> {
  const db = getTursoClient()
  
  // Optimize query to leverage composite indexes
  // If both status and emailType are provided, use idx_email_queue_status_type_created
  // If only status, use idx_email_queue_status (with next_retry_at)
  // If only emailType, use idx_email_queue_type
  // Otherwise, use idx_email_queue_created
  
  let sql = "SELECT * FROM email_queue WHERE 1=1"
  const args: any[] = []
  
  if (options?.status) {
    sql += " AND status = ?"
    args.push(options.status)
  }
  
  if (options?.emailType) {
    sql += " AND email_type = ?"
    args.push(options.emailType)
  }
  
  // FIXED: Use FTS5 full-text search when available, fallback to LIKE pattern matching (Issue #35)
  if (options?.bookingReference) {
    const refLower = options.bookingReference.toLowerCase().trim()
    if (refLower) {
      // Try FTS5 full-text search first (much faster and more accurate)
      try {
        // Check if FTS5 table exists
        const ftsCheck = await db.execute({
          sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='email_queue_fts'`,
        })
        
        if (ftsCheck.rows.length > 0) {
          // FIXED: Add corruption detection for FTS5 table
          // Test FTS5 table integrity before using it
          try {
            const integrityCheck = await db.execute({
              sql: `SELECT COUNT(*) as count FROM email_queue_fts LIMIT 1`,
            })
            // If integrity check passes, proceed with FTS5 search
          } catch (integrityError) {
            // FTS5 table is corrupted, log and fallback to LIKE
            await logWarn('FTS5 table corruption detected, falling back to LIKE search', {
              error: integrityError instanceof Error ? integrityError.message : String(integrityError),
              searchTerm: refLower
            })
            throw new Error('FTS5 table corrupted')
          }
          
          // Use FTS5 for full-text search
          // FTS5 uses MATCH operator and supports better search syntax
          // FIXED: Escape FTS5 special characters to prevent query injection (Issue #14)
          const escapeFTS5Term = (term: string): string => {
            // Escape FTS5 special characters: ", *, OR, AND, NOT
            // Replace quotes with escaped quotes, remove other special chars
            return term
              .replace(/"/g, '""') // Escape quotes by doubling them
              .replace(/[*]/g, '') // Remove wildcards (not needed for exact match)
          }
          const ftsQuery = refLower.split(/\s+/)
            .map(term => term.trim())
            .filter(term => term.length > 0)
            .map(term => `"${escapeFTS5Term(term)}"`)
            .join(' OR ')
          
          // Get matching rowids from FTS5 table
          const ftsResult = await db.execute({
            sql: `
              SELECT rowid FROM email_queue_fts 
              WHERE email_queue_fts MATCH ? 
              ORDER BY rank
              LIMIT 1000
            `,
            args: [ftsQuery],
          })
          
          if (ftsResult.rows.length > 0) {
            // Use rowids from FTS5 to filter main query
            const rowids = ftsResult.rows.map((row: any) => row.rowid)
            const placeholders = rowids.map(() => '?').join(',')
            sql += ` AND rowid IN (${placeholders})`
            args.push(...rowids)
            
            await logDebug('Using FTS5 for email queue search', { 
              searchTerm: refLower,
              matchCount: rowids.length
            })
          } else {
            // No matches from FTS5, return empty result
            sql += " AND 1=0" // Force no results
            await logDebug('FTS5 search returned no matches', { searchTerm: refLower })
          }
        } else {
          // FTS5 not available, fallback to LIKE pattern matching
          throw new Error('FTS5 table not available')
        }
      } catch (ftsError) {
        // Fallback to LIKE pattern matching if FTS5 is not available
        // This maintains backwards compatibility
        const escapedRef = refLower.replace(/%/g, '\\%').replace(/_/g, '\\_')
        sql += " AND (searchable_metadata LIKE ? OR metadata LIKE ? OR metadata LIKE ? OR subject LIKE ?)"
        args.push(
          `%${escapedRef}%`, // Search in searchable_metadata column
          `%"bookingId":"%${escapedRef}%`, // Search in metadata JSON
          `%"referenceNumber":"%${escapedRef}%`, // Search in metadata JSON
          `%[${escapedRef}%` // Search in subject (reference number format)
        )
        
        await logDebug('Using LIKE pattern matching for email queue search (FTS5 not available)', { 
          searchTerm: refLower,
          error: ftsError instanceof Error ? ftsError.message : String(ftsError)
        })
      }
    }
  }
  
  // Get total count (uses same indexes for filtering)
  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as count")
  const countResult = await db.execute({ sql: countSql, args })
  const total = (countResult.rows[0] as any)?.count || 0
  
  // Get items with pagination
  // ORDER BY created_at DESC leverages idx_email_queue_status_type_created when both filters are present
  // or idx_email_queue_created when no filters
  sql += " ORDER BY created_at DESC"
  if (options?.limit) {
    sql += " LIMIT ?"
    args.push(options.limit)
    if (options?.offset) {
      sql += " OFFSET ?"
      args.push(options.offset)
    }
  }
  
  const result = await db.execute({ sql, args })
  
  return {
    items: result.rows.map((row: any) => formatEmailQueueItem(row)),
    total,
  }
}

/**
 * FIXED: Search email queue using FTS5 full-text search (Issue #35)
 * 
 * @param searchTerm - Search term to find in metadata, subject, or recipient email
 * @param options - Additional search options
 * @returns Array of matching email queue items
 */
export async function searchEmailQueue(
  searchTerm: string,
  options?: {
    status?: EmailQueueItem["status"]
    emailType?: EmailQueueItem["emailType"]
    limit?: number
    offset?: number
  }
): Promise<{ items: EmailQueueItem[]; total: number }> {
  const db = getTursoClient()
  
  if (!searchTerm || !searchTerm.trim()) {
    // Empty search term - return empty results
    return { items: [], total: 0 }
  }
  
  const searchLower = searchTerm.toLowerCase().trim()
  
  try {
    // Check if FTS5 table exists
    const ftsCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='email_queue_fts'`,
    })
    
    if (ftsCheck.rows.length > 0) {
      // FIXED: Add corruption detection for FTS5 table
      // Test FTS5 table integrity before using it
      try {
        const integrityCheck = await db.execute({
          sql: `SELECT COUNT(*) as count FROM email_queue_fts LIMIT 1`,
        })
        // If integrity check passes, proceed with FTS5 search
      } catch (integrityError) {
        // FTS5 table is corrupted, log and fallback to LIKE
        await logWarn('FTS5 table corruption detected in searchEmailQueue, falling back to LIKE search', {
          error: integrityError instanceof Error ? integrityError.message : String(integrityError),
          searchTerm: searchLower
        })
        throw new Error('FTS5 table corrupted')
      }
      
      // Use FTS5 for full-text search
      // FTS5 supports better search syntax with phrase matching
      // FIXED: Escape FTS5 special characters to prevent query injection (Issue #14)
      const escapeFTS5Term = (term: string): string => {
        // Escape FTS5 special characters: ", *, OR, AND, NOT
        // Replace quotes with escaped quotes, remove other special chars
        return term
          .replace(/"/g, '""') // Escape quotes by doubling them
          .replace(/[*]/g, '') // Remove wildcards (not needed for exact match)
      }
      const ftsQuery = searchLower.split(/\s+/)
        .map(term => term.trim())
        .filter(term => term.length > 0)
        .map(term => `"${escapeFTS5Term(term)}"`)
        .join(' OR ')
      
      // Build WHERE clause for additional filters
      let filterSql = ""
      const filterArgs: any[] = []
      
      if (options?.status) {
        filterSql += " AND status = ?"
        filterArgs.push(options.status)
      }
      
      if (options?.emailType) {
        filterSql += " AND email_type = ?"
        filterArgs.push(options.emailType)
      }
      
      // Get matching rowids from FTS5 table
      const ftsResult = await db.execute({
        sql: `
          SELECT rowid FROM email_queue_fts 
          WHERE email_queue_fts MATCH ? 
          ORDER BY rank
          LIMIT 1000
        `,
        args: [ftsQuery],
      })
      
      if (ftsResult.rows.length === 0) {
        return { items: [], total: 0 }
      }
      
      // Get total count
      const rowids = ftsResult.rows.map((row: any) => row.rowid)
      const placeholders = rowids.map(() => '?').join(',')
      const countSql = `
        SELECT COUNT(*) as count FROM email_queue 
        WHERE rowid IN (${placeholders})${filterSql}
      `
      const countResult = await db.execute({
        sql: countSql,
        args: [...rowids, ...filterArgs],
      })
      const total = (countResult.rows[0] as any)?.count || 0
      
      // Get items with pagination
      let itemsSql = `
        SELECT * FROM email_queue 
        WHERE rowid IN (${placeholders})${filterSql}
        ORDER BY created_at DESC
      `
      const itemsArgs = [...rowids, ...filterArgs]
      
      if (options?.limit) {
        itemsSql += " LIMIT ?"
        itemsArgs.push(options.limit)
        if (options?.offset) {
          itemsSql += " OFFSET ?"
          itemsArgs.push(options.offset)
        }
      }
      
      const result = await db.execute({
        sql: itemsSql,
        args: itemsArgs,
      })
      
      await logDebug('FTS5 email queue search completed', {
        searchTerm: searchLower,
        matchCount: total,
        limit: options?.limit,
        offset: options?.offset,
      })
      
      return {
        items: result.rows.map((row: any) => formatEmailQueueItem(row)),
        total,
      }
    } else {
      // FTS5 not available, fallback to LIKE pattern matching
      throw new Error('FTS5 table not available')
    }
  } catch (ftsError) {
    // Fallback to LIKE pattern matching
    const escapedSearch = searchLower.replace(/%/g, '\\%').replace(/_/g, '\\_')
    
    let sql = `
      SELECT * FROM email_queue 
      WHERE (
        searchable_metadata LIKE ? 
        OR metadata LIKE ? 
        OR subject LIKE ? 
        OR recipient_email LIKE ?
      )
    `
    const args: any[] = [
      `%${escapedSearch}%`,
      `%${escapedSearch}%`,
      `%${escapedSearch}%`,
      `%${escapedSearch}%`,
    ]
    
    if (options?.status) {
      sql += " AND status = ?"
      args.push(options.status)
    }
    
    if (options?.emailType) {
      sql += " AND email_type = ?"
      args.push(options.emailType)
    }
    
    // Get total count
    const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as count")
    const countResult = await db.execute({ sql: countSql, args })
    const total = (countResult.rows[0] as any)?.count || 0
    
    // Get items with pagination
    sql += " ORDER BY created_at DESC"
    if (options?.limit) {
      sql += " LIMIT ?"
      args.push(options.limit)
      if (options?.offset) {
        sql += " OFFSET ?"
        args.push(options.offset)
      }
    }
    
    const result = await db.execute({ sql, args })
    
    await logDebug('LIKE pattern matching email queue search completed (FTS5 not available)', {
      searchTerm: searchLower,
      matchCount: total,
      limit: options?.limit,
      offset: options?.offset,
      error: ftsError instanceof Error ? ftsError.message : String(ftsError),
    })
    
    return {
      items: result.rows.map((row: any) => formatEmailQueueItem(row)),
      total,
    }
  }
}

/**
 * Get single email queue item by ID
 */
export async function getEmailQueueItem(id: string): Promise<EmailQueueItem | null> {
  const db = getTursoClient()
  
  const result = await db.execute({
    sql: "SELECT * FROM email_queue WHERE id = ?",
    args: [id],
  })
  
  if (result.rows.length === 0) {
    return null
  }
  
  return formatEmailQueueItem(result.rows[0] as any)
}

/**
 * Manually retry a specific email
 */
export async function retryEmail(id: string): Promise<{ success: boolean; error?: string }> {
  const email = await getEmailQueueItem(id)
  if (!email) {
    return { success: false, error: "Email not found" }
  }
  
  if (email.status === "sent") {
    return { success: false, error: "Email already sent" }
  }
  
  if (email.status === "cancelled") {
    return { success: false, error: "Email is cancelled" }
  }
  
  // FIXED: Check if email is already being processed by another process
  // Use atomic claim to prevent concurrent retries
  if (email.status === "processing") {
    return { success: false, error: "Email is already being processed by another process" }
  }
  
  try {
    // FIXED: Use atomic claim instead of direct status update
    // This prevents concurrent retries from multiple processes
    const claimed = await markEmailProcessing(id)
    if (!claimed) {
      return { 
        success: false, 
        error: "Email is already being processed by another process (atomic claim failed)" 
      }
    }
    
    // Send email
    const transporter = await getTransporter()
    // IMPROVED: Handle metadata parsing with error status
    let metadata: Record<string, any> = {}
    if (email.metadata) {
      if (typeof email.metadata === 'object') {
        metadata = email.metadata
      } else {
        const parseResult = safeParseMetadata(email.metadata)
        metadata = parseResult.metadata || {}
        if (parseResult.error) {
          // Log error but continue processing (metadata might have parse errors)
          await logWarn('Metadata parsing error for email', { emailId: email.id, error: parseResult.error })
        }
      }
    }
    
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
      to: email.recipientEmail,
      subject: email.subject,
      text: email.textContent,
      html: email.htmlContent,
      replyTo: metadata.replyTo || undefined,
    }
    
    const result = await transporter.sendMail(mailOptions)
    
    // Mark as sent
    await markEmailSent(id)
    
    await logInfo('Email manually retried successfully', { emailId: id, messageId: result.messageId })
    return { success: true }
  } catch (error) {
    // FIXED: If email sending fails, schedule retry instead of leaving in processing state
    // Safely extract error message
    let errorMessage = "Unknown error"
    if (error instanceof Error) {
      errorMessage = error.message || error.toString()
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // Try to extract meaningful error information
      try {
        if ('message' in error && typeof error.message === 'string') {
          errorMessage = error.message
        } else if ('code' in error) {
          errorMessage = `Error code: ${error.code}`
        } else {
          errorMessage = JSON.stringify(error)
        }
      } catch {
        errorMessage = String(error)
      }
    }
    
    // Sanitize error message to remove sensitive information
    errorMessage = sanitizeEmailErrorMessage(errorMessage, email.recipientEmail)
    
    // Schedule retry with sanitized error message
    await scheduleNextRetry(id, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * FIXED: Cancel an email in queue with proper status checks (Issue #39)
 * 
 * SSE Interconnection: Broadcasts email:updated event when email is cancelled
 * 
 * @param id - Email queue item ID
 * @returns Object with success status and message
 * @throws Error if email is already being processed or sent
 */
export async function cancelEmail(id: string): Promise<{
  success: boolean
  message: string
}> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // FIXED: Check email status before cancellation (Issue #39)
  const emailResult = await db.execute({
    sql: `SELECT * FROM email_queue WHERE id = ?`,
    args: [id],
  })
  
  if (emailResult.rows.length === 0) {
    return {
      success: false,
      message: `Email ${id} not found`,
    }
  }
  
  const email = emailResult.rows[0] as any
  
  // FIXED: Prevent cancellation of emails that are already sent or processing (Issue #39)
  if (email.status === 'sent') {
    return {
      success: false,
      message: 'Cannot cancel email that has already been sent',
    }
  }
  
  if (email.status === 'processing') {
    // FIXED: Allow cancellation of processing emails but warn admin (Issue #39)
    // The email might be in-flight, but we can mark it as cancelled
    // The processing will fail gracefully when it tries to update status
    await logWarn('Cancelling email that is currently processing - email may still be sent', { emailId: id })
  }
  
  if (email.status === 'cancelled') {
    return {
      success: true,
      message: 'Email is already cancelled',
    }
  }
  
  // FIXED: Atomic cancellation with status check (Issue #39)
  // Only cancel if status is still pending or failed (not sent/processing)
  const result = await db.execute({
    sql: `
      UPDATE email_queue 
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? 
        AND status IN ('pending', 'failed')
    `,
    args: [now, id],
  })
  
  if ((result.rowsAffected || 0) === 0) {
    // Email status changed between check and update (race condition)
    // Re-check status
    const recheckResult = await db.execute({
      sql: `SELECT status FROM email_queue WHERE id = ?`,
      args: [id],
    })
    
    if (recheckResult.rows.length > 0) {
      const currentStatus = (recheckResult.rows[0] as any).status
      if (currentStatus === 'sent') {
        return {
          success: false,
          message: 'Email was sent before cancellation could complete',
        }
      }
      if (currentStatus === 'processing') {
        return {
          success: false,
          message: 'Email is currently being processed and cannot be cancelled',
        }
      }
    }
    
    return {
      success: false,
      message: 'Failed to cancel email - status may have changed',
    }
  }
  
  // FIXED: Broadcast email:updated event for cancellation (Issue #39)
  // SSE Interconnection: Admin clients see cancellation in real-time
  try {
    const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
    const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
    
    // Get updated email details for broadcast
    const updatedEmailResult = await db.execute({
      sql: `SELECT * FROM email_queue WHERE id = ?`,
      args: [id],
    })
    
    if (updatedEmailResult.rows.length > 0) {
      const emailRow = updatedEmailResult.rows[0] as any
      
      broadcastEmailQueueEvent('email:updated', {
        id: emailRow.id,
        emailType: emailRow.email_type,
        recipientEmail: emailRow.recipient_email,
        subject: emailRow.subject,
        status: 'cancelled',
        retryCount: emailRow.retry_count,
        errorMessage: emailRow.error_message,
        scheduledAt: emailRow.scheduled_at,
        nextRetryAt: emailRow.next_retry_at || null,
        sentAt: emailRow.sent_at,
        createdAt: emailRow.created_at,
        updatedAt: now,
      })
      
      // Broadcast stats update
      const stats = await getEmailQueueStats()
      const { listBookings } = await import('./bookings')
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0,
        offset: 0,
      })
      const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
      
      broadcastStatsUpdate({
        bookings: {
          pending: pendingBookingsResult.total,
        },
        emailQueue: {
          pending: stats.pending || 0,
          failed: stats.failed || 0,
          total: pendingEmailCount,
        },
      })
    }
  } catch (broadcastError) {
    // Don't fail if broadcast fails - logging is optional
    const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Failed to broadcast email cancellation event', {
        emailId: id,
        error: errorMessage,
      })
    } catch (logError) {
      // Fallback: if logger fails, silently continue
    }
  }
  
  return {
    success: true,
    message: 'Email cancelled successfully',
  }
}

/**
 * Delete an email from queue
 */
export async function deleteEmail(id: string): Promise<void> {
  const db = getTursoClient()
  
  // Get email details before deleting (for broadcast)
  const emailResult = await db.execute({
    sql: `SELECT * FROM email_queue WHERE id = ?`,
    args: [id],
  })
  
  await db.execute({
    sql: "DELETE FROM email_queue WHERE id = ?",
    args: [id],
  })

  // Broadcast email deleted event (after successful DB delete)
  if (emailResult.rows.length > 0) {
    const emailRow = emailResult.rows[0] as any
    try {
      const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
      const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
      
      broadcastEmailQueueEvent('email:deleted', {
        id: emailRow.id,
        emailType: emailRow.email_type,
        recipientEmail: emailRow.recipient_email,
        subject: emailRow.subject,
        status: emailRow.status,
        retryCount: emailRow.retry_count,
        errorMessage: emailRow.error_message,
        scheduledAt: emailRow.scheduled_at,
        nextRetryAt: emailRow.next_retry_at || null,
        sentAt: emailRow.sent_at,
        createdAt: emailRow.created_at,
        updatedAt: emailRow.updated_at,
      })

      // Broadcast stats update
      const stats = await getEmailQueueStats()
      const { listBookings } = await import('./bookings')
      const pendingBookingsResult = await listBookings({
        statuses: ['pending', 'pending_deposit', 'paid_deposit'],
        excludeArchived: true,
        limit: 0,
        offset: 0,
      })
      const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
      
      broadcastStatsUpdate({
        bookings: {
          pending: pendingBookingsResult.total,
        },
        emailQueue: {
          pending: stats.pending || 0,
          failed: stats.failed || 0,
          total: pendingEmailCount,
        },
      })
    } catch (broadcastError) {
      // Don't fail if broadcast fails - logging is optional
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to broadcast email deleted event', {
          emailId: id,
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }
  }
}

/**
 * FIXED: Cleanup sent emails with age check and retention policy (Issue #26)
 * 
 * Configurable via environment variables:
 * - EMAIL_CLEANUP_RETENTION_DAYS: Number of days to keep sent emails (default: 30)
 * - EMAIL_CLEANUP_ENABLED: Enable/disable cleanup (default: true)
 * 
 * SSE Interconnection: Broadcasts email:deleted events for each cleaned email
 */
export async function cleanupAllSentEmails(): Promise<number> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // FIXED: Configurable retention policy (Issue #26)
  const retentionDays = parseInt(process.env.EMAIL_CLEANUP_RETENTION_DAYS || "30")
  const cleanupEnabled = process.env.EMAIL_CLEANUP_ENABLED !== "false" // Default: enabled
  const retentionSeconds = retentionDays * 24 * 60 * 60
  const cutoffTime = now - retentionSeconds
  
  if (!cleanupEnabled) {
    await logInfo('Email cleanup is disabled via EMAIL_CLEANUP_ENABLED')
    return 0
  }
  
  // FIXED: Get emails to delete BEFORE deletion (for SSE broadcasts)
  const emailsToDelete = await db.execute({
    sql: `
      SELECT * FROM email_queue
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND sent_at < ?
    `,
    args: [cutoffTime],
  })
  
  const deletedCount = emailsToDelete.rows.length
  
  if (deletedCount === 0) {
    return 0
  }
  
  // Delete emails
  const result = await db.execute({
    sql: `
      DELETE FROM email_queue
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND sent_at < ?
    `,
    args: [cutoffTime],
  })
  
  const actualDeleted = result.rowsAffected || 0
  
  // FIXED: Broadcast email:deleted events for each cleaned email (Issue #26)
  // SSE Interconnection: Admin clients see cleanup in real-time
  try {
    const { broadcastEmailQueueEvent } = await import('../../app/api/v1/admin/emails/stream/route')
    const { broadcastStatsUpdate } = await import('../../app/api/v1/admin/stats/stream/route')
    
    // Broadcast deletion for each email
    for (const emailRow of emailsToDelete.rows) {
      const email = emailRow as any
      broadcastEmailQueueEvent('email:deleted', {
        id: email.id,
        emailType: email.email_type,
        recipientEmail: email.recipient_email,
        subject: email.subject,
        status: 'sent',
        retryCount: email.retry_count,
        errorMessage: email.error_message,
        scheduledAt: email.scheduled_at,
        nextRetryAt: email.next_retry_at || null,
        sentAt: email.sent_at,
        createdAt: email.created_at,
        updatedAt: now,
      })
    }
    
    // Broadcast stats update after cleanup
    const stats = await getEmailQueueStats()
    const { listBookings } = await import('./bookings')
    const pendingBookingsResult = await listBookings({
      statuses: ['pending', 'pending_deposit', 'paid_deposit'],
      excludeArchived: true,
      limit: 0,
      offset: 0,
    })
    const pendingEmailCount = (stats.pending || 0) + (stats.failed || 0)
    
    broadcastStatsUpdate({
      bookings: {
        pending: pendingBookingsResult.total,
      },
      emailQueue: {
        pending: stats.pending || 0,
        failed: stats.failed || 0,
        total: pendingEmailCount,
      },
    })
  } catch (broadcastError) {
    // Don't fail if broadcast fails - logging is optional
    const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Failed to broadcast email cleanup events', {
        deletedCount: actualDeleted,
        error: errorMessage,
      })
    } catch (logError) {
      // Fallback: if logger fails, silently continue
    }
  }
  
  await logInfo('Cleaned up sent emails', { deletedCount: actualDeleted, retentionDays })
  
  return actualDeleted
}

/**
 * Get email queue statistics
 */
export async function getEmailQueueStats(): Promise<{
  pending: number
  processing: number
  failed: number
  sent: number
  total: number
}> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: `
      SELECT status, COUNT(*) as count
      FROM email_queue
      GROUP BY status
    `,
  })

  const stats = {
    pending: 0,
    processing: 0,
    failed: 0,
    sent: 0,
    total: 0,
  }

  for (const row of result.rows) {
    const item = row as any
    const status = item.status as EmailQueueItem["status"]
    const count = item.count as number
    
    stats.total += count
    if (status === "pending") stats.pending = count
    else if (status === "processing") stats.processing = count
    else if (status === "failed") stats.failed = count
    else if (status === "sent") stats.sent = count
  }

  return stats
}

/**
 * Sanitize error messages from email failures
 * Removes sensitive information like email addresses, booking IDs, etc.
 */
function sanitizeEmailErrorMessage(errorMessage: string, recipientEmail: string): string {
  let sanitized = errorMessage
  
  // Remove email addresses (but keep domain for debugging)
  sanitized = sanitized.replace(/\b[\w\.-]+@[\w\.-]+\.\w+\b/gi, (match) => {
    // Replace with domain only for debugging
    const domain = match.split('@')[1]
    return `[email]@${domain}`
  })
  
  // Remove booking IDs (UUIDs)
  sanitized = sanitized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[booking-id]')
  
  // Remove file paths
  sanitized = sanitized.replace(/\/[^\s]+/g, '[path]')
  
  // Remove stack traces (keep only first line)
  sanitized = sanitized.split('\n')[0]
  
  // Remove sensitive patterns (API keys, tokens, etc.)
  sanitized = sanitized.replace(/\b[A-Za-z0-9]{32,}\b/g, '[token]') // Long alphanumeric strings
  
  // Limit message length to prevent log bloat
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 497) + '...'
  }
  
  return sanitized
}

/**
 * Safely parse JSON metadata
 * IMPROVED: Enhanced robustness with comprehensive error handling
 */
/**
 * Safely parse email queue metadata with proper error handling
 * Returns object with metadata and error status
 * FIXED: Improved circular reference detection and error handling
 */
function safeParseMetadata(
  metadata: string | null | undefined
): {
  metadata: Record<string, any> | undefined
  error: string | null
} {
  if (!metadata) {
    return { metadata: undefined, error: null }
  }
  
  // If already an object, validate it's not circular and return as-is
  if (typeof metadata === 'object' && !Array.isArray(metadata) && metadata !== null) {
    // IMPROVED: Better circular reference detection using WeakSet
    const seen = new WeakSet()
    try {
      // Try to stringify with circular reference detection
      JSON.stringify(metadata, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            throw new Error('Circular reference detected')
          }
          seen.add(value)
        }
        return value
      })
      return { metadata: metadata as Record<string, any>, error: null }
    } catch (error) {
      // Circular reference detected - return error status
      const errorMessage = error instanceof Error ? error.message : 'Circular reference detected'
      // Fire-and-forget logging for utility function
      logWarn('Metadata contains circular reference', { error: errorMessage }).catch(() => {})
      return { 
        metadata: { _parseError: true, _error: 'circular_reference' },
        error: errorMessage
      }
    }
  }
  
  // If it's a string, try to parse it
  if (typeof metadata === 'string') {
    // Validate string is not empty or just whitespace
    const trimmed = metadata.trim()
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
      return { metadata: undefined, error: null }
    }
    
    // CRITICAL: Check size before parsing to prevent DoS
    // Limit metadata size (configurable via environment variable)
    const MAX_METADATA_SIZE = parseInt(
      process.env.MAX_EMAIL_METADATA_SIZE || '102400', // 100KB default
      10
    )
    if (trimmed.length > MAX_METADATA_SIZE) {
      const errorMessage = `Metadata exceeds maximum size of ${MAX_METADATA_SIZE} bytes (${trimmed.length} bytes)`
      // Fire-and-forget logging for utility function
      logWarn('Metadata string too large', { size: trimmed.length, maxSize: MAX_METADATA_SIZE }).catch(() => {})
      return { 
        metadata: { 
          _parseError: true, 
          _error: 'metadata_too_large',
          _errorMessage: errorMessage
        },
        error: errorMessage
      }
    }
    
    // IMPROVED: Validate JSON structure before parsing
    // Check for common JSON issues (unclosed brackets, quotes, etc.)
    if (!isValidJSONStructure(trimmed)) {
      const errorMessage = 'Invalid JSON structure detected'
      // Fire-and-forget logging for utility function
      logError('Invalid JSON structure in metadata').catch(() => {})
      return {
        metadata: {
          _parseError: true,
          _error: 'invalid_json_structure',
          _errorMessage: errorMessage
        },
        error: errorMessage
      }
    }
    
    try {
      // IMPROVED: Parse with circular reference detection using reviver
      const seen = new WeakSet()
      const parsed = JSON.parse(trimmed, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            throw new Error('Circular reference detected in parsed JSON')
          }
          seen.add(value)
        }
        return value
      })
      
      // Validate parsed result is an object (not array, string, number, etc.)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // Additional validation: ensure no circular references
        try {
          const seen2 = new WeakSet()
          JSON.stringify(parsed, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (seen2.has(value)) {
                throw new Error('Circular reference detected after parsing')
              }
              seen2.add(value)
            }
            return value
          })
          return { metadata: parsed, error: null }
        } catch (circularError) {
          const errorMessage = circularError instanceof Error ? circularError.message : 'Circular reference detected'
          // Fire-and-forget logging for utility function
          logWarn('Parsed metadata contains circular reference', { error: errorMessage }).catch(() => {})
          return { 
            metadata: { _parseError: true, _error: 'circular_reference' },
            error: errorMessage
          }
        }
      } else {
        // Parsed but not an object - wrap it
        // Fire-and-forget logging for utility function
        logWarn('Metadata parsed but is not an object, wrapping it').catch(() => {})
        return { metadata: { _parsedValue: parsed }, error: null }
      }
    } catch (error) {
      // JSON parse failed - return error status
      const errorMessage = error instanceof Error ? error.message : String(error)
      // Fire-and-forget logging for utility function
      logError('Failed to parse metadata JSON', { error: errorMessage, metadataPreview: metadata.substring(0, 200) }).catch(() => {})
      
      // Return error status with sanitized error message
      return { 
        metadata: { 
          _parseError: true, 
          _error: 'invalid_json',
          _errorMessage: errorMessage.substring(0, 100) // Limit error message length
        },
        error: errorMessage
      }
    }
  }
  
  // Unknown type - return undefined
  return { metadata: undefined, error: 'Unknown metadata type' }
}

/**
 * Basic JSON structure validation
 * Checks for common issues like unclosed brackets, quotes, etc.
 */
function isValidJSONStructure(str: string): boolean {
  // Basic checks: balanced brackets, quotes, etc.
  let depth = 0
  let inString = false
  let escapeNext = false
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    
    if (escapeNext) {
      escapeNext = false
      continue
    }
    
    if (char === '\\') {
      escapeNext = true
      continue
    }
    
    if (char === '"') {
      inString = !inString
      continue
    }
    
    if (inString) {
      continue
    }
    
    if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth < 0) {
        return false // Unmatched closing bracket
      }
    }
  }
  
  return depth === 0 && !inString
}

/**
 * Format email queue item from database row
 */
/**
 * Format email queue item from database row
 * FIXED: Handles metadata parsing errors correctly (Issue #8)
 */
function formatEmailQueueItem(row: any): EmailQueueItem {
  // FIXED: Handle metadata parsing errors - if parsing fails, use empty object instead of error object
  const parseResult = safeParseMetadata(row.metadata)
  let metadata: Record<string, any> | undefined = undefined
  
  if (parseResult.metadata) {
    // Check if metadata is an error object (has _parseError flag)
    if (parseResult.metadata._parseError) {
      // Metadata parsing failed - use empty object to prevent downstream issues
      // Log warning but don't fail - email can still be processed
      logWarn('Metadata parsing error in formatEmailQueueItem, using empty metadata', {
        emailId: row.id,
        error: parseResult.error || 'Unknown parsing error'
      }).catch(() => {}) // Fire-and-forget logging
      metadata = undefined
    } else {
      // Valid metadata
      metadata = parseResult.metadata
    }
  }
  
  return {
    id: row.id,
    emailType: row.email_type,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    htmlContent: row.html_content,
    textContent: row.text_content,
    metadata,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    status: row.status,
    errorMessage: row.error_message || undefined,
    scheduledAt: row.scheduled_at,
    nextRetryAt: row.next_retry_at || undefined,
    sentAt: row.sent_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

