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
  participants: string
  eventType: string
  otherEventType?: string
  dateRange: boolean
  startDate: string | null
  endDate: string | null
  startTime: string
  endTime: string
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
function formatDateTime(dateString: string, timeString: string): string {
  try {
    const date = new Date(dateString)
    const [hours, minutes] = timeString.split(':')
    date.setHours(parseInt(hours), parseInt(minutes))
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return `${dateString} at ${timeString}`
  }
}

// Format date range for display
function formatDateRange(data: ReservationData): string {
  if (!data.startDate) return "Not specified"
  
  const startDateTime = formatDateTime(data.startDate, data.startTime)
  
  if (!data.dateRange || !data.endDate) {
    // Single day
    return `${startDateTime} - ${data.endTime}`
  } else {
    // Date range
    const endDateTime = formatDateTime(data.endDate, data.endTime)
    return `${startDateTime} to ${endDateTime}`
  }
}

// Generate HTML email template for admin notification
function generateAdminEmailHTML(data: ReservationData): string {
  const formattedDateRange = formatDateRange(data)
  const formattedEventType = formatEventType(data.eventType, data.otherEventType)
  const organizationRemark = data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client"

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
        <span class="field-value">${data.name}</span>
      </div>
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value"><a href="mailto:${data.email}">${data.email}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Phone:</span>
        <span class="field-value"><a href="tel:${data.phone}">${data.phone}</a></span>
      </div>
      <div class="field">
        <span class="field-label">Number of Participants:</span>
        <span class="field-value">${data.participants}</span>
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
        <span class="field-value">${data.organizationType} (${organizationRemark})</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Guest Information</div>
      <div class="field">
        <span class="field-label">Introduction:</span>
        <div class="text-content">${data.introduction.replace(/\n/g, '<br>')}</div>
      </div>
      ${data.biography ? `
      <div class="field">
        <span class="field-label">Background & Interests:</span>
        <div class="text-content">${data.biography.replace(/\n/g, '<br>')}</div>
      </div>
      ` : ''}
      ${data.specialRequests ? `
      <div class="field">
        <span class="field-label">Special Requests:</span>
        <div class="text-content">${data.specialRequests.replace(/\n/g, '<br>')}</div>
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

  return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

BOOKING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Number of Participants: ${data.participants}
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Organization: ${data.organizationType} (${organizationRemark})

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
    <p>Dear ${data.name},</p>
    
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
        <span class="summary-label">Number of Participants:</span> ${data.participants}
      </div>
      <div class="summary-item">
        <span class="summary-label">Organization:</span> ${data.organizationType} (${organizationRemark})
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

  return `
RESERVATION INQUIRY RECEIVED - HELL UNIVERSITY

Dear ${data.name},

Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.

YOUR INQUIRY SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Type: ${formattedEventType}
Date & Time: ${formattedDateRange}
Number of Participants: ${data.participants}
Organization: ${data.organizationType} (${organizationRemark})

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
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
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

  const emailTransporter = getTransporter()
  await emailTransporter.sendMail(mailOptions)
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

  const emailTransporter = getTransporter()
  await emailTransporter.sendMail(mailOptions)
}

/**
 * Send both admin notification and user confirmation
 * Returns success status and any errors
 */
export async function sendReservationEmails(
  data: ReservationData
): Promise<{ adminSent: boolean; userSent: boolean; errors: string[] }> {
  const errors: string[] = []
  let adminSent = false
  let userSent = false

  // Send admin notification
  try {
    await sendAdminNotification(data)
    adminSent = true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    errors.push(`Admin notification failed: ${errorMessage}`)
    console.error('Failed to send admin notification:', error)
  }

  // Send user confirmation
  try {
    await sendUserConfirmation(data)
    userSent = true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    errors.push(`User confirmation failed: ${errorMessage}`)
    console.error('Failed to send user confirmation:', error)
  }

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

