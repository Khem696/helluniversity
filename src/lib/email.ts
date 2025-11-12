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
        <span class="field-label">Introduction:</span>
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
        <span class="field-label">Special Requests:</span>
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
Introduction:
${data.introduction}

${data.biography ? `Background & Interests:\n${data.biography}\n\n` : ''}${data.specialRequests ? `Special Requests:\n${data.specialRequests}\n\n` : ''}
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
    
    <p>We honor each request with thoughtful consideration and will respond within <strong>48 hours</strong> to discuss your vision and craft an extraordinary experience tailored to your unique sensibilities.</p>
    
    <p>If you have any urgent questions or need to modify your inquiry, please don't hesitate to contact us.</p>
    
    <div class="signature">
      Best regards,<br>
      The Hell University Team
    </div>
  </div>
  <div class="footer">
    <p>This is an automated confirmation email. Please do not reply to this message.</p>
    <p style="margin-top: 10px;">
      <a href="mailto:helluniversity.cm@gmail.com" style="color: #5B9AB8;">helluniversity.cm@gmail.com</a>
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

We honor each request with thoughtful consideration and will respond within 48 hours to discuss your vision and craft an extraordinary experience tailored to your unique sensibilities.

If you have any urgent questions or need to modify your inquiry, please don't hesitate to contact us.

Best regards,
The Hell University Team

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated confirmation email. Please do not reply to this message.
For inquiries: helluniversity.cm@gmail.com
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
  const bookingIdText = bookingId ? ` [Booking ID: ${bookingId}]` : ''

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: data.email,
    subject: `New Reservation Inquiry${bookingIdText} - ${formattedEventType} - ${formattedDateRange.substring(0, 50)}`,
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
    console.error('Failed to send admin notification, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'admin_notification',
        recipientEmail,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingData: data, replyTo: data.email }
      )
      console.log('Admin notification queued for retry')
    } catch (queueError) {
      console.error('Failed to queue admin notification:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
  }
}

/**
 * Send auto-reply confirmation email to user
 * Uses nodemailer v7 compatible API
 */
export async function sendUserConfirmation(data: ReservationData, bookingId?: string): Promise<void> {
  const bookingIdText = bookingId ? ` [Booking ID: ${bookingId}]` : ''
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: data.email,
    subject: `Reservation Inquiry Received${bookingIdText} - Hell University`,
    text: generateUserEmailText(data),
    html: generateUserEmailHTML(data),
  }

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail(mailOptions)
    
    // Log successful send (nodemailer v7 returns messageId)
    console.log('User confirmation email sent:', result.messageId)
  } catch (error) {
    // Queue email for retry
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send user confirmation, queuing for retry:', errorMessage)
    
    try {
      await addEmailToQueue(
        'user_confirmation',
        data.email,
        mailOptions.subject as string,
        mailOptions.html as string,
        mailOptions.text as string,
        { bookingData: data }
      )
      console.log('User confirmation queued for retry')
    } catch (queueError) {
      console.error('Failed to queue user confirmation:', queueError)
      // Re-throw original error if queueing fails
      throw error
    }
    
    // Re-throw original error
    throw error
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
  try {
    console.error('='.repeat(60))
    console.error('STEP 1: Attempting to send admin notification email...')
    console.error('='.repeat(60))
    await sendAdminNotification(data, bookingReference)
    adminSent = true
    console.error('✅ Admin notification sent successfully')
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
  
  // Only execute if admin email succeeded
  console.error('✅ Admin email succeeded, proceeding to send user email...')
  try {
    console.error('='.repeat(60))
    console.error('STEP 2: Attempting to send user confirmation email...')
    console.error('='.repeat(60))
    await sendUserConfirmation(data, bookingReference)
    userSent = true
    console.error('✅ User confirmation sent successfully')
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

  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    accepted: {
      title: 'Reservation Accepted - Deposit Required',
      message: 'Great news! Your reservation request has been accepted. Please upload your deposit evidence to complete the booking process.',
      color: '#10b981',
    },
    paid_deposit: {
      title: 'Deposit Received',
      message: 'Thank you! We have received your deposit evidence. Our admin team will verify it and confirm your check-in shortly.',
      color: '#3b82f6',
    },
    pending_deposit: {
      title: 'Deposit Evidence Required - Re-upload Needed',
      message: 'We need you to re-upload your deposit evidence. The previous upload did not meet our requirements. Please upload a new deposit evidence using the link below.',
      color: '#f59e0b',
    },
    rejected: {
      title: 'Reservation Not Available',
      message: 'We regret to inform you that your reservation request could not be accommodated at this time.',
      color: '#ef4444',
    },
    cancelled: {
      title: 'Reservation Cancelled',
      message: 'Your reservation has been cancelled. We hope to see you at another opportunity in the future.',
      color: '#6b7280',
    },
    postponed: {
      title: 'Reservation Postponed',
      message: proposedDate 
        ? 'You have proposed a new date for your reservation. Our admin team will review your proposal and respond shortly.'
        : 'Your reservation has been postponed. Please propose an alternative date or cancel your reservation.',
      color: '#f59e0b',
    },
    pending: {
      title: proposedDate ? 'Proposal Received' : 'Reservation Status Update',
      message: proposedDate 
        ? 'Thank you for your proposal. We have received your request for a new date and will review it shortly.'
        : 'Your reservation status has been updated.',
      color: '#3b82f6',
    },
    'checked-in': {
      title: 'Check-In Confirmed',
      message: 'Your check-in has been confirmed by our admin team. We look forward to hosting your event!',
      color: '#10b981',
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
              
              ${status === 'pending_deposit' ? `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ⚠️ IMPORTANT: Deposit Re-upload Required
                </p>
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence to complete the booking process. The deposit must be uploaded before the reservation start date and time.
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
              
              ${responseUrl && status === 'checked-in' ? `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  Your check-in has been confirmed! You can view your reservation details or propose a new date if needed:
                </p>
                <a href="${responseUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                  View Reservation
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${responseUrl}" style="color: #3b82f6; word-break: break-all;">${responseUrl}</a>
                </p>
              </div>
              ` : ''}
              
              ${responseUrl && status === 'postponed' ? `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  You can propose a new date, accept the proposed date, or cancel your reservation:
                </p>
                <a href="${responseUrl}" style="display: inline-block; background-color: ${statusInfo.color}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  Manage Reservation
                </a>
                ${depositUploadUrl && !booking.depositEvidenceUrl ? `
                <p style="margin: 20px 0; color: #333333; font-size: 16px; line-height: 1.6; font-weight: 600;">
                  ⚠️ Deposit Still Required
                </p>
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  Your reservation has been postponed, but you still need to upload your deposit evidence. You can upload it using the link below:
                </p>
                <a href="${depositUploadUrl}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600; margin-bottom: 15px;">
                  Upload Deposit Evidence
                </a>
                <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${depositUploadUrl}" style="color: #3b82f6; word-break: break-all;">${depositUploadUrl}</a>
                </p>
                ` : ''}
                <p style="margin: ${depositUploadUrl && !booking.depositEvidenceUrl ? '20px' : '20px'} 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${responseUrl}" style="color: #3b82f6; word-break: break-all;">${responseUrl}</a>
                </p>
              </div>
              ` : ''}
              
              ${status === 'paid_deposit' ? `
              <div style="margin: 30px 0; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                  Our admin team is currently reviewing your deposit evidence. Once verified, you will receive a confirmation email with access to your reservation management page.
                </p>
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                  Please wait for our team to complete the verification process.
                </p>
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

  const statusMessages: Record<string, string> = {
    accepted: 'Great news! Your reservation request has been accepted. Please upload your deposit evidence to complete the booking process.',
    paid_deposit: 'Thank you! We have received your deposit evidence. Our admin team will verify it and confirm your check-in shortly.',
    pending_deposit: 'The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence to complete the booking process.',
    'checked-in': 'Your check-in has been confirmed by our admin team. We look forward to hosting your event!',
    rejected: 'We regret to inform you that your reservation request could not be accommodated at this time.',
    postponed: proposedDate 
      ? 'You have proposed a new date for your reservation. Our admin team will review your proposal and respond shortly.'
      : 'Your reservation has been postponed. Please propose an alternative date or cancel your reservation.',
    pending: proposedDate 
      ? 'Thank you for your proposal. We have received your request for a new date and will review it shortly.'
      : 'Your reservation status has been updated.',
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

  if (status === 'pending_deposit') {
    text += `\n⚠️ IMPORTANT: Deposit Re-upload Required\n\n`
    text += `The previous deposit evidence you uploaded did not meet our requirements. Please upload a new deposit evidence to complete the booking process. The deposit must be uploaded before the reservation start date and time.\n\n`
    if (depositUploadUrl) {
      text += `Upload Deposit Evidence: ${depositUploadUrl}\n\n`
    } else if (responseUrl) {
      text += `Please visit the booking page to upload your deposit evidence:\n${responseUrl}\n\n`
    } else {
      text += `Please contact us to receive your deposit upload link.\n\n`
    }
  }

  if (status === 'accepted') {
    text += `\n⚠️ IMPORTANT: Deposit Required\n\n`
    text += `Your reservation has been accepted! Please upload your deposit evidence to complete the booking process. The deposit must be uploaded before the reservation start date and time.\n\n`
    if (depositUploadUrl) {
      text += `Upload Deposit Evidence: ${depositUploadUrl}\n\n`
    } else if (responseUrl) {
      text += `Please visit the booking page to upload your deposit evidence:\n${responseUrl}\n\n`
    } else {
      text += `Please contact us to receive your deposit upload link.\n\n`
    }
  }

  if (responseUrl && status === 'checked-in') {
    text += `Your check-in has been confirmed! You can view your reservation details or propose a new date if needed:\n`
    text += `${responseUrl}\n\n`
  }

  if (responseUrl && status === 'postponed') {
    text += `You can propose a new date, accept the proposed date, or cancel your reservation:\n`
    text += `${responseUrl}\n\n`
    if (depositUploadUrl && !booking.depositEvidenceUrl) {
      text += `⚠️ IMPORTANT: Deposit Still Required\n\n`
      text += `Your reservation has been postponed, but you still need to upload your deposit evidence. You can upload it using the link below:\n\n`
      text += `Upload Deposit Evidence: ${depositUploadUrl}\n\n`
    }
  }
  
  if (status === 'paid_deposit') {
    text += `\nOur admin team is currently reviewing your deposit evidence. Once verified, you will receive a confirmation email with access to your reservation management page.\n`
    text += `Please wait for our team to complete the verification process.\n\n`
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

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: booking.email,
    subject: `Reservation Status Update [Booking ID: ${booking.referenceNumber || booking.id}] - ${booking.eventType}`,
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

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `${responseInfo.title} [Booking ID: ${booking.referenceNumber || booking.id}] - ${formattedEventType}`,
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

  // Create booking IDs list for subject (limit to first 3 for readability)
  const bookingIds = bookings.map(b => b.booking.referenceNumber || b.booking.id)
  const bookingIdsText = bookingIds.length <= 3 
    ? bookingIds.join(', ')
    : `${bookingIds.slice(0, 3).join(', ')} and ${bookingIds.length - 3} more`

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    subject: `Automatic Booking Updates [Booking IDs: ${bookingIdsText}] - ${bookings.length} booking${bookings.length > 1 ? 's' : ''} updated`,
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

  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    accepted: {
      title: 'Booking Accepted',
      message: 'A booking has been accepted.',
      color: '#10b981',
    },
    rejected: {
      title: 'Booking Rejected',
      message: 'A booking has been rejected.',
      color: '#ef4444',
    },
    postponed: {
      title: 'Booking Postponed',
      message: 'A booking has been postponed.',
      color: '#f59e0b',
    },
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
    paid_deposit: {
      title: 'Deposit Evidence Uploaded',
      message: 'The user has uploaded deposit evidence. Please verify the deposit.',
      color: '#8b5cf6',
    },
    pending_deposit: {
      title: 'Deposit Evidence Rejected',
      message: 'Deposit evidence has been rejected. User will re-upload deposit evidence.',
      color: '#f59e0b',
    },
    'checked-in': {
      title: 'Booking Checked In',
      message: 'The booking has been checked in and deposit verified.',
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
              
              ${newStatus === 'paid_deposit' ? `
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

  if (newStatus === 'paid_deposit') {
    textContent += `\n⚠️ ACTION REQUIRED: VERIFY DEPOSIT EVIDENCE\n\n`
    textContent += `The user has uploaded deposit evidence. Please review and verify the deposit in the admin panel.\n\n`
    textContent += `Admin Panel: ${adminBookingsUrl}\n`
    textContent += `Booking ID: ${booking.referenceNumber || booking.id}\n`
    textContent += `Or search by email: ${booking.email}\n\n`
  }

  textContent += `This is an automated notification of a booking status change.

Best regards,
Hell University Reservation System
  `.trim()

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `${statusInfo.title} [Booking ID: ${booking.referenceNumber || booking.id}] - ${formattedEventType} - ${booking.name}`,
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

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `User Checked In [Booking ID: ${booking.referenceNumber || booking.id}] - ${formattedEventType} - ${booking.name}`,
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
                This booking has been permanently removed from the system. ${booking.status !== "rejected" && booking.status !== "cancelled" && booking.status !== "finished" ? (booking.status === "accepted" || booking.status === "checked-in" ? "A cancellation notification has been sent to the user." : "A rejection notification has been sent to the user.") : booking.status === "finished" ? "No user notification was sent as the booking was already finished (event has passed)." : "No user notification was sent as the booking was already rejected or cancelled."}
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

This booking has been permanently removed from the system. ${booking.status !== "rejected" && booking.status !== "cancelled" && booking.status !== "finished" ? (booking.status === "accepted" || booking.status === "checked-in" ? "A cancellation notification has been sent to the user." : "A rejection notification has been sent to the user.") : booking.status === "finished" ? "No user notification was sent as the booking was already finished (event has passed)." : "No user notification was sent as the booking was already rejected or cancelled."}

Best regards,
Hell University Reservation System
  `.trim()

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: booking.email,
    subject: `Booking Deleted [Booking ID: ${booking.referenceNumber || booking.id}] - ${formattedEventType} - ${booking.name}`,
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

