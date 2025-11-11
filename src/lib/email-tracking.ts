/**
 * Email Tracking Utilities
 * 
 * Prevents duplicate emails by tracking sent emails in database
 */

import { getTursoClient } from "./turso"
import { randomUUID } from "crypto"

/**
 * Check if an email has already been sent
 */
export async function hasEmailBeenSent(
  bookingId: string | null,
  emailType: string,
  status: string,
  recipientEmail: string
): Promise<boolean> {
  const db = getTursoClient()
  
  // Check if email was sent in the last 24 hours (to prevent duplicates)
  const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60)
  
  const result = await db.execute({
    sql: `
      SELECT id FROM email_sent_log
      WHERE booking_id = ?
        AND email_type = ?
        AND status = ?
        AND recipient_email = ?
        AND sent_at > ?
      LIMIT 1
    `,
    args: [bookingId || null, emailType, status, recipientEmail, oneDayAgo],
  })

  return result.rows.length > 0
}

/**
 * Log that an email has been sent
 */
export async function logEmailSent(
  bookingId: string | null,
  emailType: string,
  status: string,
  recipientEmail: string
): Promise<void> {
  const db = getTursoClient()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  try {
    await db.execute({
      sql: `
        INSERT INTO email_sent_log (
          id, booking_id, email_type, recipient_email, status, sent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [id, bookingId || null, emailType, recipientEmail, status, now, now],
    })
  } catch (error) {
    // If duplicate (UNIQUE constraint violation), that's okay - email was already logged
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      console.log(`Email already logged: ${emailType} for booking ${bookingId}`)
      return
    }
    // Otherwise, log the error but don't fail
    console.error("Failed to log email sent:", error)
  }
}


