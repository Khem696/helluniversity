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

// Helper to ensure we always have a string (never undefined/null)
function ensureString(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str === 'undefined' || str === 'null' || str === 'NaN') return ''
  return str
}

// Escape HTML to prevent XSS and ensure proper display
function escapeHtml(text: string | null | undefined): string {
  try {
    const safeText = ensureString(text)
    if (!safeText || typeof safeText !== 'string') return ''
    // Double-check it's a string before calling replace
    const str = String(safeText)
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  } catch (error) {
    console.error('❌ escapeHtml error:', error, 'Input:', text)
    return ''
  }
}

// Format event type for display
function formatEventType(eventType: string, otherEventType?: string): string {
  try {
    if (!eventType) return 'Not specified'
    
    if (eventType === "Other" && otherEventType) {
      return `Other: ${ensureString(otherEventType) || 'Not specified'}`
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
    const result = eventTypes[eventType] || ensureString(eventType) || 'Not specified'
    return ensureString(result) // Double-check it's a string
  } catch (error) {
    console.error('❌ formatEventType error:', error)
    return 'Not specified'
  }
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
  try {
    if (!data.startDate) {
      console.warn('⚠️ formatDateRange: startDate is missing')
      return "Not specified"
    }
    
    console.error('📅 formatDateRange called with:')
    console.error('   - startDate:', data.startDate)
    console.error('   - startTime:', data.startTime)
    console.error('   - endDate:', data.endDate)
    console.error('   - endTime:', data.endTime)
    console.error('   - dateRange:', data.dateRange)
    
    const startDateTime = ensureString(formatDateTime(data.startDate, data.startTime || null) || "Not specified")
    console.error('   - formatted startDateTime:', startDateTime)
    
    if (!data.dateRange || !data.endDate) {
      // Single day - show start date/time to end time
      if (data.endTime) {
        const endTime = ensureString(data.endTime)
        const result = `${startDateTime} - ${endTime}`
        console.error('   - single day result:', result)
        return result
      } else {
        const result = startDateTime
        console.error('   - single day (no end time) result:', result)
        return result
      }
    } else {
      // Date range - show start date/time to end date/time
      const endDateTime = ensureString(formatDateTime(data.endDate, data.endTime || null) || "Not specified")
      console.error('   - formatted endDateTime:', endDateTime)
      const result = `${startDateTime} to ${endDateTime}`
      console.error('   - date range result:', result)
      return result
    }
  } catch (error) {
    console.error('❌ formatDateRange error:', error)
    return "Not specified"
  }
}

// Generate HTML email template for admin notification
function generateAdminEmailHTML(data: ReservationData): string {
  try {
    // Log data being used for email generation
    console.error('📧 Generating admin email HTML with data:')
    console.error('   - startDate:', data.startDate)
    console.error('   - endDate:', data.endDate)
    console.error('   - startTime:', data.startTime)
    console.error('   - endTime:', data.endTime)
    console.error('   - dateRange:', data.dateRange)
    
    // Safely get all values with defaults using ensureString
    const safeIntroduction = ensureString(data.introduction) || "Not provided"
    const safeBiography = (data.biography && ensureString(data.biography).trim()) ? ensureString(data.biography) : null
    const safeSpecialRequests = (data.specialRequests && ensureString(data.specialRequests).trim()) ? ensureString(data.specialRequests) : null
    
    const formattedDateRange = ensureString(formatDateRange(data) || "Not specified")
    const formattedEventType = ensureString(formatEventType(data.eventType || "", data.otherEventType) || "Not specified")
    const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
    
    // Ensure all formatted values are strings
    const safeFormattedDateRange = ensureString(formattedDateRange)
    const safeFormattedEventType = ensureString(formattedEventType)
    const safeOrganizationRemark = ensureString(organizationRemark)
    
    console.error('   - formattedDateRange:', safeFormattedDateRange)
    console.error('   - formattedEventType:', safeFormattedEventType)

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
        <span class="field-value">${escapeHtml(ensureString(data.name) || "Not provided")}</span>
      </div>
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value"><a href="mailto:${escapeHtml(ensureString(data.email) || "Not provided")}">${escapeHtml(ensureString(data.email) || "Not provided")}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Phone:</span>
        <span class="field-value"><a href="tel:${escapeHtml(ensureString(data.phone) || "Not provided")}">${escapeHtml(ensureString(data.phone) || "Not provided")}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Number of Participants:</span>
        <span class="field-value">${escapeHtml(ensureString(data.participants) || "Not specified")}</span>
      </div>
      <div class="field">
        <span class="field-label">Event Type:</span>
        <span class="field-value">${escapeHtml(safeFormattedEventType)}</span>
      </div>
      <div class="field">
        <span class="field-label">Date & Time:</span>
        <span class="field-value">${escapeHtml(safeFormattedDateRange)}</span>
      </div>
      <div class="field">
        <span class="field-label">Organization:</span>
        <span class="field-value">${escapeHtml(ensureString(data.organizationType) || "Not specified")} (${escapeHtml(safeOrganizationRemark)})</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Guest Information</div>
      <div class="field">
        <span class="field-label">Introduction:</span>
        <div class="text-content">${(function() {
          try {
            const intro = ensureString(escapeHtml(safeIntroduction))
            return intro ? intro.replace(/\n/g, '<br>') : ''
          } catch {
            return ensureString(safeIntroduction) || ''
          }
        })()}</div>
      </div>
      ${safeBiography ? `
      <div class="field">
        <span class="field-label">Background & Interests:</span>
        <div class="text-content">${(function() {
          try {
            const bio = ensureString(escapeHtml(safeBiography))
            return bio ? bio.replace(/\n/g, '<br>') : ''
          } catch {
            return ensureString(safeBiography) || ''
          }
        })()}</div>
      </div>
      ` : ''}
      ${safeSpecialRequests ? `
      <div class="field">
        <span class="field-label">Special Requests:</span>
        <div class="text-content">${(function() {
          try {
            const req = ensureString(escapeHtml(safeSpecialRequests))
            return req ? req.replace(/\n/g, '<br>') : ''
          } catch {
            return ensureString(safeSpecialRequests) || ''
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
  } catch (error) {
    console.error('❌ ERROR in generateAdminEmailHTML:', error)
    console.error('Data received:', JSON.stringify(data, null, 2))
    // Return a simple fallback email
    return `
<!DOCTYPE html>
<html>
<body>
  <h1>New Reservation Inquiry</h1>
  <p><strong>Name:</strong> ${String(data.name || 'Not provided')}</p>
  <p><strong>Email:</strong> ${String(data.email || 'Not provided')}</p>
  <p><strong>Phone:</strong> ${String(data.phone || 'Not provided')}</p>
  <p><strong>Error generating full email template:</strong> ${error instanceof Error ? error.message : 'Unknown error'}</p>
</body>
</html>
    `.trim()
  }
}

// Generate plain text version for admin notification
function generateAdminEmailText(data: ReservationData): string {
  try {
    const formattedDateRange = formatDateRange(data) || "Not specified"
    const formattedEventType = formatEventType(data.eventType || "", data.otherEventType) || "Not specified"
    const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")

    // Ensure all values are strings
    const safeName = String(data.name || "Not provided")
    const safeEmail = String(data.email || "Not provided")
    const safePhone = String(data.phone || "Not provided")
    const safeParticipants = String(data.participants || "Not specified")
    const safeFormattedEventType = String(formattedEventType || "Not specified")
    const safeFormattedDateRange = String(formattedDateRange || "Not specified")
    const safeOrganizationType = String(data.organizationType || "Not specified")
    const safeOrganizationRemark = String(organizationRemark || "Organized by Client")
    const safeIntroduction = String(data.introduction || "Not provided")
    const safeBiography = (data.biography && String(data.biography).trim()) ? String(data.biography) : null
    const safeSpecialRequests = (data.specialRequests && String(data.specialRequests).trim()) ? String(data.specialRequests) : null

    return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

BOOKING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${safeName}
Email: ${safeEmail}
Phone: ${safePhone}
Number of Participants: ${safeParticipants}
Event Type: ${safeFormattedEventType}
Date & Time: ${safeFormattedDateRange}
Organization: ${safeOrganizationType} (${safeOrganizationRemark})

GUEST INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Introduction:
${safeIntroduction}

${safeBiography ? `Background & Interests:\n${safeBiography}\n\n` : ''}${safeSpecialRequests ? `Special Requests:\n${safeSpecialRequests}\n\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Received: ${new Date().toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'long',
    timeStyle: 'long',
  })}
  `.trim()
  } catch (error) {
    console.error('❌ ERROR in generateAdminEmailText:', error)
    console.error('Data received:', JSON.stringify(data, null, 2))
    // Return a simple fallback text email
    return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

Name: ${String(data.name || 'Not provided')}
Email: ${String(data.email || 'Not provided')}
Phone: ${String(data.phone || 'Not provided')}

Error generating full email template: ${error instanceof Error ? error.message : 'Unknown error'}
    `.trim()
  }
}

// Generate HTML email template for user auto-reply
function generateUserEmailHTML(data: ReservationData): string {
  try {
    // Log data being used for email generation
    console.error('📧 Generating user email HTML with data:')
    console.error('   - startDate:', data.startDate)
    console.error('   - endDate:', data.endDate)
    console.error('   - startTime:', data.startTime)
    console.error('   - endTime:', data.endTime)
    console.error('   - dateRange:', data.dateRange)
    
    const formattedDateRange = ensureString(formatDateRange(data) || "Not specified")
    const formattedEventType = ensureString(formatEventType(data.eventType || "", data.otherEventType) || "Not specified")
    const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
    
    // Ensure all values are strings using ensureString
    const safeFormattedDateRange = ensureString(formattedDateRange)
    const safeFormattedEventType = ensureString(formattedEventType)
    const safeOrganizationRemark = ensureString(organizationRemark)
    
    console.error('   - formattedDateRange:', safeFormattedDateRange)
    console.error('   - formattedEventType:', safeFormattedEventType)

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
    <p>Dear ${escapeHtml(String(data.name || "Guest"))},</p>
    
    <p>Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.</p>
    
    <div class="summary">
      <h3 style="margin-top: 0; color: #5a3a2a;">Your Inquiry Summary:</h3>
      <div class="summary-item">
        <span class="summary-label">Event Type:</span> ${escapeHtml(safeFormattedEventType)}
      </div>
      <div class="summary-item">
        <span class="summary-label">Date & Time:</span> ${escapeHtml(safeFormattedDateRange)}
      </div>
      <div class="summary-item">
        <span class="summary-label">Number of Participants:</span> ${escapeHtml(String(data.participants || "Not specified"))}
      </div>
      <div class="summary-item">
        <span class="summary-label">Organization:</span> ${escapeHtml(String(data.organizationType || "Not specified"))} (${escapeHtml(safeOrganizationRemark)})
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
  } catch (error) {
    console.error('❌ ERROR in generateUserEmailHTML:', error)
    console.error('Data received:', JSON.stringify(data, null, 2))
    // Return a simple fallback email
    return `
<!DOCTYPE html>
<html>
<body>
  <h1>Reservation Inquiry Received</h1>
  <p>Dear ${escapeHtml(String(data.name || "Guest"))},</p>
  <p>Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.</p>
  <p><strong>Error generating full email template:</strong> ${error instanceof Error ? escapeHtml(error.message) : 'Unknown error'}</p>
</body>
</html>
    `.trim()
  }
}

// Generate plain text version for user auto-reply
function generateUserEmailText(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data) || "Not specified"
  const formattedEventType = formatEventType(data.eventType || "", data.otherEventType) || "Not specified"
  const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")

  return `
RESERVATION INQUIRY RECEIVED - HELL UNIVERSITY

Dear ${String(data.name || "Guest")},

Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.

YOUR INQUIRY SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Type: ${String(formattedEventType)}
Date & Time: ${String(formattedDateRange)}
Number of Participants: ${String(data.participants || "Not specified")}
Organization: ${String(data.organizationType || "Not specified")} (${String(organizationRemark)})

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
  // Access environment variables directly - in Next.js API routes, these are available at runtime
  const reservationEmail = process.env.RESERVATION_EMAIL?.trim()
  const smtpUser = process.env.SMTP_USER?.trim()
  
  // Use console.error/warn so logs appear in production (console.log is removed)
  console.error('='.repeat(60))
  console.error('ADMIN EMAIL CONFIGURATION CHECK:')
  console.error('='.repeat(60))
  console.error('RESERVATION_EMAIL (raw):', process.env.RESERVATION_EMAIL || 'undefined')
  console.error('RESERVATION_EMAIL (trimmed):', reservationEmail || 'undefined')
  console.error('RESERVATION_EMAIL (length):', reservationEmail?.length || 0)
  console.error('SMTP_USER (raw):', process.env.SMTP_USER || 'undefined')
  console.error('SMTP_USER (trimmed):', smtpUser || 'undefined')
  console.error('All env vars with RESERVATION:', Object.keys(process.env).filter(k => k.includes('RESERVATION')))
  console.error('All env vars with SMTP:', Object.keys(process.env).filter(k => k.includes('SMTP')))
  console.error('Environment:', process.env.NODE_ENV || 'unknown')
  console.error('Vercel:', process.env.VERCEL ? 'YES' : 'NO')
  console.error('='.repeat(60))
  
  // STRICT: Prefer RESERVATION_EMAIL, but allow SMTP_USER as fallback
  let recipientEmail: string
  
  if (reservationEmail) {
    recipientEmail = reservationEmail
    console.error('✅ Using RESERVATION_EMAIL:', recipientEmail)
  } else if (smtpUser) {
    recipientEmail = smtpUser
    console.error('⚠️ WARNING: RESERVATION_EMAIL not set, using SMTP_USER as fallback:', smtpUser)
    console.error('⚠️ This means admin notifications will go to the SMTP sender email, not a dedicated admin email!')
    console.error('⚠️ RECOMMENDATION: Set RESERVATION_EMAIL environment variable in your production environment')
  } else {
    const errorMsg = 'RESERVATION_EMAIL or SMTP_USER must be configured. RESERVATION_EMAIL is preferred.'
    console.error('❌ CONFIGURATION ERROR:', errorMsg)
    throw new Error(errorMsg)
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(recipientEmail)) {
    const errorMsg = `Invalid email address format: ${recipientEmail}`
    console.error('❌ VALIDATION ERROR:', errorMsg)
    throw new Error(errorMsg)
  }

  // Log the recipient email for debugging (using error so it shows in production)
  console.error('📧 Sending admin notification to:', recipientEmail)
  console.error('📧 User email (from form):', data.email)
  
  // Warn if admin email is the same as user email (might be intentional, but worth noting)
  if (recipientEmail.toLowerCase() === data.email.toLowerCase()) {
    console.warn('⚠️ WARNING: Admin email recipient is the same as user email. This might be intentional.')
  }
  
  // Email format validation is now done above

  // Generate email content with comprehensive error handling
  let emailText: string
  let emailHtml: string
  
  try {
    emailText = generateAdminEmailText(data)
  } catch (error) {
    console.error('❌ ERROR generating admin email text:', error)
    // Use minimal fallback
    emailText = `NEW RESERVATION INQUIRY\n\nName: ${ensureString(data.name)}\nEmail: ${ensureString(data.email)}\nPhone: ${ensureString(data.phone)}`
  }
  
  try {
    emailHtml = generateAdminEmailHTML(data)
  } catch (error) {
    console.error('❌ ERROR generating admin email HTML:', error)
    // Use minimal fallback
    emailHtml = `<html><body><h1>New Reservation Inquiry</h1><p>Name: ${escapeHtml(ensureString(data.name))}</p><p>Email: ${escapeHtml(ensureString(data.email))}</p><p>Phone: ${escapeHtml(ensureString(data.phone))}</p></body></html>`
  }

  const formattedEventType = ensureString(formatEventType(data.eventType, data.otherEventType) || "Event")
  const formattedDateRange = ensureString(formatDateRange(data) || "Date TBD")

  const mailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: data.email,
    subject: `New Reservation Inquiry - ${formattedEventType} - ${formattedDateRange}`,
    text: emailText,
    html: emailHtml,
  }

  console.error('📦 Mail options prepared:')
  console.error('   From:', mailOptions.from)
  console.error('   To:', mailOptions.to)
  console.error('   Subject:', mailOptions.subject.substring(0, 80))
  console.error('   Has Text:', !!mailOptions.text)
  console.error('   Has HTML:', !!mailOptions.html)
  console.error('   Reply-To:', mailOptions.replyTo)
  
  if (!mailOptions.to || mailOptions.to !== recipientEmail) {
    console.error('❌ CRITICAL: Mail options "to" field does not match recipientEmail!')
    console.error('   Expected:', recipientEmail)
    console.error('   Actual:', mailOptions.to)
    throw new Error(`Email recipient mismatch: expected ${recipientEmail}, got ${mailOptions.to}`)
  }
  
  const emailTransporter = getTransporter()
  console.error('✅ Transporter obtained, attempting to send email...')
  console.error('   Transporter host:', process.env.SMTP_HOST || 'smtp.gmail.com')
  console.error('   Transporter port:', process.env.SMTP_PORT || '587')
  console.error('   Transporter user:', process.env.SMTP_USER ? 'SET' : 'NOT SET')
  
  try {
    console.error('📤 Calling sendMail()...')
    const result = await emailTransporter.sendMail(mailOptions)
    
    console.error('='.repeat(60))
    console.error('✅ ADMIN NOTIFICATION EMAIL SENT SUCCESSFULLY!')
    console.error('='.repeat(60))
    console.error('Message ID:', result.messageId || 'N/A')
    console.error('Response:', result.response || 'N/A')
    console.error('Accepted recipients:', JSON.stringify(result.accepted || []))
    console.error('Rejected recipients:', JSON.stringify(result.rejected || []))
    console.error('Pending recipients:', JSON.stringify(result.pending || []))
    console.error('To:', recipientEmail)
    console.error('='.repeat(60))
    
    // Check if email was actually accepted
    if (result.rejected && result.rejected.length > 0) {
      console.error('❌ CRITICAL: Email was REJECTED by SMTP server!')
      console.error('Rejected addresses:', result.rejected)
      console.error('This means the email address may be invalid or blocked by the SMTP server')
      throw new Error(`Email was rejected by SMTP server: ${result.rejected.join(', ')}`)
    }
    
    if (!result.accepted || result.accepted.length === 0) {
      console.error('❌ CRITICAL: No recipients were accepted by SMTP server!')
      console.error('This means the email was not accepted for delivery')
      throw new Error('No recipients were accepted by SMTP server')
    }
    
    // Verify the accepted email matches what we intended to send
    if (!result.accepted.includes(recipientEmail)) {
      console.warn('⚠️ WARNING: Accepted email address does not match intended recipient!')
      console.warn('   Intended:', recipientEmail)
      console.warn('   Accepted:', result.accepted)
      console.warn('   This might indicate an email forwarding or alias issue')
    } else {
      console.error('✅ VERIFIED: Email was accepted for:', recipientEmail)
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

  console.error('Sending user confirmation to:', data.email)
  console.error('Mail options prepared:', {
    from: mailOptions.from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    hasText: !!mailOptions.text,
    hasHtml: !!mailOptions.html
  })
  
  const emailTransporter = getTransporter()
  console.error('Transporter obtained, attempting to send...')
  
  try {
    const result = await emailTransporter.sendMail(mailOptions)
    console.error('✅ User confirmation email sent successfully!')
    console.error('Message ID:', result.messageId)
    console.error('Response:', result.response || 'N/A')
    console.error('Accepted recipients:', JSON.stringify(result.accepted || []))
    console.error('Rejected recipients:', JSON.stringify(result.rejected || []))
    console.error('To:', data.email)
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
  // Log the received data structure for debugging (using error so it shows in production)
  console.error('='.repeat(60))
  console.error('📋 RECEIVED DATA FOR EMAIL GENERATION:')
  console.error('='.repeat(60))
  console.error('Name:', data.name || 'MISSING')
  console.error('Email:', data.email || 'MISSING')
  console.error('Phone:', data.phone || 'MISSING')
  console.error('Participants:', data.participants || 'MISSING')
  console.error('Event Type:', data.eventType || 'MISSING')
  console.error('Other Event Type:', data.otherEventType || 'N/A')
  console.error('Date Range:', data.dateRange ? 'YES' : 'NO')
  console.error('Start Date:', data.startDate || 'MISSING')
  console.error('End Date:', data.endDate || 'MISSING')
  console.error('Start Time:', data.startTime || 'MISSING')
  console.error('End Time:', data.endTime || 'MISSING')
  console.error('Organization Type:', data.organizationType || 'MISSING')
  console.error('Introduction:', data.introduction ? `${data.introduction.substring(0, 50)}...` : 'MISSING')
  console.error('Biography:', data.biography ? `${data.biography.substring(0, 50)}...` : 'N/A')
  console.error('Special Requests:', data.specialRequests ? `${data.specialRequests.substring(0, 50)}...` : 'N/A')
  console.error('='.repeat(60))
  
  const errors: string[] = []
  let adminSent = false
  let userSent = false

  // Send admin notification FIRST - MUST succeed before sending user email
  try {
    console.error('='.repeat(60))
    console.error('STEP 1: Attempting to send admin notification email...')
    console.error('='.repeat(60))
    await sendAdminNotification(data)
    adminSent = true
    console.error('✅ Admin notification sent successfully')
    console.error('='.repeat(60))
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
    console.error('⚠️ CRITICAL: Admin email failed. User email will NOT be sent to avoid confusion.')
    console.error('='.repeat(60))
    
    // Return early - don't send user email if admin email failed
    // This MUST return immediately to prevent user email from being sent
    const result = { adminSent: false, userSent: false, errors }
    console.error('🚫 RETURNING EARLY - User email will NOT be sent:', result)
    return result
  }

  // Send user confirmation SECOND - only if admin email succeeded
  // This code should ONLY execute if admin email succeeded (adminSent === true)
  if (!adminSent) {
    console.error('❌ CRITICAL ERROR: Admin email failed but code reached user email section!')
    return { adminSent: false, userSent: false, errors }
  }
  
  try {
    console.error('='.repeat(60))
    console.error('STEP 2: Attempting to send user confirmation email...')
    console.error('='.repeat(60))
    await sendUserConfirmation(data)
    userSent = true
    console.error('✅ User confirmation sent successfully')
    console.error('='.repeat(60))
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

