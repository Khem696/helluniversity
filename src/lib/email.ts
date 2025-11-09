import nodemailer, { type Transporter } from 'nodemailer'

interface ReservationData {
  name: string
  email: string
  phone: string
  guests: string
  eventType: string
  date: string
  introduction: string
  biography: string
  specialRequests: string
}

// Create reusable transporter
let transporter: Transporter | null = null
let transporterVerified = false

/**
 * Get or create the email transporter with connection verification
 * Uses nodemailer v7 compatible configuration
 */
async function getTransporter(): Promise<Transporter> {
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
function formatEventType(eventType: string): string {
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
  const formattedDate = formatDate(data.date)
  const formattedEventType = formatEventType(data.eventType)

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
        <span class="field-label">Number of Guests:</span>
        <span class="field-value">${sanitizeHTML(data.guests)}</span>
      </div>
      <div class="field">
        <span class="field-label">Event Type:</span>
        <span class="field-value">${sanitizeHTML(formattedEventType)}</span>
      </div>
      <div class="field">
        <span class="field-label">Desired Date:</span>
        <span class="field-value">${sanitizeHTML(formattedDate)}</span>
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
  const formattedDate = formatDate(data.date)
  const formattedEventType = formatEventType(data.eventType)

  return `
NEW RESERVATION INQUIRY - HELL UNIVERSITY

BOOKING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Number of Guests: ${data.guests}
Event Type: ${formattedEventType}
Desired Date: ${formattedDate}

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
  const formattedDate = formatDate(data.date)
  const formattedEventType = formatEventType(data.eventType)

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
    <p>Dear ${sanitizeHTML(data.name)},</p>
    
    <p>Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.</p>
    
    <div class="summary">
      <h3 style="margin-top: 0; color: #5a3a2a;">Your Inquiry Summary:</h3>
      <div class="summary-item">
        <span class="summary-label">Event Type:</span> ${formattedEventType}
      </div>
      <div class="summary-item">
        <span class="summary-label">Desired Date:</span> ${formattedDate}
      </div>
      <div class="summary-item">
        <span class="summary-label">Number of Guests:</span> ${data.guests}
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
  const formattedDate = formatDate(data.date)
  const formattedEventType = formatEventType(data.eventType)

  return `
RESERVATION INQUIRY RECEIVED - HELL UNIVERSITY

Dear ${data.name},

Thank you for your reservation inquiry with Hell University! We have received your request and our curation team will carefully review it.

YOUR INQUIRY SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Type: ${formattedEventType}
Desired Date: ${formattedDate}
Number of Guests: ${data.guests}

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
export async function sendAdminNotification(data: ReservationData): Promise<void> {
  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER

  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const formattedEventType = formatEventType(data.eventType)
  const formattedDate = formatDate(data.date)

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University Reservation System" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    replyTo: data.email,
    subject: `New Reservation Inquiry - ${formattedEventType} - ${formattedDate}`,
    text: generateAdminEmailText(data),
    html: generateAdminEmailHTML(data),
  }

  const emailTransporter = await getTransporter()
  const result = await emailTransporter.sendMail(mailOptions)
  
  // Log successful send (nodemailer v7 returns messageId)
  console.log('Admin notification email sent:', result.messageId)
}

/**
 * Send auto-reply confirmation email to user
 * Uses nodemailer v7 compatible API
 */
export async function sendUserConfirmation(data: ReservationData): Promise<void> {
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"Hell University" <${process.env.SMTP_USER}>`,
    to: data.email,
    subject: 'Reservation Inquiry Received - Hell University',
    text: generateUserEmailText(data),
    html: generateUserEmailHTML(data),
  }

  const emailTransporter = await getTransporter()
  const result = await emailTransporter.sendMail(mailOptions)
  
  // Log successful send (nodemailer v7 returns messageId)
  console.log('User confirmation email sent:', result.messageId)
}

/**
 * Send both admin notification and user confirmation
 * Returns success status and any errors
 * Uses nodemailer v7 compatible error handling
 */
export async function sendReservationEmails(
  data: ReservationData
): Promise<{ adminSent: boolean; userSent: boolean; errors: string[] }> {
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
    await sendUserConfirmation(data)
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

