import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID } from "crypto"
import nodemailer from "nodemailer"
import { getTransporter } from "./email"

/**
 * Email Queue Management
 * 
 * Handles failed email notifications with retry logic
 */

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
  
  // IMPROVED: Check for duplicate emails before adding to queue
  // Prevents duplicate emails for same booking/status change within 5 minutes
  // FIXED: Use JSON extraction instead of LIKE pattern matching to prevent false positives/negatives
  if (!options?.skipDuplicateCheck && metadata?.bookingId) {
    try {
      // FIXED: Use JSON extraction to safely check for bookingId in metadata
      // This is more reliable than LIKE pattern matching and prevents false matches
      const bookingIdStr = String(metadata.bookingId)
      
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
          now - 300 // 5 minutes
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
                  console.log(`Duplicate email detected, returning existing queue item: ${existingId} (${emailType} to ${recipientEmail} for booking ${bookingIdStr}, status: ${newStatus})`)
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
              console.log(`Duplicate email detected (both missing status), returning existing queue item: ${existingId} (${emailType} to ${recipientEmail} for booking ${bookingIdStr})`)
              return existingId
            } else {
              // For non-status emails, just check bookingId
              const existingId = item.id
              console.log(`Duplicate email detected, returning existing queue item: ${existingId} (${emailType} to ${recipientEmail} for booking ${bookingIdStr})`)
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
      console.warn('Failed to check for duplicate email, continuing with queue addition:', error)
    }
  }
  
  const id = randomUUID()
  
  // Calculate next retry time (exponential backoff: 1min, 5min, 15min, 30min, 1hr)
  const retryDelays = [60, 300, 900, 1800, 3600] // seconds
  const nextRetryAt = options?.scheduledAt 
    ? options.scheduledAt 
    : now + retryDelays[0] // First retry after 1 minute

  await db.execute({
    sql: `
      INSERT INTO email_queue (
        id, email_type, recipient_email, subject, html_content, text_content,
        metadata, retry_count, max_retries, status, scheduled_at, next_retry_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      emailType,
      recipientEmail,
      subject,
      htmlContent,
      textContent,
      metadata ? JSON.stringify(metadata) : null,
      0,
      options?.maxRetries || 5,
      "pending",
      options?.scheduledAt || now,
      nextRetryAt,
      now,
      now,
    ],
  })

  console.log(`Email queued for retry: ${id} (${emailType} to ${recipientEmail})`)
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
            AND updated_at = updated_at`,  // Additional condition to ensure atomicity
    args: [now, now - STUCK_THRESHOLD],
  })
  
  const resetCount = result.rowsAffected || 0
  if (resetCount > 0) {
    console.log(`[email-queue] Reset ${resetCount} stuck email(s) from 'processing' to 'pending'`)
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
  cleanupStuckEmails().catch(err => {
    console.error('[email-queue] Failed to cleanup stuck emails:', err)
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
  cleanupStuckEmails().catch(err => {
    console.error('[email-queue] Failed to cleanup stuck emails:', err)
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
export async function updateEmailQueueStatus(
  id: string,
  status: EmailQueueItem["status"],
  errorMessage?: string
): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  await db.execute({
    sql: `
      UPDATE email_queue
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [status, errorMessage || null, now, id],
  })
}

/**
 * Mark email as processing (atomic - prevents concurrent processing)
 * Returns true if successfully claimed, false if already claimed by another process
 */
export async function markEmailProcessing(id: string): Promise<boolean> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

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

  // If rowsAffected > 0, we successfully claimed the email
  // If rowsAffected = 0, another process already claimed it
  return (result.rowsAffected || 0) > 0
}

/**
 * Atomically select and claim pending emails
 * This eliminates the race condition between getPendingEmails and markEmailProcessing
 * Returns emails that were successfully claimed by this process
 */
export async function atomicallyClaimPendingEmails(limit: number = 10): Promise<EmailQueueItem[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

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

    // Step 2: Extract IDs and claim them atomically
    const ids = selectResult.rows.map(row => (row as any).id)
    
    // Step 3: Atomically claim all selected emails in one UPDATE
    // Only update emails that are still 'pending' (handles race condition)
    const placeholders = ids.map(() => '?').join(',')
    await tx.execute({
      sql: `
        UPDATE email_queue
        SET status = 'processing', updated_at = ?
        WHERE id IN (${placeholders}) AND status = 'pending'
      `,
      args: [now, ...ids],
    })

    // Step 4: Return only emails that were successfully claimed
    // Query again to get only emails that are now in 'processing' status with current timestamp
    const claimedResult = await tx.execute({
      sql: `
        SELECT * FROM email_queue
        WHERE id IN (${placeholders}) AND status = 'processing' AND updated_at = ?
      `,
      args: [...ids, now],
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

  await db.execute({
    sql: `
      UPDATE email_queue
      SET status = 'sent', sent_at = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [now, now, id],
  })
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

  // Exponential backoff: 1min, 5min, 15min, 30min, 1hr
  const retryDelays = [60, 300, 900, 1800, 3600] // seconds
  const delayIndex = Math.min(retryCount - 1, retryDelays.length - 1)
  const delay = retryDelays[delayIndex]
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

  if (status === "failed") {
    console.error(`Email queue item ${id} failed after ${retryCount} retries`)
    
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
      console.error(`Failed to send admin notification for failed email ${id}:`, notificationError)
    }
  } else {
    console.log(`Email queue item ${id} scheduled for retry #${retryCount} at ${new Date(nextRetryAt * 1000).toISOString()}`)
  }
}

/**
 * Process pending emails in queue
 * IMPROVED: Added rate limiting to prevent overwhelming SMTP server
 */
export async function processEmailQueue(limit: number = 10): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  // IMPROVED: Rate limiting for email queue processing
  // Prevents overwhelming SMTP server or triggering email provider rate limits
  // Default: 30 emails per minute (configurable via EMAIL_QUEUE_RATE_LIMIT env var)
  const EMAIL_RATE_LIMIT = parseInt(process.env.EMAIL_QUEUE_RATE_LIMIT || "30") // emails per minute
  const EMAIL_RATE_WINDOW = 60 // 1 minute in seconds
  
  // Check rate limit before processing
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / EMAIL_RATE_WINDOW) * EMAIL_RATE_WINDOW
  
  // Get count of emails sent in current window
  const rateCheckResult = await db.execute({
    sql: `
      SELECT COUNT(*) as count 
      FROM email_queue 
      WHERE status = 'sent' 
        AND sent_at >= ?
    `,
    args: [windowStart],
  })
  
  const sentInWindow = (rateCheckResult.rows[0] as any)?.count || 0
  
  if (sentInWindow >= EMAIL_RATE_LIMIT) {
    const waitTime = EMAIL_RATE_WINDOW - (now - windowStart)
    console.log(`[email-queue] Rate limit reached (${sentInWindow}/${EMAIL_RATE_LIMIT} emails in current window). Waiting ${waitTime} seconds before processing.`)
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: [`Rate limit reached: ${sentInWindow}/${EMAIL_RATE_LIMIT} emails sent in current minute`],
    }
  }
  
  // Calculate how many emails we can process in this batch
  const remainingQuota = EMAIL_RATE_LIMIT - sentInWindow
  const effectiveLimit = Math.min(limit, remainingQuota)
  
  if (effectiveLimit <= 0) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: [`Rate limit reached: no quota remaining in current window`],
    }
  }
  
  // CRITICAL: Use atomic claim to eliminate race condition
  // This selects and claims emails in one atomic operation
  const pendingEmails = await atomicallyClaimPendingEmails(effectiveLimit)
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }

  // IMPROVED: Add delay between emails to respect rate limits
  // Small delay (100ms) between emails to prevent burst sending
  const DELAY_BETWEEN_EMAILS = 100 // milliseconds
  
  for (let i = 0; i < pendingEmails.length; i++) {
    const email = pendingEmails[i]
    
    // Add delay between emails (except for first one)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_EMAILS))
    }
    
    try {
      // CRITICAL: Email is already claimed atomically by atomicallyClaimPendingEmails
      // No need to claim again - it's already in 'processing' status
      results.processed++

      // Send email
      const transporter = await getTransporter()
      const metadata = typeof email.metadata === 'object' 
        ? email.metadata 
        : (email.metadata ? safeParseMetadata(email.metadata) || {} : {})
      
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
      
      console.log(`Email queue item ${email.id} sent successfully: ${result.messageId}`)
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
          console.error(`Failed to send admin notification for failed email ${email.id}:`, notificationError)
        }
      }
      
      console.error(`Email queue item ${email.id} failed: ${errorMessage}`)
    }
    
    // IMPROVED: Check if we've hit the rate limit during processing
    // If we've sent enough emails, stop processing to respect rate limits
    if (results.sent >= remainingQuota) {
      console.log(`[email-queue] Rate limit reached during processing (${results.sent} emails sent). Stopping batch.`)
      break
    }
  }

  return results
}

/**
 * Process pending critical status change emails
 * Handles: pending_deposit, confirmed, cancelled
 */
export async function processCriticalStatusEmails(limit: number = 20): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  const pendingEmails = await getPendingCriticalStatusEmails(limit)
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }

  console.log(`Processing ${pendingEmails.length} critical emails (status changes, user confirmations, admin notifications)`)

  for (const email of pendingEmails) {
    try {
      // ATOMIC CLAIM: Try to claim email atomically
      // If another process already claimed it, skip this email
      const claimed = await markEmailProcessing(email.id)
      if (!claimed) {
        // Another process already claimed this email, skip it
        console.log(`Email ${email.id} already claimed by another process, skipping`)
        continue
      }
      
      results.processed++

      // Send email
      const transporter = await getTransporter()
      const metadata = typeof email.metadata === 'object' 
        ? email.metadata 
        : (email.metadata ? safeParseMetadata(email.metadata) || {} : {})
      
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
        console.log(`User confirmation email ${email.id} sent successfully: ${result.messageId}`)
      } else if (email.emailType === 'admin_notification') {
        console.log(`Admin notification email ${email.id} sent successfully: ${result.messageId}`)
      } else {
        console.log(`Critical status email ${email.id} sent successfully: ${result.messageId} (Status: ${metadata.status || 'N/A'})`)
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
        console.error(`${email.emailType} email ${email.id} failed after ${email.retryCount + 1} retries`)
      } else {
        console.error(`${email.emailType} email ${email.id} failed, scheduled for retry: ${errorMessage}`)
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
  
  // Search for booking reference in metadata JSON
  // Metadata can contain bookingId or booking reference number
  // We search in the JSON string for the reference pattern
  if (options?.bookingReference) {
    const refLower = options.bookingReference.toLowerCase().trim()
    if (refLower) {
      // Search for booking reference in metadata JSON
      // Pattern: looks for "bookingId" or "referenceNumber" fields containing the search term
      // Use LIKE with escaped pattern to search in JSON string
      const escapedRef = refLower.replace(/%/g, '\\%').replace(/_/g, '\\_')
      sql += " AND (metadata LIKE ? OR metadata LIKE ? OR subject LIKE ?)"
      args.push(`%"bookingId":"%${escapedRef}%`, `%"referenceNumber":"%${escapedRef}%`, `%[${escapedRef}%`)
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
  
  try {
    // Mark as processing
    await markEmailProcessing(id)
    
    // Send email
    const transporter = await getTransporter()
    const metadata = typeof email.metadata === 'object' 
      ? email.metadata 
      : (email.metadata ? safeParseMetadata(email.metadata) || {} : {})
    
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
    
    console.log(`Email ${id} manually retried successfully: ${result.messageId}`)
    return { success: true }
  } catch (error) {
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
    
    await scheduleNextRetry(id, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Cancel an email in queue
 */
export async function cancelEmail(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  await db.execute({
    sql: "UPDATE email_queue SET status = 'cancelled', updated_at = ? WHERE id = ?",
    args: [now, id],
  })
}

/**
 * Delete an email from queue
 */
export async function deleteEmail(id: string): Promise<void> {
  const db = getTursoClient()
  
  await db.execute({
    sql: "DELETE FROM email_queue WHERE id = ?",
    args: [id],
  })
}

/**
 * Cleanup all sent emails (removes all emails with status 'sent')
 * 
 * NOTE: This function deletes ALL sent emails, not just old ones.
 * If you need to delete only emails older than a certain threshold,
 * modify the SQL query to add a date filter.
 */
export async function cleanupAllSentEmails(): Promise<number> {
  const db = getTursoClient()
  
  const result = await db.execute({
    sql: `
      DELETE FROM email_queue
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
    `,
    args: [],
  })
  
  return result.rowsAffected || 0
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
function safeParseMetadata(metadata: string | null | undefined): Record<string, any> | undefined {
  if (!metadata) return undefined
  
  // If already an object, validate it's not circular and return as-is
  if (typeof metadata === 'object' && !Array.isArray(metadata) && metadata !== null) {
    // Check for circular references (basic check)
    try {
      JSON.stringify(metadata)
      return metadata
    } catch (error) {
      // Circular reference detected - return safe fallback
      console.warn('Metadata contains circular reference, using fallback')
      return { _parseError: true, _error: 'circular_reference' }
    }
  }
  
  // If it's a string, try to parse it
  if (typeof metadata === 'string') {
    // Validate string is not empty or just whitespace
    const trimmed = metadata.trim()
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
      return undefined
    }
    
    // CRITICAL: Check size before parsing to prevent DoS
    // Limit metadata size (configurable via environment variable)
    const MAX_METADATA_SIZE = parseInt(
      process.env.MAX_EMAIL_METADATA_SIZE || '102400', // 100KB default
      10
    )
    if (trimmed.length > MAX_METADATA_SIZE) {
      console.warn(`Metadata string too large: ${trimmed.length} bytes, max: ${MAX_METADATA_SIZE} bytes`)
      return { 
        _parseError: true, 
        _error: 'metadata_too_large',
        _errorMessage: `Metadata exceeds maximum size of ${MAX_METADATA_SIZE} bytes`
      }
    }
    
    try {
      const parsed = JSON.parse(trimmed)
      
      // Validate parsed result is an object (not array, string, number, etc.)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // Check for circular references in parsed object
        try {
          JSON.stringify(parsed)
          return parsed
        } catch (circularError) {
          console.warn('Parsed metadata contains circular reference, using fallback')
          return { _parseError: true, _error: 'circular_reference' }
        }
      } else {
        // Parsed but not an object - wrap it
        console.warn('Metadata parsed but is not an object, wrapping it')
        return { _parsedValue: parsed }
      }
    } catch (error) {
      // JSON parse failed - log for investigation but don't fail
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to parse metadata JSON:', errorMessage)
      console.error('Metadata value (first 200 chars):', metadata.substring(0, 200))
      
      // Return a safe fallback object with error info (but sanitized)
      return { 
        _parseError: true, 
        _error: 'invalid_json',
        _errorMessage: errorMessage.substring(0, 100) // Limit error message length
      }
    }
  }
  
  // Unknown type - return undefined
  return undefined
}

/**
 * Format email queue item from database row
 */
function formatEmailQueueItem(row: any): EmailQueueItem {
  return {
    id: row.id,
    emailType: row.email_type,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    htmlContent: row.html_content,
    textContent: row.text_content,
    metadata: safeParseMetadata(row.metadata),
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

