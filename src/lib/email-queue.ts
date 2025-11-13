import { getTursoClient } from "./turso"
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
  }
): Promise<string> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
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
 * Get pending emails ready for retry
 */
export async function getPendingEmails(limit: number = 10): Promise<EmailQueueItem[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

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

  // Get all pending status_change emails
  // Optimized: Uses idx_email_queue_critical (status, email_type, created_at) index
  const result = await db.execute({
    sql: `
      SELECT * FROM email_queue
      WHERE status = 'pending'
        AND email_type = 'status_change'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
        AND retry_count < max_retries
      ORDER BY created_at ASC
      LIMIT ?
    `,
    args: [now, limit * 2], // Get more to filter by metadata
  })

  // Filter to only include emails with critical statuses in metadata
  // Critical statuses: pending_deposit, confirmed, cancelled
  const criticalEmails: EmailQueueItem[] = []
  
  for (const row of result.rows) {
    const email = formatEmailQueueItem(row)
    
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
 * Mark email as processing
 */
export async function markEmailProcessing(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)

  await db.execute({
    sql: `
      UPDATE email_queue
      SET status = 'processing', updated_at = ?
      WHERE id = ?
    `,
    args: [now, id],
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
  } else {
    console.log(`Email queue item ${id} scheduled for retry #${retryCount} at ${new Date(nextRetryAt * 1000).toISOString()}`)
  }
}

/**
 * Process pending emails in queue
 */
export async function processEmailQueue(limit: number = 10): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  const pendingEmails = await getPendingEmails(limit)
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }

  for (const email of pendingEmails) {
    try {
      results.processed++
      
      // Mark as processing
      await markEmailProcessing(email.id)

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
      
      results.errors.push(`Email ${email.id}: ${errorMessage}`)
      
      // Schedule next retry or mark as failed
      await scheduleNextRetry(email.id, errorMessage)
      
      if (email.retryCount + 1 >= email.maxRetries) {
        results.failed++
      }
      
      console.error(`Email queue item ${email.id} failed: ${errorMessage}`)
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

  console.log(`Processing ${pendingEmails.length} critical status change emails (pending_deposit/confirmed/cancelled)`)

  for (const email of pendingEmails) {
    try {
      results.processed++
      
      // Mark as processing
      await markEmailProcessing(email.id)

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
      
      console.log(`Critical status email ${email.id} sent successfully: ${result.messageId} (Status: ${metadata.status})`)
    } catch (error) {
      // Safely extract error message
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
      
      results.errors.push(`Email ${email.id}: ${errorMessage}`)
      
      // Schedule next retry or mark as failed
      await scheduleNextRetry(email.id, errorMessage)
      
      if (email.retryCount + 1 >= email.maxRetries) {
        results.failed++
        console.error(`Critical status email ${email.id} failed after ${email.retryCount + 1} retries`)
      } else {
        console.error(`Critical status email ${email.id} failed, scheduled for retry: ${errorMessage}`)
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
 * Cleanup old sent emails (older than specified days)
 */
export async function cleanupOldSentEmails(daysOld: number = 30): Promise<number> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const cutoffTime = now - (daysOld * 24 * 60 * 60)
  
  const result = await db.execute({
    sql: `
      DELETE FROM email_queue
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND sent_at < ?
    `,
    args: [cutoffTime],
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
 * Safely parse JSON metadata
 */
function safeParseMetadata(metadata: string | null | undefined): Record<string, any> | undefined {
  if (!metadata) return undefined
  
  // If already an object, return as-is
  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata
  }
  
  // If it's a string, try to parse it
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata)
    } catch (error) {
      console.error('Failed to parse metadata JSON:', error)
      console.error('Metadata value:', metadata)
      // Return a safe fallback object with the raw string
      return { _parseError: true, _rawValue: metadata }
    }
  }
  
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

