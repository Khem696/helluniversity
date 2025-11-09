import nodemailer from 'nodemailer'

interface EmailConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
}

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
  organizationType: "Tailor Event" | "Space Only" | ""
  introduction: string
  biography: string
  specialRequests: string
}

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (transporter) {
    return transporter
  }

  const config: EmailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
    },
  }

  // Validate required configuration
  if (!config.auth.user || !config.auth.pass) {
    throw new Error('SMTP credentials not configured. Please set SMTP_USER and SMTP_PASSWORD environment variables.')
  }

  transporter = nodemailer.createTransport(config)
  return transporter
}

// Escape HTML to prevent XSS and ensure proper display
function escapeHtml(text: string | null | undefined): string {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Format event type for display
function formatEventType(eventType: string, otherEventType?: string): string {
  if (eventType === "Other" && otherEventType) {
    return `Other: ${otherEventType}`
  }
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
  return eventTypes[eventType] || eventType
}

// Format date for display
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateString
  }
}

// Format date and time for display
function formatDateTime(dateString: string | null | undefined, timeString: string | null | undefined): string {
  try {
    if (!dateString) {
      console.warn('⚠️ formatDateTime: dateString is missing')
      return "Not specified"
    }
    
    if (!timeString) {
      console.warn('⚠️ formatDateTime: timeString is missing, formatting date only')
      // Format just the date if time is missing
      try {
        const date = new Date(dateString)
        if (isNaN(date.getTime())) {
          return dateString
        }
        return date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      } catch {
        return dateString
      }
    }
    
    const date = new Date(dateString)
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('⚠️ formatDateTime: Invalid date:', dateString)
      return `${dateString} at ${timeString}`
    }
    
    const [hours, minutes] = timeString.split(':')
    if (!hours || !minutes) {
      console.warn('⚠️ formatDateTime: Invalid time format:', timeString)
      return `${dateString} at ${timeString}`
    }
    
    date.setHours(parseInt(hours, 10), parseInt(minutes, 10))
    
    // Check if the formatted date is valid
    const formatted = date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    
    if (formatted.includes('Invalid')) {
      console.warn('⚠️ formatDateTime: Formatted date contains "Invalid"')
      return `${dateString} at ${timeString}`
    }
    
    return formatted
  } catch (error) {
    console.error('❌ formatDateTime error:', error)
    return dateString && timeString ? `${dateString} at ${timeString}` : "Not specified"
  }
}

// Format date range for display
function formatDateRange(data: ReservationData): string {
  if (!data.startDate) {
    console.warn('⚠️ formatDateRange: startDate is missing')
    return "Not specified"
  }
  
  console.log('📅 formatDateRange called with:')
  console.log('   - startDate:', data.startDate)
  console.log('   - startTime:', data.startTime)
  console.log('   - endDate:', data.endDate)
  console.log('   - endTime:', data.endTime)
  console.log('   - dateRange:', data.dateRange)
  
  const startDateTime = formatDateTime(data.startDate, data.startTime || null)
  console.log('   - formatted startDateTime:', startDateTime)
  
  if (!data.dateRange || !data.endDate) {
    // Single day - show start date/time to end time
    if (data.endTime) {
      const result = `${startDateTime} - ${data.endTime}`
      console.log('   - single day result:', result)
      return result
    } else {
      const result = startDateTime
      console.log('   - single day (no end time) result:', result)
      return result
    }
  } else {
    // Date range - show start date/time to end date/time
    const endDateTime = formatDateTime(data.endDate, data.endTime || null)
    console.log('   - formatted endDateTime:', endDateTime)
    const result = `${startDateTime} to ${endDateTime}`
    console.log('   - date range result:', result)
    return result
  }
}

// Generate HTML email template for admin notification
function generateAdminEmailHTML(data: ReservationData): string {
  // Log data being used for email generation
  console.log('📧 Generating admin email HTML with data:')
  console.log('   - startDate:', data.startDate)
  console.log('   - endDate:', data.endDate)
  console.log('   - startTime:', data.startTime)
  console.log('   - endTime:', data.endTime)
  console.log('   - dateRange:', data.dateRange)
  
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
  
  console.log('   - formattedDateRange:', formattedDateRange)
  console.log('   - formattedEventType:', formattedEventType)

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
        <span class="field-value">${escapeHtml(data.name)}</span>
      </div>
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value"><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Phone:</span>
        <span class="field-value"><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Number of Participants:</span>
        <span class="field-value">${data.participants ? escapeHtml(data.participants) : "Not specified"}</span>
      </div>
      <div class="field">
        <span class="field-label">Event Type:</span>
        <span class="field-value">${formattedEventType}</span>
      </div>
      <div class="field">
        <span class="field-label">Date & Time:</span>
        <span class="field-value">${formattedDateRange}</span>
      </div>
      <div class="field">
        <span class="field-label">Organization:</span>
        <span class="field-value">${data.organizationType || "Not specified"} (${organizationRemark})</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Guest Information</div>
      <div class="field">
        <span class="field-label">Introduction:</span>
        <div class="text-content">${escapeHtml(data.introduction || "").replace(/\n/g, '<br>')}</div>
      </div>
      ${data.biography ? `
      <div class="field">
        <span class="field-label">Background & Interests:</span>
        <div class="text-content">${escapeHtml(data.biography).replace(/\n/g, '<br>')}</div>
      </div>
      ` : ''}
      ${data.specialRequests ? `
      <div class="field">
        <span class="field-label">Special Requests:</span>
        <div class="text-content">${escapeHtml(data.specialRequests).replace(/\n/g, '<br>')}</div>
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
  const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")

  return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

BOOKING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Number of Participants: ${data.participants || "Not specified"}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Organization: ${data.organizationType || "Not specified"} (${organizationRemark})

GUEST INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Introduction:
${data.introduction || "Not provided"}

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
  // Log data being used for email generation
  console.log('📧 Generating user email HTML with data:')
  console.log('   - startDate:', data.startDate)
  console.log('   - endDate:', data.endDate)
  console.log('   - startTime:', data.startTime)
  console.log('   - endTime:', data.endTime)
  console.log('   - dateRange:', data.dateRange)
  
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
  
  console.log('   - formattedDateRange:', formattedDateRange)
  console.log('   - formattedEventType:', formattedEventType)

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
      border-left: 3px solid #5B9AB8;
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
    <p>Dear ${escapeHtml(data.name)},</p>
    
    <p>Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.</p>
    
    <div class="summary">
      <h3 style="margin-top: 0; color: #5a3a2a;">Your Inquiry Summary:</h3>
      <div class="summary-item">
        <span class="summary-label">Event Type:</span> ${formattedEventType}
      </div>
      <div class="summary-item">
        <span class="summary-label">Date & Time:</span> ${formattedDateRange}
      </div>
      <div class="summary-item">
        <span class="summary-label">Number of Participants:</span> ${data.participants || "Not specified"}
      </div>
      <div class="summary-item">
        <span class="summary-label">Organization:</span> ${data.organizationType || "Not specified"} (${organizationRemark})
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
  const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")

  return `
RESERVATION INQUIRY RECEIVED - HELL UNIVERSITY

Dear ${data.name},

Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.

YOUR INQUIRY SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Number of Participants: ${data.participants || "Not specified"}
Organization: ${data.organizationType || "Not specified"} (${organizationRemark})

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
 */
export async function sendAdminNotification(data: ReservationData): Promise<void> {
  // STRICT: Require RESERVATION_EMAIL to be explicitly set
  const reservationEmail = process.env.RESERVATION_EMAIL
  const smtpUser = process.env.SMTP_USER
  
  console.log('='.repeat(60))
  console.log('ADMIN EMAIL CONFIGURATION CHECK:')
  console.log('='.repeat(60))
  console.log('RESERVATION_EMAIL:', reservationEmail ? `✅ SET (${reservationEmail})` : '❌ NOT SET')
  console.log('SMTP_USER (fallback):', smtpUser ? `SET (${smtpUser})` : 'NOT SET')
  console.log('='.repeat(60))
  
  // Use RESERVATION_EMAIL if set, otherwise fall back to SMTP_USER
  const recipientEmail = reservationEmail || smtpUser

  if (!recipientEmail) {
    const errorMsg = 'RESERVATION_EMAIL or SMTP_USER must be configured. RESERVATION_EMAIL is preferred.'
    console.error('❌ CONFIGURATION ERROR:', errorMsg)
    throw new Error(errorMsg)
  }
  
  // Warn if using fallback
  if (!reservationEmail && smtpUser) {
    console.warn('⚠️ WARNING: RESERVATION_EMAIL not set, using SMTP_USER as fallback:', smtpUser)
    console.warn('⚠️ This means admin notifications will go to the SMTP sender email, not a dedicated admin email!')
  }

  // Log the recipient email for debugging
  console.log('📧 Sending admin notification to:', recipientEmail)
  console.log('📧 User email (from form):', data.email)
  
  // Warn if admin email is the same as user email (might be intentional, but worth noting)
  if (recipientEmail.toLowerCase() === data.email.toLowerCase()) {
    console.warn('⚠️ WARNING: Admin email recipient is the same as user email. This might be intentional.')
  }
  
  // Verify the email address format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(recipientEmail)) {
    const errorMsg = `Invalid email address format for admin notification: ${recipientEmail}`
    console.error('❌ VALIDATION ERROR:', errorMsg)
    throw new Error(errorMsg)
  }

  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const formattedDateRange = formatDateRange(data)

  const mailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: data.email,
    subject: `New Reservation Inquiry - ${formattedEventType} - ${formattedDateRange}`,
    text: generateAdminEmailText(data),
    html: generateAdminEmailHTML(data),
  }

  console.log('📦 Mail options prepared:')
  console.log('   From:', mailOptions.from)
  console.log('   To:', mailOptions.to)
  console.log('   Subject:', mailOptions.subject.substring(0, 80))
  console.log('   Has Text:', !!mailOptions.text)
  console.log('   Has HTML:', !!mailOptions.html)
  console.log('   Reply-To:', mailOptions.replyTo)
  
  if (!mailOptions.to || mailOptions.to !== recipientEmail) {
    console.error('❌ CRITICAL: Mail options "to" field does not match recipientEmail!')
    console.error('   Expected:', recipientEmail)
    console.error('   Actual:', mailOptions.to)
    throw new Error(`Email recipient mismatch: expected ${recipientEmail}, got ${mailOptions.to}`)
  }
  
  const emailTransporter = getTransporter()
  console.log('✅ Transporter obtained, attempting to send email...')
  console.log('   Transporter host:', process.env.SMTP_HOST || 'smtp.gmail.com')
  console.log('   Transporter port:', process.env.SMTP_PORT || '587')
  console.log('   Transporter user:', process.env.SMTP_USER ? 'SET' : 'NOT SET')
  
  try {
    console.log('📤 Calling sendMail()...')
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log('='.repeat(60))
    console.log('✅ ADMIN NOTIFICATION EMAIL SENT SUCCESSFULLY!')
    console.log('='.repeat(60))
    console.log('Message ID:', result.messageId || 'N/A')
    console.log('Response:', result.response || 'N/A')
    console.log('Accepted recipients:', result.accepted || [])
    console.log('Rejected recipients:', result.rejected || [])
    console.log('Pending recipients:', result.pending || [])
    console.log('To:', recipientEmail)
    console.log('='.repeat(60))
    
    // Check if email was actually accepted
    if (result.rejected && result.rejected.length > 0) {
      console.error('❌ WARNING: Email was rejected by SMTP server!')
      console.error('Rejected addresses:', result.rejected)
      throw new Error(`Email was rejected by SMTP server: ${result.rejected.join(', ')}`)
    }
    
    if (!result.accepted || result.accepted.length === 0) {
      console.error('❌ WARNING: No recipients were accepted by SMTP server!')
      throw new Error('No recipients were accepted by SMTP server')
    }
    
    return result
  } catch (sendError) {
    console.error('='.repeat(60))
    console.error('❌ sendMail() THREW AN ERROR:')
    console.error('='.repeat(60))
    console.error('Error type:', sendError?.constructor?.name || 'Unknown')
    console.error('Error message:', sendError instanceof Error ? sendError.message : String(sendError))
    
    // Check for nodemailer-specific error properties
    if (sendError && typeof sendError === 'object') {
      const err = sendError as any
      console.error('Error code:', err.code || 'N/A')
      console.error('Error command:', err.command || 'N/A')
      console.error('Error response:', err.response || 'N/A')
      console.error('Error responseCode:', err.responseCode || 'N/A')
    }
    
    console.error('Full error object:', sendError)
    if (sendError instanceof Error) {
      console.error('Error stack:', sendError.stack)
    }
    console.error('='.repeat(60))
    throw sendError // Re-throw to be caught by outer try-catch
  }
}

/**
 * Send auto-reply confirmation email to user
 */
export async function sendUserConfirmation(data: ReservationData): Promise<void> {
  const mailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: data.email,
    subject: 'Reservation Inquiry Received - Hell University',
    text: generateUserEmailText(data),
    html: generateUserEmailHTML(data),
  }

  console.log('Sending user confirmation to:', data.email)
  console.log('Mail options prepared:', {
    from: mailOptions.from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    hasText: !!mailOptions.text,
    hasHtml: !!mailOptions.html
  })
  
  const emailTransporter = getTransporter()
  console.log('Transporter obtained, attempting to send...')
  
  try {
    const result = await emailTransporter.sendMail(mailOptions)
    console.log('✅ User confirmation email sent successfully!')
    console.log('Message ID:', result.messageId)
    console.log('Response:', result.response || 'N/A')
    console.log('To:', data.email)
    return result
  } catch (sendError) {
    console.error('❌ sendMail() threw an error:')
    console.error('Error:', sendError)
    throw sendError // Re-throw to be caught by outer try-catch
  }
}

/**
 * Send both admin notification and user confirmation
 * Returns success status and any errors
 */
export async function sendReservationEmails(
  data: ReservationData
): Promise<{ adminSent: boolean; userSent: boolean; errors: string[] }> {
  // Log the received data structure for debugging
  console.log('='.repeat(60))
  console.log('📋 RECEIVED DATA FOR EMAIL GENERATION:')
  console.log('='.repeat(60))
  console.log('Name:', data.name || 'MISSING')
  console.log('Email:', data.email || 'MISSING')
  console.log('Phone:', data.phone || 'MISSING')
  console.log('Participants:', data.participants || 'MISSING')
  console.log('Event Type:', data.eventType || 'MISSING')
  console.log('Other Event Type:', data.otherEventType || 'N/A')
  console.log('Date Range:', data.dateRange ? 'YES' : 'NO')
  console.log('Start Date:', data.startDate || 'MISSING')
  console.log('End Date:', data.endDate || 'MISSING')
  console.log('Start Time:', data.startTime || 'MISSING')
  console.log('End Time:', data.endTime || 'MISSING')
  console.log('Organization Type:', data.organizationType || 'MISSING')
  console.log('Introduction:', data.introduction ? `${data.introduction.substring(0, 50)}...` : 'MISSING')
  console.log('Biography:', data.biography ? `${data.biography.substring(0, 50)}...` : 'N/A')
  console.log('Special Requests:', data.specialRequests ? `${data.specialRequests.substring(0, 50)}...` : 'N/A')
  console.log('='.repeat(60))
  
  const errors: string[] = []
  let adminSent = false
  let userSent = false

  // Send admin notification FIRST
  try {
    console.log('='.repeat(60))
    console.log('STEP 1: Attempting to send admin notification email...')
    console.log('='.repeat(60))
    await sendAdminNotification(data)
    adminSent = true
    console.log('✅ Admin notification sent successfully')
    console.log('='.repeat(60))
  } catch (error) {
    // Enhanced error handling
    let errorMessage = 'Unknown error'
    let errorCode = 'UNKNOWN'
    let errorResponse = ''
    
    if (error instanceof Error) {
      errorMessage = error.message
      errorCode = (error as any).code || 'NO_CODE'
      
      // Try to get response from nodemailer error
      if ((error as any).response) {
        errorResponse = String((error as any).response)
      }
      
      // Check for specific nodemailer error codes
      if (errorCode === 'EAUTH') {
        errorMessage = 'SMTP authentication failed. Please check your credentials.'
      } else if (errorCode === 'ECONNECTION') {
        errorMessage = 'SMTP connection failed. Please check your network and SMTP settings.'
      } else if (errorCode === 'ETIMEDOUT') {
        errorMessage = 'SMTP connection timeout. Please check your SMTP host and port.'
      } else if (errorCode === 'EMESSAGE') {
        errorMessage = 'Invalid message format or recipient address.'
      }
    }
    
    errors.push(`Admin notification failed: ${errorMessage}`)
    
    console.error('❌ FAILED to send admin notification email')
    console.error('Error type:', error?.constructor?.name || 'Unknown')
    console.error('Error message:', errorMessage)
    console.error('Error code:', errorCode)
    console.error('Error response:', errorResponse || 'N/A')
    console.error('Full error object:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    console.error('Recipient email:', process.env.RESERVATION_EMAIL || process.env.SMTP_USER)
    console.error('='.repeat(60))
  }

  // Send user confirmation SECOND
  try {
    console.log('='.repeat(60))
    console.log('STEP 2: Attempting to send user confirmation email...')
    console.log('='.repeat(60))
    await sendUserConfirmation(data)
    userSent = true
    console.log('✅ User confirmation sent successfully')
    console.log('='.repeat(60))
  } catch (error) {
    // Enhanced error handling
    let errorMessage = 'Unknown error'
    let errorCode = 'UNKNOWN'
    let errorResponse = ''
    
    if (error instanceof Error) {
      errorMessage = error.message
      errorCode = (error as any).code || 'NO_CODE'
      
      // Try to get response from nodemailer error
      if ((error as any).response) {
        errorResponse = String((error as any).response)
      }
      
      // Check for specific nodemailer error codes
      if (errorCode === 'EAUTH') {
        errorMessage = 'SMTP authentication failed. Please check your credentials.'
      } else if (errorCode === 'ECONNECTION') {
        errorMessage = 'SMTP connection failed. Please check your network and SMTP settings.'
      } else if (errorCode === 'ETIMEDOUT') {
        errorMessage = 'SMTP connection timeout. Please check your SMTP host and port.'
      } else if (errorCode === 'EMESSAGE') {
        errorMessage = 'Invalid message format or recipient address.'
      }
    }
    
    errors.push(`User confirmation failed: ${errorMessage}`)
    
    console.error('❌ FAILED to send user confirmation email')
    console.error('Error type:', error?.constructor?.name || 'Unknown')
    console.error('Error message:', errorMessage)
    console.error('Error code:', errorCode)
    console.error('Error response:', errorResponse || 'N/A')
    console.error('Full error object:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    console.error('User email:', data.email)
    console.error('='.repeat(60))
  }

  // Final summary
  console.log('='.repeat(60))
  console.log('EMAIL SENDING SUMMARY:')
  console.log('='.repeat(60))
  console.log('Admin notification:', adminSent ? '✅ SENT' : '❌ FAILED')
  console.log('User confirmation:', userSent ? '✅ SENT' : '❌ FAILED')
  if (errors.length > 0) {
    console.log('Errors:', errors)
  }
  console.log('='.repeat(60))
  
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

