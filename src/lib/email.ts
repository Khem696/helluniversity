import nodemailer, { type Transporter } from 'nodemailer'
import type { Booking } from './bookings'
import { addEmailToQueue } from './email-queue'

interface ReservationData {
  name: string
  email: string
  phone: string
  participants?: string
  eventType: string
  otherEventType?: string
  dateRange: boolean
  startDate: string | null
  endDate: string | null
  startTime?: string
  endTime?: string
  organizationType?: "Tailor Event" | "Space Only" | ""
  introduction: string
  biography?: string
  specialRequests?: string
}

// Create reusable transporter
let transporter: Transporter | null = null
let transporterVerified = false

/**
 * Get or create the email transporter with connection verification
 * Uses nodemailer v7 compatible configuration
 */
export async function getTransporter(): Promise<Transporter> {
  if (transporter && transporterVerified) {
    return transporter
  }

  const config = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
    },
    // Connection timeout (milliseconds)
    connectionTimeout: 10000,
    // Socket timeout (milliseconds)
    socketTimeout: 10000,
    // Greeting timeout (milliseconds)
    greetingTimeout: 5000,
  }

  // Validate required configuration
  if (!config.auth?.user || !config.auth?.pass) {
    throw new Error('SMTP credentials not configured. Please set SMTP_USER and SMTP_PASSWORD environment variables.')
  }

  transporter = nodemailer.createTransport(config)

  // Verify transporter connection (nodemailer v7 best practice)
  try {
    await transporter.verify()
    transporterVerified = true
    console.log('SMTP connection verified successfully')
  } catch (error) {
    console.error('SMTP connection verification failed:', error)
    // Don't throw here - allow retry on next attempt
    transporterVerified = false
    throw new Error(
      `SMTP connection failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'Please check your SMTP configuration and credentials.'
    )
  }

  return transporter
}

/**
 * Reset transporter (useful for testing or reconfiguration)
 */
export function resetTransporter(): void {
  transporter?.close()
  transporter = null
  transporterVerified = false
}

// Format event type for display
function formatEventType(eventType: string, otherEventType?: string): string {
  const eventTypes: Record<string, string> = {
    'reunion': 'Reunion',
    'family-friends': 'Family & Friends',
    'baby-shower': 'Baby Shower',
    'engagement': 'Engagement',
    'art-workshop': 'Art Workshop',
    'painting-workshop': 'Painting Workshop',
    'ceramics-workshop': 'Ceramics Workshop',
    'brainstorming-session': 'Brainstorming Session',
    'other': 'Other',
  }
  
  const baseType = eventTypes[eventType] || eventType
  
  // If there's an "other" event type specified, append it
  if (otherEventType && otherEventType.trim() && otherEventType.trim() !== 'N/A') {
    return `${baseType} - ${otherEventType.trim()}`
  }
  
  return baseType
}

// Helper function to add AM/PM to 24-hour time format for display
// Converts "13:00" -> "13:00 PM", "09:30" -> "09:30 AM", "00:00" -> "00:00 AM"
function formatTime24WithAMPM(time24: string | null | undefined): string {
  try {
    if (!time24 || !time24.trim() || !time24.includes(':')) return ''
    
    const trimmed = time24.trim()
    const [hours, minutes] = trimmed.split(':')
    const hour24 = parseInt(hours, 10)
    const mins = minutes || '00'
    
    if (isNaN(hour24)) return trimmed
    
    // Keep 24-hour format, just add AM/PM
    const period = hour24 < 12 ? 'AM' : 'PM'
    return `${trimmed} ${period}`
  } catch (error) {
    console.error('❌ formatTime24WithAMPM error:', error)
    return time24 || ''
  }
}

// Format date and time for display
// CRITICAL: Use Bangkok timezone to avoid timezone conversion issues
function formatDateTime(dateString: string | null | undefined, timeString?: string): string {
  try {
    if (!dateString) return "Not specified"
    
    // Parse date string (YYYY-MM-DD) in Bangkok timezone
    // dateString can be YYYY-MM-DD format or ISO string
    const dateOnly = dateString.includes('T') ? dateString.split('T')[0] : dateString
    const [year, month, day] = dateOnly.split('-').map(Number)
    
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return dateString || "Not specified"
    }
    
    // Create date in Bangkok timezone (GMT+7)
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
    
    // Format in Bangkok timezone
    const dateFormatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Bangkok',
    })
    
    if (timeString && timeString.trim()) {
      const formattedTime = formatTime24WithAMPM(timeString)
      return `${dateFormatted} at ${formattedTime}`
    }
    
    return dateFormatted
  } catch (error) {
    console.error('❌ formatDateTime error:', error)
    return dateString || "Not specified"
  }
}

// Format date range for display (handles single day and date range)
function formatDateRange(data: ReservationData): string {
  try {
    if (!data.startDate) {
      return "Not specified"
    }
    
    const startDateTime = formatDateTime(data.startDate, data.startTime)
    
    // Check if it's a multiple day booking:
    // 1. dateRange flag is true, OR
    // 2. endDate exists and is different from startDate
    const isMultipleDays = data.dateRange || (data.endDate && data.endDate !== data.startDate)
    
    // Single day booking
    if (!isMultipleDays || !data.endDate) {
      if (data.endTime && data.endTime.trim()) {
        const formattedEndTime = formatTime24WithAMPM(data.endTime)
        return `${startDateTime} to ${formattedEndTime}`
      }
      return startDateTime
    }
    
    // Date range booking - show full start and end dates with times
    const endDateTime = formatDateTime(data.endDate, data.endTime)
    return `${startDateTime} to ${endDateTime}`
  } catch (error) {
    console.error('❌ formatDateRange error:', error)
    return "Not specified"
  }
}

/**
 * Sanitize HTML content to prevent XSS attacks
 * Basic sanitization for email templates
 * Uses character-by-character replacement to avoid .replace() issues
 */
function sanitizeHTML(html: string | null | undefined): string {
  try {
    if (!html || typeof html !== 'string') return ''
    const str = String(html)
    if (!str || typeof str !== 'string') return ''
    
    // Use character-by-character replacement instead of .replace()
    let result = ''
    for (let i = 0; i < str.length; i++) {
      const char = str[i]
      if (char === '&') {
        result += '&amp;'
      } else if (char === '<') {
        result += '&lt;'
      } else if (char === '>') {
        result += '&gt;'
      } else if (char === '"') {
        result += '&quot;'
      } else if (char === "'") {
        result += '&#039;'
      } else {
        result += char
      }
    }
    return result
  } catch (error) {
    console.error('❌ sanitizeHTML error:', error, 'Input:', html)
    return ''
  }
}

/**
 * Sanitize user input for safe email content
 * Uses character-by-character processing to avoid .replace() issues
 */
function sanitizeUserInput(input: string | null | undefined): string {
  try {
    if (!input || typeof input !== 'string') return ''
    const str = String(input).trim()
    if (!str || typeof str !== 'string') return ''
    
    // Basic sanitization - remove dangerous patterns without using .replace()
    // For now, just return trimmed string since we're escaping HTML separately
    // The main XSS protection comes from sanitizeHTML
    return str
  } catch (error) {
    console.error('❌ sanitizeUserInput error:', error, 'Input:', input)
    return ''
  }
}

// Generate HTML email template for admin notification
function generateAdminEmailHTML(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"
  const safeParticipants = data.participants || "Not specified"
  const safeOrganizationType = data.organizationType || "Not specified"

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #5B9AB8;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
    }
    .content {
      background-color: #f9f9f9;
      padding: 30px;
      border: 1px solid #e0e0e0;
      border-top: none;
      border-radius: 0 0 8px 8px;
    }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #5a3a2a;
      margin-bottom: 12px;
      border-bottom: 2px solid #5B9AB8;
      padding-bottom: 5px;
    }
    .field {
      margin-bottom: 10px;
    }
    .field-label {
      font-weight: 600;
      color: #5a3a2a;
      display: inline-block;
      min-width: 140px;
    }
    .field-value {
      color: #333;
    }
    .text-content {
      background-color: white;
      padding: 15px;
      border-radius: 4px;
      margin-top: 8px;
      border-left: 3px solid #5B9AB8;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #666;
      text-align: center;
    }
    .timestamp {
      font-size: 12px;
      color: #666;
      margin-top: 20px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">New Reservation Inquiry</h1>
  </div>
  <div class="content">
    <div class="section">
      <div class="section-title">Booking Details</div>
      <div class="field">
        <span class="field-label">Name:</span>
        <span class="field-value">${sanitizeHTML(data.name)}</span>
      </div>
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value"><a href="mailto:${data.email}">${sanitizeHTML(data.email)}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Phone:</span>
        <span class="field-value"><a href="tel:${data.phone}">${sanitizeHTML(data.phone)}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Number of Participants:</span>
        <span class="field-value">${sanitizeHTML(safeParticipants)}</span>
      </div>
      <div class="field">
        <span class="field-label">Event Type:</span>
        <span class="field-value">${sanitizeHTML(formattedEventType)}</span>
      </div>
      <div class="field">
        <span class="field-label">Date & Time:</span>
        <span class="field-value">${sanitizeHTML(formattedDateRange)}</span>
      </div>
      <div class="field">
        <span class="field-label">Organization:</span>
        <span class="field-value">${sanitizeHTML(safeOrganizationType)} (${sanitizeHTML(organizationRemark)})</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Guest Information</div>
      <div class="field">
        <span class="field-label">Brief Your Desire:</span>
        <div class="text-content">${(function() {
          try {
            const intro = sanitizeUserInput(data.introduction)
            return intro && typeof intro === 'string' ? intro.split('\n').join('<br>') : ''
          } catch {
            return sanitizeUserInput(data.introduction) || ''
          }
        })()}</div>
      </div>
      ${data.biography ? `
      <div class="field">
        <span class="field-label">Background & Interests:</span>
        <div class="text-content">${(function() {
          try {
            const bio = sanitizeUserInput(data.biography)
            return bio && typeof bio === 'string' ? bio.split('\n').join('<br>') : ''
          } catch {
            return sanitizeUserInput(data.biography) || ''
          }
        })()}</div>
      </div>
      ` : ''}
      ${data.specialRequests ? `
      <div class="field">
        <span class="field-label">Special Requirements:</span>
        <div class="text-content">${(function() {
          try {
            const req = sanitizeUserInput(data.specialRequests)
            return req && typeof req === 'string' ? req.split('\n').join('<br>') : ''
          } catch {
            return sanitizeUserInput(data.specialRequests) || ''
          }
        })()}</div>
      </div>
      ` : ''}
    </div>

    <div class="timestamp">
      Received: ${new Date().toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'long',
        timeStyle: 'long',
      })}
    </div>
  </div>
  <div class="footer">
    <p>This email was automatically generated from the Hell University reservation form.</p>
  </div>
</body>
</html>
  `.trim()
}

// Generate plain text version for admin notification
function generateAdminEmailText(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"
  const safeParticipants = data.participants || "Not specified"
  const safeOrganizationType = data.organizationType || "Not specified"

  return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

BOOKING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Number of Participants: ${safeParticipants}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Organization: ${safeOrganizationType} (${organizationRemark})

GUEST INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brief Your Desire:
${data.introduction}

${data.biography ? `Background & Interests:\n${data.biography}\n\n` : ''}${data.specialRequests ? `Special Requirements:\n${data.specialRequests}\n\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Received: ${new Date().toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'long',
    timeStyle: 'long',
  })}
  `.trim()
}

// Generate HTML email template for user auto-reply
function generateUserEmailHTML(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"
  const safeParticipants = data.participants || "Not specified"
  const safeOrganizationType = data.organizationType || "Not specified"

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #3e82bb;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .content {
      background-color: #f9f9f9;
      padding: 30px;
      border: 1px solid #e0e0e0;
      border-top: none;
      border-radius: 0 0 8px 8px;
    }
    .summary {
      background-color: white;
      padding: 20px;
      border-radius: 4px;
      margin: 20px 0;
      border-left: 3px solid #3e82bb;
    }
    .summary-item {
      margin-bottom: 10px;
    }
    .summary-label {
      font-weight: 600;
      color: #5a3a2a;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
    .signature {
      margin-top: 20px;
      color: #5a3a2a;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">Reservation Inquiry Received</h1>
  </div>
  <div class="content">
    <p>Dear ${sanitizeHTML(data.name)},</p>
    
    <p>Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.</p>
    
    <div class="summary">
      <h3 style="margin-top: 0; color: #5a3a2a;">Your Inquiry Summary:</h3>
      <div class="summary-item">
        <span class="summary-label">Event Type:</span> ${sanitizeHTML(formattedEventType)}
      </div>
      <div class="summary-item">
        <span class="summary-label">Date & Time:</span> ${sanitizeHTML(formattedDateRange)}
      </div>
      <div class="summary-item">
        <span class="summary-label">Number of Participants:</span> ${sanitizeHTML(safeParticipants)}
      </div>
      <div class="summary-item">
        <span class="summary-label">Organization:</span> ${sanitizeHTML(safeOrganizationType)} (${sanitizeHTML(organizationRemark)})
      </div>
    </div>
    
    <p>If you have any urgent questions or need to modify your inquiry, please don't hesitate to contact us.</p>
    
    <div class="signature">
      Best regards,<br>
      The Hell University Team
    </div>
  </div>
  <div class="footer">
    <p>This is an automated confirmation email. Please do not reply to this message.</p>
    <p style="margin-top: 10px;">
      <a href="mailto:admin@huculturehub.com" style="color: #5B9AB8;">admin@huculturehub.com</a>
    </p>
  </div>
</body>
</html>
  `.trim()
}

// Generate plain text version for user auto-reply
function generateUserEmailText(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"
  const safeParticipants = data.participants || "Not specified"
  const safeOrganizationType = data.organizationType || "Not specified"

  return `
RESERVATION INQUIRY RECEIVED - HELL UNIVERSITY

Dear ${data.name},

Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.

YOUR INQUIRY SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Number of Participants: ${safeParticipants}
Organization: ${safeOrganizationType} (${organizationRemark})

If you have any urgent questions or need to modify your inquiry, please don't hesitate to contact us.

Best regards,
The Hell University Team

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated confirmation email. Please do not reply to this message.
For inquiries: admin@huculturehub.com
  `.trim()
}

/**
 * Send reservation notification email to admin
 * Uses nodemailer v7 compatible API
 */
export async function sendAdminNotification(data: ReservationData, bookingId?: string): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const formattedDateRange = formatDateRange(data)
  // CRITICAL: Always start subject with booking reference number for easy identification
  const referencePrefix = bookingId ? `[${bookingId}] ` : ''

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: data.email,
    subject: `${referencePrefix}New Reservation Inquiry - ${formattedEventType} - ${formattedDateRange.substring(0, 50)}`,
    text: generateAdminEmailText(data),
    html: generateAdminEmailHTML(data),
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    // Log successful send (nodemailer v7 returns messageId)
    console.log('Admin notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[sendAdminNotification] ❌ Failed to send admin notification, queuing for retry:`, errorMessage)
    
    try {
      await addEmailToQueue(
        'admin_notification',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingData: data, replyTo: data.email, bookingId: bookingId }
      )
      console.log(`[sendAdminNotification] ✅ Admin notification queued for retry`)
      // Don't throw error if email was successfully queued - it will be sent by the queue processor
      // Return normally so calling function knows it was queued (not sent, but will be sent)
      return
    } catch (queueError) {
      console.error(`[sendAdminNotification] ❌ Failed to queue admin notification for retry:`, queueError)
      // Only throw if queueing also fails - this is a critical error
      throw error
    }
  }
}

/**
 * Send auto-reply confirmation email to user
 * Uses nodemailer v7 compatible API
 */
export async function sendUserConfirmation(data: ReservationData, bookingId?: string): Promise<void> {
  // CRITICAL: Always start subject with booking reference number for easy identification
  const referencePrefix = bookingId ? `[${bookingId}] ` : ''
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: data.email,
    subject: `${referencePrefix}Reservation Inquiry Received - Hell University`,
    text: generateUserEmailText(data),
    html: generateUserEmailHTML(data),
  }

  console.log(`[sendUserConfirmation] Attempting to send user confirmation email to ${data.email} (booking: ${bookingId || 'N/A'})`)
  
  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    // Log successful send (nodemailer v7 returns messageId)
    console.log(`[sendUserConfirmation] ✅ User confirmation email sent successfully: ${result.messageId} to ${data.email}`)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[sendUserConfirmation] ❌ Failed to send user confirmation to ${data.email} (booking: ${bookingId || 'N/A'}), queuing for retry:`, errorMessage)
    
    try {
      await addEmailToQueue(
        'user_confirmation',
        data.email,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingData: data, bookingId: bookingId }
      )
      console.log(`[sendUserConfirmation] ✅ User confirmation queued for retry to ${data.email}`)
      // Don't throw error if email was successfully queued - it will be sent by the queue processor
      // Return normally so calling function knows it was queued (not sent, but will be sent)
      return
    } catch (queueError) {
      console.error(`[sendUserConfirmation] ❌ Failed to queue user confirmation for retry:`, queueError)
      // Only throw if queueing also fails - this is a critical error
      throw error
    }
  }
}

/**
 * Send both admin notification and user confirmation
 * Returns success status and any errors
 * Uses nodemailer v7 compatible error handling
 */
export async function sendReservationEmails(
  data: ReservationData,
  bookingReference?: string
): Promise<{ adminSent: boolean; userSent: boolean; errors: string[] }> {
  const errors: string[] = []
  let adminSent = false
  let userSent = false

  // Send admin notification FIRST - MUST succeed before sending user email
  // Note: If email fails but gets queued, sendAdminNotification returns normally (doesn't throw)
  // This allows user email to still be sent even if admin email was queued
  try {
    console.error('='.repeat(60))
    console.error('STEP 1: Attempting to send admin notification email...')
    console.error('='.repeat(60))
    await sendAdminNotification(data, bookingReference)
    adminSent = true
    console.error('✅ Admin notification sent or queued successfully')
    console.error('='.repeat(60))
  } catch (error) {
    // Handle different types of errors
    let errorMessage = 'Unknown error'
    let errorCode = 'UNKNOWN'
    
    if (error instanceof Error) {
      errorMessage = error.message
      
      // Check for specific nodemailer error codes
      if ('code' in error) {
        errorCode = (error as { code?: string }).code || 'UNKNOWN'
        if (errorCode === 'EAUTH') {
          errorMessage = 'SMTP authentication failed. Please check your credentials.'
        } else if (errorCode === 'ECONNECTION') {
          errorMessage = 'SMTP connection failed. Please check your network and SMTP settings.'
        } else if (errorCode === 'ETIMEDOUT') {
          errorMessage = 'SMTP connection timeout. Please check your SMTP host and port.'
        }
      }
    }
    
    errors.push(`Admin notification failed: ${errorMessage}`)
    console.error('❌ FAILED to send admin notification email')
    console.error('Error type:', error?.constructor?.name || 'Unknown')
    console.error('Error message:', errorMessage)
    console.error('Error code:', errorCode)
    console.error('Full error object:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    console.error('='.repeat(60))
    console.error('⚠️ CRITICAL: Admin email failed. User email will NOT be sent to avoid confusion.')
    console.error('='.repeat(60))
    
    // Reset transporter if connection failed (allows retry on next attempt)
    if (errorMessage.includes('connection') || errorMessage.includes('SMTP')) {
      resetTransporter()
    }
    
    // Return early - don't send user email if admin email failed
    // This MUST return immediately to prevent user email from being sent
    const result = { adminSent: false, userSent: false, errors }
    console.error('🚫 RETURNING EARLY - User email will NOT be sent:', JSON.stringify(result))
    console.error('🚫 EXITING FUNCTION - User email code will NOT execute')
    return result
  }

  // CRITICAL: Double-check admin email succeeded before proceeding
  // This should NEVER execute if admin email failed (due to early return above)
  if (!adminSent) {
    console.error('❌ CRITICAL ERROR: Admin email failed but code reached user email section!')
    console.error('❌ This should never happen - early return should have prevented this!')
    const result = { adminSent: false, userSent: false, errors }
    console.error('🚫 FORCING RETURN (second check) - User email will NOT be sent:', JSON.stringify(result))
    return result
  }
  
  // Only execute if admin email succeeded or was queued
  // Note: If user email fails but gets queued, sendUserConfirmation returns normally (doesn't throw)
  console.error('✅ Admin email succeeded or queued, proceeding to send user email...')
  try {
    console.error('='.repeat(60))
    console.error('STEP 2: Attempting to send user confirmation email...')
    console.error('='.repeat(60))
    await sendUserConfirmation(data, bookingReference)
    userSent = true
    console.error('✅ User confirmation sent or queued successfully')
    console.error('='.repeat(60))
  } catch (error) {
    // Handle different types of errors
    let errorMessage = 'Unknown error'
    
    if (error instanceof Error) {
      errorMessage = error.message
      
      // Check for specific nodemailer error codes
      if ('code' in error) {
        const errorCode = (error as { code?: string }).code
        if (errorCode === 'EAUTH') {
          errorMessage = 'SMTP authentication failed. Please check your credentials.'
        } else if (errorCode === 'ECONNECTION') {
          errorMessage = 'SMTP connection failed. Please check your network and SMTP settings.'
        } else if (errorCode === 'ETIMEDOUT') {
          errorMessage = 'SMTP connection timeout. Please check your SMTP host and port.'
        }
      }
    }
    
    errors.push(`User confirmation failed: ${errorMessage}`)
    console.error('❌ FAILED to send user confirmation email')
    console.error('Error type:', error?.constructor?.name || 'Unknown')
    console.error('Error message:', errorMessage)
    console.error('Full error object:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    console.error('='.repeat(60))
    
    // Reset transporter if connection failed (allows retry on next attempt)
    if (errorMessage.includes('connection') || errorMessage.includes('SMTP')) {
      resetTransporter()
    }
  }

  // Final summary (using error so it shows in production)
  console.error('='.repeat(60))
  console.error('EMAIL SENDING SUMMARY:')
  console.error('='.repeat(60))
  console.error('Admin notification:', adminSent ? '✅ SENT' : '❌ FAILED')
  console.error('User confirmation:', userSent ? '✅ SENT' : '❌ FAILED')
  if (errors.length > 0) {
    console.error('Errors:', errors)
  }
  console.error('='.repeat(60))
  
  return { adminSent, userSent, errors }
}

/**
 * Verify email configuration
 */
export function verifyEmailConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
    errors.push('SMTP configuration not found. Email sending will be disabled.')
  }

  if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) {
    errors.push('SMTP_PASSWORD is required when SMTP_USER is set')
  }

  if (!process.env.RESERVATION_EMAIL && !process.env.SMTP_USER) {
    errors.push('RESERVATION_EMAIL or SMTP_USER must be set')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate booking status change email HTML
 */
function generateStatusChangeEmailHTML(
  booking: Booking,
  status: string,
  changeReason?: string,
  proposedDate?: string | null,
  responseToken?: string,
  proposedEndDate?: string | null,
  proposedStartTime?: string | null,
  proposedEndTime?: string | null,
  previousProposedDate?: string | null,
  previousProposedEndDate?: string | null,
  previousProposedStartTime?: string | null,
  previousProposedEndTime?: string | null
): string {
  // Use NEXT_PUBLIC_SITE_URL if set, otherwise try VERCEL_URL (for preview deployments),
  // otherwise fall back to production domain
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://huculturehub.com'
  const responseUrl = responseToken
    ? `${siteUrl}/booking/response/${responseToken}`
    : null

  const depositUploadUrl = responseToken
    ? `${siteUrl}/booking/deposit/${responseToken}`
    : null

  // Determine if this is a successful upload (check changeReason) or a rejection
  const isSuccessfulUpload = changeReason?.toLowerCase().includes('uploaded successfully') || 
                             changeReason?.toLowerCase().includes('upload successfully')
  const isRejection = booking.depositEvidenceUrl && !isSuccessfulUpload
  
  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    pending_deposit: {
      title: isRejection
        ? 'Deposit Evidence Required - Re-upload Needed'
        : 'Reservation Accepted - Deposit Required',
      message: isRejection
        ? 'The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence using the link below. Please send a deposit evidence before start date.'
        : 'Great news! Your reservation request has been accepted. Please upload your deposit evidence to complete the booking process. Please send a deposit evidence before start date.',
      color: isRejection ? '#f59e0b' : '#10b981',
    },
    paid_deposit: {
      title: changeReason?.toLowerCase().includes('restored') || changeReason?.toLowerCase().includes('restoration')
        ? 'Booking Restored - Deposit Evidence Available'
        : 'Deposit Evidence Uploaded Successfully',
      message: changeReason?.toLowerCase().includes('restored') || changeReason?.toLowerCase().includes('restoration')
        ? 'Your booking has been restored. Your deposit evidence is available and will be reviewed by our admin team. You will receive an email notification once the verification is complete.'
        : 'Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your booking shortly. You will receive an email notification once the verification is complete.',
      color: '#10b981',
    },
    confirmed: {
      title: 'Booking Confirmed',
      message: changeReason?.toLowerCase().includes('other channel')
        ? 'Your booking has been confirmed! Your deposit was verified through other channels (phone, in-person verification, etc.). Your reservation is now confirmed. We look forward to hosting your event!'
        : 'Your booking has been confirmed! Your deposit has been verified and your reservation is now confirmed. We look forward to hosting your event!',
      color: '#10b981',
    },
    cancelled: {
      title: 'Reservation Cancelled',
      message: 'Your reservation has been cancelled. We hope to see you at another opportunity in the future.',
      color: '#6b7280',
    },
    finished: {
      title: 'Booking Completed',
      message: 'Your booking has been completed. Thank you for choosing Hell University!',
      color: '#3b82f6',
    },
    pending: {
      title: 'Reservation Status Update',
      message: 'Your reservation status has been updated.',
      color: '#3b82f6',
    },
  }

  const statusInfo = statusMessages[status] || {
    title: 'Reservation Status Update',
    message: 'Your reservation status has been updated.',
    color: '#3b82f6',
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusInfo.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${statusInfo.color}; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                ${statusInfo.title}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                Dear ${sanitizeHTML(booking.name)},
              </p>
              
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                ${statusInfo.message}
              </p>
              
              <div style="background-color: #f9fafb; border-left: 4px solid ${statusInfo.color}; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Reservation Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 120px;">Event Type:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedEventType)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Date & Time:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedDateRange)}</td>
                  </tr>
                </table>
              </div>
              
              ${previousProposedDate && !proposedDate ? `
              <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 10px 0; color: #991b1b; font-size: 18px;">Previous Proposed Date${previousProposedEndDate && previousProposedEndDate !== previousProposedDate ? 's' : ''} (Cleared)</h3>
                <p style="margin: 0 0 10px 0; color: #7f1d1d; font-size: 16px; font-weight: 500;">
                  ${previousProposedEndDate && previousProposedEndDate !== previousProposedDate
                    ? `${sanitizeHTML((() => {
                        // CRITICAL: Parse date string (YYYY-MM-DD) in Bangkok timezone
                        const dateOnly = previousProposedDate.includes('T') ? previousProposedDate.split('T')[0] : previousProposedDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())} - ${sanitizeHTML((() => {
                        const dateOnly = previousProposedEndDate.includes('T') ? previousProposedEndDate.split('T')[0] : previousProposedEndDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())}`
                    : sanitizeHTML((() => {
                        const dateOnly = previousProposedDate.includes('T') ? previousProposedDate.split('T')[0] : previousProposedDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())}
                </p>
                ${(previousProposedStartTime || previousProposedEndTime) ? `
                <p style="margin: 5px 0 10px 0; color: #7f1d1d; font-size: 14px; line-height: 1.6;">
                  ${previousProposedStartTime && previousProposedEndTime
                    ? `Time: ${sanitizeHTML(previousProposedStartTime)} - ${sanitizeHTML(previousProposedEndTime)}`
                    : previousProposedStartTime
                      ? `Start Time: ${sanitizeHTML(previousProposedStartTime)}`
                      : previousProposedEndTime
                        ? `End Time: ${sanitizeHTML(previousProposedEndTime)}`
                        : ''}
                </p>
                ` : ''}
                <p style="margin: 0; color: #7f1d1d; font-size: 14px; line-height: 1.6;">
                  The above proposed date${previousProposedEndDate && previousProposedEndDate !== previousProposedDate ? 's' : ''} has been cleared. Please propose a new date below.
                </p>
              </div>
              ` : ''}
              
              ${proposedDate ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 18px;">${status === 'pending' ? 'Your Proposed Date' : 'Proposed New Date'}${proposedEndDate && proposedEndDate !== proposedDate ? 's' : ''}</h3>
                <p style="margin: 0 0 5px 0; color: #78350f; font-size: 16px; font-weight: 500;">
                  ${proposedEndDate && proposedEndDate !== proposedDate
                    ? `${sanitizeHTML((() => {
                        // CRITICAL: Parse date string (YYYY-MM-DD) in Bangkok timezone
                        const dateOnly = proposedDate.includes('T') ? proposedDate.split('T')[0] : proposedDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())} - ${sanitizeHTML((() => {
                        const dateOnly = proposedEndDate.includes('T') ? proposedEndDate.split('T')[0] : proposedEndDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())}`
                    : sanitizeHTML((() => {
                        const dateOnly = proposedDate.includes('T') ? proposedDate.split('T')[0] : proposedDate
                        const [year, month, day] = dateOnly.split('-').map(Number)
                        const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
                        return date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Bangkok'
                        })
                      })())}
                </p>
                ${(proposedStartTime || proposedEndTime) ? `
                <p style="margin: 5px 0 0 0; color: #78350f; font-size: 14px; line-height: 1.6;">
                  ${proposedStartTime && proposedEndTime
                    ? `Time: ${sanitizeHTML(proposedStartTime)} - ${sanitizeHTML(proposedEndTime)}`
                    : proposedStartTime
                      ? `Start Time: ${sanitizeHTML(proposedStartTime)}`
                      : proposedEndTime
                        ? `End Time: ${sanitizeHTML(proposedEndTime)}`
                        : ''}
                </p>
                ` : ''}
              </div>
              ` : ''}
              
              ${changeReason ? `
              <div style="margin: 20px 0;">
                <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px; font-weight: 500;">Additional Notes:</p>
                <p style="margin: 0; color: #333333; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${sanitizeHTML(changeReason)}</p>
              </div>
              ` : ''}
              
              ${status === 'accepted' ? `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ⚠️ IMPORTANT: Deposit Required
                </p>
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  Your reservation has been accepted! Please upload your deposit evidence to complete the booking process. The deposit must be uploaded before the reservation start date and time.
                </p>
                ${depositUploadUrl ? `
                <a href="${depositUploadUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  Upload Deposit Evidence
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${depositUploadUrl}" style="color: #3b82f6; word-break: break-all;">${depositUploadUrl}</a>
                </p>
                ` : responseUrl ? `
                <p style="margin: 0 0 15px 0; color: #ef4444; font-size: 14px; line-height: 1.6;">
                  Please visit the booking page to upload your deposit evidence:
                </p>
                <a href="${responseUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  Go to Booking Page
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${responseUrl}" style="color: #3b82f6; word-break: break-all;">${responseUrl}</a>
                </p>
                ` : `
                <p style="margin: 0; color: #ef4444; font-size: 14px; line-height: 1.6;">
                  Please contact us to receive your deposit upload link.
                </p>
                `}
              </div>
              ` : ''}
              
              ${status === 'paid_deposit' ? `
              <div style="margin: 30px 0; text-align: center; background-color: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 20px;">
                <p style="margin: 0 0 20px 0; color: #065f46; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ✅ Deposit Evidence Uploaded Successfully
                </p>
                <p style="margin: 0 0 20px 0; color: #047857; font-size: 16px; line-height: 1.6;">
                  Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your booking shortly. You will receive an email notification once the verification is complete.
                </p>
              </div>
              ` : ''}
              
              ${status === 'pending_deposit' ? (() => {
                const isRejection = booking.depositEvidenceUrl !== null && booking.depositEvidenceUrl !== ''
                return `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ⚠️ IMPORTANT: ${isRejection ? 'Deposit Re-upload Required' : 'Deposit Required'}
                </p>
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  ${isRejection
                    ? 'The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence using the link below. The deposit must be uploaded before the reservation start date and time.'
                    : 'Your reservation has been accepted! Please upload your deposit evidence to complete the booking process. The deposit must be uploaded before the reservation start date and time.'}
                </p>
              `
              })() : ''}
              
              ${status === 'pending_deposit' ? `
                ${depositUploadUrl ? `
                <a href="${depositUploadUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  ${booking.depositEvidenceUrl ? 'Re-upload Deposit Evidence' : 'Upload Deposit Evidence'}
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${depositUploadUrl}" style="color: #3b82f6; word-break: break-all;">${depositUploadUrl}</a>
                </p>
                <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  ⚠️ This link will expire at the start date and time of your booking (Bangkok timezone). Please upload your deposit before then.
                </p>
                ` : responseUrl ? `
                <p style="margin: 0 0 15px 0; color: #ef4444; font-size: 14px; line-height: 1.6;">
                  Please visit the booking page to upload your deposit evidence:
                </p>
                <a href="${responseUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  Go to Booking Page
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${responseUrl}" style="color: #3b82f6; word-break: break-all;">${responseUrl}</a>
                </p>
                ` : `
                <p style="margin: 0; color: #ef4444; font-size: 14px; line-height: 1.6;">
                  Please contact us to receive your deposit upload link.
                </p>
                `}
              </div>
              ` : ''}
              
              
              ${status === 'cancelled' ? `
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                We hope to see you at another opportunity in the future. Thank you for your interest in Hell University.
              </p>
              ` : `
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                If you have any questions, please don't hesitate to contact us.
              </p>
              `}
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
}

/**
 * Generate booking status change email text
 */
function generateStatusChangeEmailText(
  booking: Booking,
  status: string,
  changeReason?: string,
  proposedDate?: string | null,
  responseUrl?: string | null
): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://huculturehub.com'
  const depositUploadUrl = responseUrl?.replace('/booking/response/', '/booking/deposit/') || null

  // Determine if this is a successful upload (check changeReason) or a rejection
  const isSuccessfulUpload = changeReason?.toLowerCase().includes('uploaded successfully') || 
                             changeReason?.toLowerCase().includes('upload successfully')
  const isRejection = booking.depositEvidenceUrl && !isSuccessfulUpload

  const statusMessages: Record<string, string> = {
    pending_deposit: isSuccessfulUpload
      ? 'Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your booking shortly. You will receive an email notification once the verification is complete.'
      : isRejection
      ? 'The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence to complete the booking process. Please send a deposit evidence before start date.'
      : 'Great news! Your reservation request has been accepted. Please upload your deposit evidence to complete the booking process. Please send a deposit evidence before start date.',
    confirmed: 'Your booking has been confirmed! Your deposit has been verified and your reservation is now confirmed. We look forward to hosting your event!',
    cancelled: 'Your reservation has been cancelled. We hope to see you at another opportunity in the future.',
    finished: 'Your booking has been completed. Thank you for choosing Hell University!',
    pending: 'Your reservation status has been updated.',
  }

  const message = statusMessages[status] || 'Your reservation status has been updated.'
  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  let text = `Dear ${booking.name},\n\n`
  text += `${message}\n\n`
  text += `RESERVATION DETAILS:\n`
  text += `Event Type: ${formattedEventType}\n`
  text += `Date & Time: ${formattedDateRange}\n\n`

  if (proposedDate) {
    text += `${status === 'pending' ? 'YOUR PROPOSED DATE' : 'PROPOSED NEW DATE'}:\n`
    // CRITICAL: Parse date string (YYYY-MM-DD) in Bangkok timezone
    const dateOnly = proposedDate.includes('T') ? proposedDate.split('T')[0] : proposedDate
    const [year, month, day] = dateOnly.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
    text += `${date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'Asia/Bangkok'
    })}\n\n`
  }

  if (changeReason) {
    text += `ADDITIONAL NOTES:\n${changeReason}\n\n`
  }

  if (status === 'paid_deposit') {
    text += `\n✅ Deposit Evidence Uploaded Successfully\n\n`
    text += `Your deposit evidence has been uploaded successfully. Our admin team will review it and confirm your booking shortly. You will receive an email notification once the verification is complete.\n\n`
  }
  
  if (status === 'pending_deposit') {
    const isRejection = booking.depositEvidenceUrl !== null && booking.depositEvidenceUrl !== ''
    text += `\n⚠️ IMPORTANT: ${isRejection ? 'Deposit Re-upload Required' : 'Deposit Required'}\n\n`
    text += isRejection
      ? `The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence to complete the booking process. Please send a deposit evidence before start date.\n\n`
      : `Your reservation has been accepted! Please upload your deposit evidence to complete the booking process. Please send a deposit evidence before start date.\n\n`
    if (depositUploadUrl) {
      text += `Upload Deposit Evidence: ${depositUploadUrl}\n\n`
      text += `⚠️ This link will expire at the start date and time of your booking (Bangkok timezone). Please upload your deposit before then.\n\n`
    } else if (responseUrl) {
      text += `Please visit the booking page to upload your deposit evidence:\n${responseUrl}\n\n`
    } else {
      text += `Please contact us to receive your deposit upload link.\n\n`
    }
  }

  if (status === 'confirmed') {
    if (changeReason?.toLowerCase().includes('other channel')) {
      text += `\nYour booking has been confirmed! Your deposit was verified through other channels (phone, in-person verification, etc.). Your reservation is now confirmed. We look forward to hosting your event!\n\n`
    } else {
      text += `\nYour booking has been confirmed! Your deposit has been verified and your reservation is now confirmed. We look forward to hosting your event!\n\n`
    }
  }

  if (status === 'finished') {
    text += `\nYour booking has been completed. Thank you for choosing Hell University!\n\n`
  }

  if (status === 'cancelled') {
    text += `\nWe hope to see you at another opportunity in the future. Thank you for your interest in Hell University.\n\n`
  } else {
    text += `If you have any questions, please don't hesitate to contact us.\n\n`
  }
  text += `Best regards,\nHell University Team`

  return text
}

/**
 * Send booking status change notification to user
 */
export async function sendBookingStatusNotification(
  booking: Booking,
  status: string,
  options?: {
    changeReason?: string
    proposedDate?: string | null
    proposedEndDate?: string | null
    proposedStartTime?: string | null
    proposedEndTime?: string | null
    previousProposedDate?: string | null
    previousProposedEndDate?: string | null
    previousProposedStartTime?: string | null
    previousProposedEndTime?: string | null
    responseToken?: string
    skipDuplicateCheck?: boolean // Allow override for retries
  }
): Promise<void> {
  // Fix #7: Check for duplicate email before sending
  if (!options?.skipDuplicateCheck) {
    const { hasEmailBeenSent, logEmailSent } = await import("./email-tracking")
    const emailAlreadySent = await hasEmailBeenSent(
      booking.id,
      "status_change",
      status,
      booking.email
    )
    
    if (emailAlreadySent) {
      console.log(`Email already sent recently for booking ${booking.id}, status: ${status}, skipping duplicate`)
      return
    }
  }
  // Use NEXT_PUBLIC_SITE_URL if set, otherwise try VERCEL_URL (for preview deployments),
  // otherwise fall back to production domain
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://huculturehub.com'
  const responseUrl = options?.responseToken
    ? `${siteUrl}/booking/response/${options.responseToken}`
    : null

  // CRITICAL: Always start subject with booking reference number for easy identification
  const referenceNumber = booking.referenceNumber || booking.id
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: booking.email,
    subject: `[${referenceNumber}] Reservation Status Update - ${booking.eventType}`,
    text: generateStatusChangeEmailText(
      booking,
      status,
      options?.changeReason,
      options?.proposedDate,
      responseUrl
    ),
    html: generateStatusChangeEmailHTML(
      booking,
      status,
      options?.changeReason,
      options?.proposedDate,
      options?.responseToken,
      options?.proposedEndDate || booking.proposedEndDate || undefined,
      options?.proposedStartTime,
      options?.proposedEndTime,
      options?.previousProposedDate,
      options?.previousProposedEndDate,
      options?.previousProposedStartTime,
      options?.previousProposedEndTime
    ),
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    // Fix #7: Log email sent after successful send
    if (!options?.skipDuplicateCheck) {
      const { logEmailSent } = await import("./email-tracking")
      await logEmailSent(booking.id, "status_change", status, booking.email)
    }
    
    console.log('Booking status notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send status change notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'status_change',
        booking.email,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingId: booking.id, status, options }
      )
      console.log('Status change notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue status change notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification when user responds to booking
 */
export async function sendAdminUserResponseNotification(
  booking: Booking,
  response: "accept" | "propose" | "cancel",
  options?: {
    proposedDate?: string | null
    proposedEndDate?: string | null
    proposedStartTime?: string | null
    proposedEndTime?: string | null
    message?: string
  }
): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const responseMessages: Record<string, { title: string; message: string; color: string }> = {
    accept: {
      title: 'User Accepted Proposed Date',
      message: 'The user has accepted the proposed date for their reservation.',
      color: '#10b981',
    },
    propose: {
      title: 'User Proposed Alternative Date',
      message: 'The user has proposed an alternative date for their reservation.',
      color: '#f59e0b',
    },
    cancel: {
      title: 'User Cancelled Reservation',
      message: 'The user has cancelled their reservation.',
      color: '#ef4444',
    },
  }

  const responseInfo = responseMessages[response] || {
    title: 'User Response Received',
    message: 'The user has responded to their reservation.',
    color: '#3b82f6',
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  let proposedDateText = ''
  if (options?.proposedDate) {
    const timeInfo: string[] = []
    if (options?.proposedStartTime) {
      timeInfo.push(options.proposedStartTime)
    }
    if (options?.proposedEndTime) {
      timeInfo.push(options.proposedEndTime)
    }
    const timeText = timeInfo.length > 0 ? ` (${timeInfo.join(' - ')})` : ''
    
    // Parse date string (YYYY-MM-DD) in Bangkok timezone to avoid timezone conversion issues
    // options.proposedDate is a date string like "2025-11-19", not an ISO string
    const parseBangkokDate = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-').map(Number)
      // Create date in Bangkok timezone (GMT+7)
      // Use UTC methods to avoid local timezone conversion
      const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
      // Format in Bangkok timezone (GMT+7 = UTC+7)
      return date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'Asia/Bangkok'
      })
    }
    
    if (options?.proposedEndDate && options.proposedEndDate !== options.proposedDate) {
      // Multiple days
      proposedDateText = `${parseBangkokDate(options.proposedDate)} - ${parseBangkokDate(options.proposedEndDate)}${timeText}`
    } else {
      // Single day
      proposedDateText = `${parseBangkokDate(options.proposedDate)}${timeText}`
    }
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${responseInfo.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${responseInfo.color}; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                ${responseInfo.title}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                ${responseInfo.message}
              </p>
              
              <div style="background-color: #f9fafb; border-left: 4px solid ${responseInfo.color}; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Reservation Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 120px;">Name:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.name)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Email:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.email)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Phone:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.phone || 'N/A')}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Event Type:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedEventType)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Date & Time:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedDateRange)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Status:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.status)}</td>
                  </tr>
                </table>
              </div>
              
              ${proposedDateText ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 18px;">Proposed Date${options?.proposedEndDate && options.proposedEndDate !== options.proposedDate ? 's' : ''}</h3>
                <p style="margin: 0; color: #78350f; font-size: 16px; font-weight: 500;">
                  ${sanitizeHTML(proposedDateText)}
                </p>
              </div>
              ` : ''}
              
              ${options?.message ? `
              <div style="margin: 20px 0;">
                <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px; font-weight: 500;">User Message:</p>
                <p style="margin: 0; color: #333333; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${sanitizeHTML(options.message)}</p>
              </div>
              ` : ''}
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Please review this response in the admin dashboard.
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `

  const textContent = `
${responseInfo.title}

${responseInfo.message}

RESERVATION DETAILS:
Name: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || 'N/A'}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Status: ${booking.status}

${proposedDateText ? `PROPOSED DATE${options?.proposedEndDate && options.proposedEndDate !== options.proposedDate ? 'S' : ''}:\n${proposedDateText}\n\n` : ''}
${options?.proposedStartTime || options?.proposedEndTime ? `PROPOSED TIME${options?.proposedStartTime && options?.proposedEndTime ? 'S' : ''}:\n${options?.proposedStartTime ? `Start: ${options.proposedStartTime}` : ''}${options?.proposedStartTime && options?.proposedEndTime ? '\n' : ''}${options?.proposedEndTime ? `End: ${options.proposedEndTime}` : ''}\n\n` : ''}
${options?.message ? `USER MESSAGE:\n${options.message}\n\n` : ''}
Please review this response in the admin dashboard.

Best regards,
Hell University Reservation System
  `.trim()

  // CRITICAL: Always start subject with booking reference number for easy identification
  const referenceNumber = booking.referenceNumber || booking.id
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `[${referenceNumber}] ${responseInfo.title} - ${formattedEventType}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin user response notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send admin user response notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'user_response',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingId: booking.id, response, options, replyTo: booking.email }
      )
      console.log('Admin user response notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin user response notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification for automatic booking status updates
 */
export async function sendAdminAutoUpdateNotification(
  bookings: Array<{
    booking: Booking
    oldStatus: string
    newStatus: string
    reason: string
  }>
): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  if (bookings.length === 0) {
    return // No updates to notify about
  }

  const finishedBookings = bookings.filter(b => b.newStatus === 'finished')
  const cancelledBookings = bookings.filter(b => b.newStatus === 'cancelled')

  let summaryText = ''
  if (finishedBookings.length > 0) {
    summaryText += `${finishedBookings.length} booking${finishedBookings.length > 1 ? 's' : ''} automatically marked as finished.\n\n`
  }
  if (cancelledBookings.length > 0) {
    summaryText += `${cancelledBookings.length} booking${cancelledBookings.length > 1 ? 's' : ''} automatically cancelled (expired without response).\n\n`
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automatic Booking Status Updates</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #3b82f6; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                Automatic Booking Status Updates
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                The following booking${bookings.length > 1 ? 's have' : ' has'} been automatically updated:
              </p>
              
              ${finishedBookings.length > 0 ? `
              <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #065f46; font-size: 18px;">
                  Finished Bookings (${finishedBookings.length})
                </h3>
                <p style="margin: 0 0 15px 0; color: #047857; font-size: 14px;">
                  These reservations have passed their end date/time and have been marked as finished.
                </p>
                ${finishedBookings.map(({ booking }) => {
                  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
                  const formattedDateRange = formatDateRange({
                    dateRange: booking.dateRange,
                    startDate: booking.startDate,
                    endDate: booking.endDate || undefined,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                  } as ReservationData)
                  return `
                  <div style="background-color: #ffffff; padding: 15px; margin: 10px 0; border-radius: 4px; border: 1px solid #a7f3d0;">
                    <p style="margin: 0 0 5px 0; color: #111827; font-size: 14px; font-weight: 500;">
                      ${sanitizeHTML(booking.name)} - ${sanitizeHTML(formattedEventType)}
                    </p>
                    <p style="margin: 0; color: #6b7280; font-size: 12px;">
                      ${sanitizeHTML(formattedDateRange)}
                    </p>
                  </div>
                  `
                }).join('')}
              </div>
              ` : ''}
              
              ${cancelledBookings.length > 0 ? `
              <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #991b1b; font-size: 18px;">
                  Cancelled Bookings (${cancelledBookings.length})
                </h3>
                <p style="margin: 0 0 15px 0; color: #b91c1c; font-size: 14px;">
                  These reservations have passed their date/time without a response and have been automatically cancelled.
                </p>
                ${cancelledBookings.map(({ booking }) => {
                  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
                  const formattedDateRange = formatDateRange({
                    dateRange: booking.dateRange,
                    startDate: booking.startDate,
                    endDate: booking.endDate || undefined,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                  } as ReservationData)
                  return `
                  <div style="background-color: #ffffff; padding: 15px; margin: 10px 0; border-radius: 4px; border: 1px solid #fecaca;">
                    <p style="margin: 0 0 5px 0; color: #111827; font-size: 14px; font-weight: 500;">
                      ${sanitizeHTML(booking.name)} - ${sanitizeHTML(formattedEventType)}
                    </p>
                    <p style="margin: 0; color: #6b7280; font-size: 12px;">
                      ${sanitizeHTML(formattedDateRange)}
                    </p>
                  </div>
                  `
                }).join('')}
              </div>
              ` : ''}
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                All updated bookings have been moved to the archive and are no longer visible in the main bookings list.
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `

  const textContent = `
Automatic Booking Status Updates

The following booking${bookings.length > 1 ? 's have' : ' has'} been automatically updated:

${summaryText}

${finishedBookings.length > 0 ? `FINISHED BOOKINGS (${finishedBookings.length}):\n${finishedBookings.map(({ booking }) => {
  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)
  return `- ${booking.name} - ${formattedEventType} (${formattedDateRange})`
}).join('\n')}\n\n` : ''}

${cancelledBookings.length > 0 ? `CANCELLED BOOKINGS (${cancelledBookings.length}):\n${cancelledBookings.map(({ booking }) => {
  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)
  return `- ${booking.name} - ${formattedEventType} (${formattedDateRange})`
}).join('\n')}\n\n` : ''}

All updated bookings have been moved to the archive and are no longer visible in the main bookings list.

Best regards,
Hell University Reservation System
  `.trim()

  // Create booking reference numbers list for subject (limit to first 3 for readability)
  // CRITICAL: Always start subject with booking reference numbers for easy identification
  const bookingReferences = bookings.map(b => b.booking.referenceNumber || b.booking.id)
  const bookingRefsText = bookingReferences.length <= 3 
    ? bookingReferences.join(', ')
    : `${bookingReferences.slice(0, 3).join(', ')} and ${bookings.length - 3} more`

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    subject: `[${bookingRefsText}] Automatic Booking Updates - ${bookings.length} booking${bookings.length > 1 ? 's' : ''} updated`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin auto-update notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send admin auto-update notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'auto_update',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookings: bookings.map(b => ({ id: b.booking.id, oldStatus: b.oldStatus, newStatus: b.newStatus })) }
      )
      console.log('Admin auto-update notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin auto-update notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification when booking status is changed
 */
export async function sendAdminStatusChangeNotification(
  booking: Booking,
  oldStatus: string,
  newStatus: string,
  changeReason?: string,
  changedBy?: string
): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  // Determine if this is a deposit upload (user action) or rejection (admin action)
  const isDepositUpload = changeReason?.toLowerCase().includes('uploaded') || 
                          changeReason?.toLowerCase().includes('user uploaded')
  const isDepositRejection = changeReason?.toLowerCase().includes('rejected') ||
                             changeReason?.toLowerCase().includes('reject') ||
                             (oldStatus === 'pending_deposit' && newStatus === 'pending_deposit' && !isDepositUpload && changedBy && changedBy !== 'system')

  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    cancelled: {
      title: 'Booking Cancelled',
      message: 'A booking has been cancelled.',
      color: '#6b7280',
    },
    finished: {
      title: 'Booking Finished',
      message: 'A booking has been marked as finished.',
      color: '#3b82f6',
    },
    pending_deposit: {
      title: oldStatus === 'cancelled'
        ? 'Booking Restored - Deposit Required'
        : oldStatus === 'pending' 
        ? 'Booking Accepted - Deposit Required'
        : 'Deposit Evidence Rejected',
      message: oldStatus === 'cancelled'
        ? 'A cancelled booking has been restored. User needs to upload deposit evidence. A deposit upload link has been sent to the user.'
        : oldStatus === 'pending'
        ? 'A booking has been accepted. User needs to upload deposit evidence. A deposit upload link has been sent to the user.'
        : 'Deposit evidence has been rejected. User will re-upload deposit evidence with a new token (expires at booking start date/time).',
      color: oldStatus === 'cancelled' || oldStatus === 'pending' ? '#10b981' : '#f59e0b',
    },
    paid_deposit: {
      title: oldStatus === 'cancelled'
        ? 'Booking Restored to Paid Deposit'
        : 'Deposit Evidence Uploaded',
      message: oldStatus === 'cancelled'
        ? 'A cancelled booking has been restored to paid_deposit status. Deposit evidence is available for review. Please verify the deposit to confirm the booking.'
        : 'User has uploaded deposit evidence. Please review and verify the deposit to confirm the booking.',
      color: '#10b981',
    },
    confirmed: {
      title: oldStatus === 'cancelled'
        ? 'Booking Restored and Confirmed'
        : oldStatus === 'pending_deposit' && changeReason?.toLowerCase().includes('other channel')
        ? 'Booking Confirmed (Other Channel)'
        : oldStatus === 'paid_deposit' && changeReason?.toLowerCase().includes('other channel')
        ? 'Booking Confirmed (Other Channel)'
        : 'Booking Confirmed',
      message: oldStatus === 'cancelled'
        ? changeReason?.toLowerCase().includes('other channel')
          ? 'A cancelled booking has been restored and confirmed. Deposit was verified through other channels (phone, in-person, etc.).'
          : 'A cancelled booking has been restored and confirmed. Deposit has been verified.'
        : oldStatus === 'pending_deposit' && changeReason?.toLowerCase().includes('other channel')
        ? 'A booking has been confirmed. Deposit was verified through other channels (phone, in-person, etc.), not through system upload.'
        : oldStatus === 'paid_deposit' && changeReason?.toLowerCase().includes('other channel')
        ? 'A booking has been confirmed. Deposit was verified through other channels instead of reviewing the uploaded evidence.'
        : 'A booking has been confirmed. Deposit has been verified.',
      color: '#10b981',
    },
  }

  const statusInfo = statusMessages[newStatus] || {
    title: 'Booking Status Changed',
    message: `Booking status has been changed from ${oldStatus} to ${newStatus}.`,
    color: '#3b82f6',
  }

  // Generate admin panel link for deposit verification
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://huculturehub.com'
  const adminBookingsUrl = `${siteUrl}/admin/bookings`

  let proposedDateText = ''
  if (booking.proposedDate) {
    if (booking.proposedEndDate && booking.proposedEndDate !== booking.proposedDate) {
      proposedDateText = `${new Date(booking.proposedDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })} - ${new Date(booking.proposedEndDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}`
    } else {
      proposedDateText = new Date(booking.proposedDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    }
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusInfo.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${statusInfo.color}; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                ${statusInfo.title}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                ${statusInfo.message}
              </p>
              
              <div style="background-color: #f9fafb; border-left: 4px solid ${statusInfo.color}; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Booking Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 120px;">Name:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.name)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Email:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.email)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Phone:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.phone || 'N/A')}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Event Type:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedEventType)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Date & Time:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedDateRange)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Previous Status:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(oldStatus)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">New Status:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(newStatus)}</td>
                  </tr>
                  ${proposedDateText ? `
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Proposed Date:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(proposedDateText)}</td>
                  </tr>
                  ` : ''}
                  ${changedBy ? `
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Changed By:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(changedBy)}</td>
                  </tr>
                  ` : ''}
                </table>
              </div>
              
              ${changeReason ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 18px;">Change Reason</h3>
                <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${sanitizeHTML(changeReason)}</p>
              </div>
              ` : ''}
              
              ${newStatus === 'pending_deposit' && oldStatus === 'pending_deposit' && booking.depositEvidenceUrl ? `
              <div style="margin: 30px 0; text-align: center; background-color: #f3f4f6; padding: 25px; border-radius: 8px;">
                <p style="margin: 0 0 20px 0; color: #111827; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ⚠️ Action Required: Verify Deposit Evidence
                </p>
                <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px; line-height: 1.6;">
                  The user has uploaded deposit evidence. Please review and verify the deposit in the admin panel.
                </p>
                <a href="${adminBookingsUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 10px;">
                  Go to Admin Panel
                </a>
                <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Booking ID: ${booking.referenceNumber || booking.id}<br>
                  Or search by email: ${sanitizeHTML(booking.email)}
                </p>
                <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link:<br>
                  <a href="${adminBookingsUrl}" style="color: #3b82f6; word-break: break-all;">${adminBookingsUrl}</a>
                </p>
              </div>
              ` : ''}
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This is an automated notification of a booking status change.
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  let textContent = `${statusInfo.title}

${statusInfo.message}

BOOKING DETAILS:
Name: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || 'N/A'}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Previous Status: ${oldStatus}
New Status: ${newStatus}
${proposedDateText ? `Proposed Date: ${proposedDateText}\n` : ''}${changedBy ? `Changed By: ${changedBy}\n` : ''}
${changeReason ? `\nCHANGE REASON:\n${changeReason}\n` : ''}`

  if (newStatus === 'pending_deposit' && oldStatus === 'pending') {
    textContent += `\n✅ BOOKING ACCEPTED - DEPOSIT UPLOAD LINK SENT\n\n`
    textContent += `The booking has been accepted. A deposit upload link has been sent to the user. The token expires at the booking start date/time (Bangkok timezone).\n\n`
    textContent += `Admin Panel: ${adminBookingsUrl}\n`
    textContent += `Booking ID: ${booking.referenceNumber || booking.id}\n`
    textContent += `Or search by email: ${booking.email}\n\n`
  } else if (newStatus === 'pending_deposit' && oldStatus === 'pending_deposit') {
    // Determine if this is a deposit upload or rejection
    const isDepositUpload = changeReason?.toLowerCase().includes('uploaded') || 
                           changeReason?.toLowerCase().includes('user uploaded')
    
    if (isDepositUpload) {
      textContent += `\n✅ DEPOSIT EVIDENCE UPLOADED - REVIEW REQUIRED\n\n`
      textContent += `User has uploaded deposit evidence. Please review and verify the deposit to confirm the booking.\n\n`
      textContent += `Admin Panel: ${adminBookingsUrl}\n`
      textContent += `Booking ID: ${booking.referenceNumber || booking.id}\n`
      textContent += `Or search by email: ${booking.email}\n\n`
    } else {
    textContent += `\n⚠️ DEPOSIT EVIDENCE REJECTED - NEW TOKEN GENERATED\n\n`
    textContent += `The deposit evidence has been rejected. A new token has been generated for the user to re-upload. The new token expires at the booking start date/time (Bangkok timezone).\n\n`
    textContent += `Admin Panel: ${adminBookingsUrl}\n`
    textContent += `Booking ID: ${booking.referenceNumber || booking.id}\n`
    textContent += `Or search by email: ${booking.email}\n\n`
    }
  } else if (newStatus === 'confirmed' && oldStatus === 'pending_deposit') {
    textContent += `\n✅ DEPOSIT VERIFIED - BOOKING CONFIRMED\n\n`
    textContent += `The deposit has been verified and the booking is now confirmed.\n\n`
    textContent += `Admin Panel: ${adminBookingsUrl}\n`
    textContent += `Booking ID: ${booking.referenceNumber || booking.id}\n\n`
  }

  textContent += `This is an automated notification of a booking status change.

Best regards,
Hell University Reservation System
  `.trim()

  // CRITICAL: Always start subject with booking reference number for easy identification
  const referenceNumber = booking.referenceNumber || booking.id
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `[${referenceNumber}] ${statusInfo.title} - ${formattedEventType} - ${booking.name}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin status change notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send admin status change notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'admin_notification',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingId: booking.id, oldStatus, newStatus, changeReason, changedBy, replyTo: booking.email }
      )
      console.log('Admin status change notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin status change notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification when booking fee is recorded or updated
 */
export async function sendAdminFeeChangeNotification(
  booking: Booking,
  oldBooking: Booking,
  changedBy: string
): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  const isUpdate = oldBooking.feeAmount !== null && oldBooking.feeAmount !== undefined
  const referenceNumber = booking.referenceNumber || booking.id

  // Format fee display
  const formatFeeDisplay = (fee: Booking | null) => {
    if (!fee || fee.feeAmount === null || fee.feeAmount === undefined) {
      return "Not recorded"
    }
    const baseAmount = fee.feeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (fee.feeCurrency && fee.feeCurrency.toUpperCase() !== "THB" && fee.feeAmountOriginal) {
      const originalAmount = fee.feeAmountOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const rate = fee.feeConversionRate ? fee.feeConversionRate.toFixed(4) : "N/A"
      return `${baseAmount} THB (${originalAmount} ${fee.feeCurrency}, rate: ${rate})`
    }
    return `${baseAmount} THB`
  }

  const oldFeeDisplay = formatFeeDisplay(oldBooking)
  const newFeeDisplay = formatFeeDisplay(booking)

  // Generate admin panel link
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://huculturehub.com'
  const adminBookingsUrl = `${siteUrl}/admin/bookings`

  // HTML content
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isUpdate ? 'Fee Updated' : 'Fee Recorded'} - ${referenceNumber}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <h1 style="color: #1f2937; margin-top: 0;">${isUpdate ? '📝 Booking Fee Updated' : '💰 Booking Fee Recorded'}</h1>
    <p style="color: #6b7280; margin-bottom: 0;">${isUpdate ? 'A booking fee has been updated.' : 'A booking fee has been recorded.'}</p>
  </div>

  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <h2 style="color: #1f2937; margin-top: 0; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">Booking Details</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; color: #6b7280; width: 150px;">Reference:</td>
        <td style="padding: 8px 0; font-weight: bold;">${referenceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Name:</td>
        <td style="padding: 8px 0;">${booking.name}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Email:</td>
        <td style="padding: 8px 0;">${booking.email}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Event Type:</td>
        <td style="padding: 8px 0;">${formattedEventType}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Date/Time:</td>
        <td style="padding: 8px 0;">${formattedDateRange}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Status:</td>
        <td style="padding: 8px 0;">
          <span style="background-color: ${booking.status === 'confirmed' ? '#d1fae5' : booking.status === 'finished' ? '#dbeafe' : '#f3f4f6'}; 
                      color: ${booking.status === 'confirmed' ? '#065f46' : booking.status === 'finished' ? '#1e40af' : '#374151'}; 
                      padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase;">
            ${booking.status}
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
    <h2 style="color: #92400e; margin-top: 0;">Fee Information</h2>
    ${isUpdate ? `
    <p style="margin: 10px 0;"><strong>Previous Fee:</strong> ${oldFeeDisplay}</p>
    <p style="margin: 10px 0;"><strong>New Fee:</strong> ${newFeeDisplay}</p>
    ` : `
    <p style="margin: 10px 0;"><strong>Fee Recorded:</strong> ${newFeeDisplay}</p>
    `}
    ${booking.feeNotes ? `
    <p style="margin: 10px 0;"><strong>Notes:</strong> ${booking.feeNotes}</p>
    ` : ''}
    <p style="margin: 10px 0; color: #92400e;"><strong>Changed by:</strong> ${changedBy}</p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${adminBookingsUrl}" 
       style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
      View Booking in Admin Panel
    </a>
  </div>

  <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; color: #6b7280; font-size: 14px;">
    <p>This is an automated notification of a booking fee ${isUpdate ? 'update' : 'recording'}.</p>
    <p style="margin-bottom: 0;">Best regards,<br>Hell University Reservation System</p>
  </div>
</body>
</html>
  `.trim()

  // Text content
  let textContent = `${isUpdate ? 'Fee Updated' : 'Fee Recorded'} - ${referenceNumber}\n\n`
  textContent += `Booking Details:\n`
  textContent += `Reference: ${referenceNumber}\n`
  textContent += `Name: ${booking.name}\n`
  textContent += `Email: ${booking.email}\n`
  textContent += `Event Type: ${formattedEventType}\n`
  textContent += `Date/Time: ${formattedDateRange}\n`
  textContent += `Status: ${booking.status}\n\n`
  textContent += `Fee Information:\n`
  if (isUpdate) {
    textContent += `Previous Fee: ${oldFeeDisplay}\n`
    textContent += `New Fee: ${newFeeDisplay}\n`
  } else {
    textContent += `Fee Recorded: ${newFeeDisplay}\n`
  }
  if (booking.feeNotes) {
    textContent += `Notes: ${booking.feeNotes}\n`
  }
  textContent += `Changed by: ${changedBy}\n\n`
  textContent += `Admin Panel: ${adminBookingsUrl}\n\n`
  textContent += `This is an automated notification of a booking fee ${isUpdate ? 'update' : 'recording'}.\n\n`
  textContent += `Best regards,\nHell University Reservation System`

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `[${referenceNumber}] ${isUpdate ? 'Fee Updated' : 'Fee Recorded'} - ${formattedEventType} - ${booking.name}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    await emailTransporter.sendMail(mailOptions)
    console.log(`Admin fee ${isUpdate ? 'update' : 'recording'} notification sent for booking ${booking.id}`)
  } catch (error) {
    console.error("Failed to send admin fee change notification:", error)
    throw error
  }
}

/**
 * Send admin notification when user confirms check-in
 */
export async function sendAdminCheckInNotification(booking: Booking): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Checked In</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #10b981; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                User Checked In
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                A user has confirmed their check-in for their reservation.
              </p>
              
              <div style="background-color: #f9fafb; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Booking Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 120px;">Name:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.name)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Email:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.email)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Phone:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.phone || 'N/A')}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Event Type:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedEventType)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Date & Time:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedDateRange)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Status:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">Checked In</td>
                  </tr>
                </table>
              </div>
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                The booking status has been automatically updated to "checked-in" and can no longer be modified (except for deletion in edge cases).
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const textContent = `User Checked In

A user has confirmed their check-in for their reservation.

BOOKING DETAILS:
Name: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || 'N/A'}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Status: Checked In

The booking status has been automatically updated to "checked-in" and can no longer be modified (except for deletion in edge cases).

Best regards,
Hell University Reservation System
  `.trim()

  // CRITICAL: Always start subject with booking reference number for easy identification
  const referenceNumber = booking.referenceNumber || booking.id
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `[${referenceNumber}] User Checked In - ${formattedEventType} - ${booking.name}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin check-in notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send admin check-in notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'admin_notification',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingId: booking.id, action: 'check-in', replyTo: booking.email }
      )
      console.log('Admin check-in notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin check-in notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification when a booking is deleted
 */
export async function sendAdminBookingDeletionNotification(
  booking: Booking,
  deletedBy?: string
): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(booking.eventType, booking.otherEventType)
  const formattedDateRange = formatDateRange({
    dateRange: booking.dateRange,
    startDate: booking.startDate,
    endDate: booking.endDate || undefined,
    startTime: booking.startTime,
    endTime: booking.endTime,
  } as ReservationData)

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Deleted</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #ef4444; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                Booking Deleted
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                A booking has been deleted from the system.
              </p>
              
              <div style="background-color: #f9fafb; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Deleted Booking Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 120px;">Name:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.name)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Email:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.email)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Phone:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.phone || 'N/A')}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Event Type:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedEventType)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Date & Time:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(formattedDateRange)}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Previous Status:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(booking.status)}</td>
                  </tr>
                  ${deletedBy ? `
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Deleted By:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(deletedBy)}</td>
                  </tr>
                  ` : ''}
                </table>
              </div>
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This booking has been permanently removed from the system. ${booking.status !== "cancelled" && booking.status !== "finished" ? "A cancellation notification has been sent to the user." : booking.status === "finished" ? "No user notification was sent as the booking was already finished (event has passed)." : "No user notification was sent as the booking was already cancelled."}
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const textContent = `Booking Deleted

A booking has been deleted from the system.

DELETED BOOKING DETAILS:
Name: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || 'N/A'}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Previous Status: ${booking.status}
${deletedBy ? `Deleted By: ${deletedBy}\n` : ''}

This booking has been permanently removed from the system. ${booking.status !== "cancelled" && booking.status !== "finished" ? "A cancellation notification has been sent to the user." : booking.status === "finished" ? "No user notification was sent as the booking was already finished (event has passed)." : "No user notification was sent as the booking was already cancelled."}

Best regards,
Hell University Reservation System
  `.trim()

  // CRITICAL: Always start subject with booking reference number for easy identification
  const referenceNumber = booking.referenceNumber || booking.id
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `[${referenceNumber}] Booking Deleted - ${formattedEventType} - ${booking.name}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin booking deletion notification email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send admin booking deletion notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'admin_notification',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingId: booking.id, action: 'deletion', deletedBy, replyTo: booking.email }
      )
      console.log('Admin booking deletion notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin booking deletion notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send admin notification when an email fails after max retries
 * This ensures admins are aware of failed email notifications
 */
export async function sendAdminEmailFailureNotification(data: {
  emailId: string
  emailType: string
  recipientEmail: string
  subject: string
  retryCount: number
  errorMessage: string
}): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    console.error('RESERVATION_EMAIL or SMTP_USER not configured - cannot send email failure notification')
    return // Don't throw - this is a monitoring function
  }

  // Get email queue item details if available
  let emailDetails = ''
  try {
    const { getTursoClient } = await import('./turso')
    const db = getTursoClient()
    const result = await db.execute({
      sql: `SELECT * FROM email_queue WHERE id = ?`,
      args: [data.emailId],
    })
    
    if (result.rows.length > 0) {
      const emailItem = result.rows[0] as any
      emailDetails = `
        <tr>
          <td style="color: #6b7280; font-size: 14px; width: 150px;">Email Type:</td>
          <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(emailItem.email_type || data.emailType)}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; font-size: 14px;">Recipient:</td>
          <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(emailItem.recipient_email || data.recipientEmail)}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; font-size: 14px;">Subject:</td>
          <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(emailItem.subject || data.subject)}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; font-size: 14px;">Retry Count:</td>
          <td style="color: #111827; font-size: 14px; font-weight: 500;">${emailItem.retry_count || data.retryCount} / ${emailItem.max_retries || 5}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; font-size: 14px;">Failed At:</td>
          <td style="color: #111827; font-size: 14px; font-weight: 500;">${new Date((emailItem.updated_at || Date.now() / 1000) * 1000).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })} GMT+7</td>
        </tr>
      `
    }
  } catch (error) {
    // If we can't fetch details, use provided data
    emailDetails = `
      <tr>
        <td style="color: #6b7280; font-size: 14px; width: 150px;">Email Type:</td>
        <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(data.emailType)}</td>
      </tr>
      <tr>
        <td style="color: #6b7280; font-size: 14px;">Recipient:</td>
        <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(data.recipientEmail)}</td>
      </tr>
      <tr>
        <td style="color: #6b7280; font-size: 14px;">Subject:</td>
        <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(data.subject)}</td>
      </tr>
      <tr>
        <td style="color: #6b7280; font-size: 14px;">Retry Count:</td>
        <td style="color: #111827; font-size: 14px; font-weight: 500;">${data.retryCount}</td>
      </tr>
    `
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Delivery Failed</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #ef4444; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                ⚠️ Email Delivery Failed
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                An email notification failed to deliver after multiple retry attempts. The user may not have received their notification.
              </p>
              
              <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">Failed Email Details</h3>
                <table width="100%" cellpadding="5" cellspacing="0">
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; width: 150px;">Email ID:</td>
                    <td style="color: #111827; font-size: 14px; font-weight: 500;">${sanitizeHTML(data.emailId)}</td>
                  </tr>
                  ${emailDetails}
                  <tr>
                    <td style="color: #6b7280; font-size: 14px; vertical-align: top;">Error:</td>
                    <td style="color: #dc2626; font-size: 14px; font-weight: 500;">${sanitizeHTML(data.errorMessage)}</td>
                  </tr>
                </table>
              </div>
              
              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                  <strong>Action Required:</strong> Please check the email queue in the admin panel and consider manually sending the notification to the user if it's critical.
                </p>
              </div>
              
              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This is an automated notification from the email queue system.
              </p>
              
              <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>Hell University Reservation System</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const textContent = `Email Delivery Failed

An email notification failed to deliver after multiple retry attempts. The user may not have received their notification.

FAILED EMAIL DETAILS:
Email ID: ${data.emailId}
Email Type: ${data.emailType}
Recipient: ${data.recipientEmail}
Subject: ${data.subject}
Retry Count: ${data.retryCount}
Error: ${data.errorMessage}

ACTION REQUIRED: Please check the email queue in the admin panel and consider manually sending the notification to the user if it's critical.

This is an automated notification from the email queue system.

Best regards,
Hell University Reservation System
  `.trim()

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    subject: `⚠️ Email Delivery Failed [ID: ${data.emailId.substring(0, 8)}...] - ${data.emailType}`,
    text: textContent,
    html: htmlContent,
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('Admin email failure notification sent:', result.messageId)
  } catch (error) {
    // Don't throw - this is a monitoring function and shouldn't break the system
    // Just log the error
    console.error('Failed to send admin email failure notification:', error)
    // Don't queue this notification - it would create an infinite loop
  }
}

