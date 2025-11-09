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
    const safeDateString = ensureString(dateString)
    if (!safeDateString || safeDateString === 'undefined' || safeDateString === 'null') {
      return "Not specified"
    }
    const date = new Date(safeDateString)
    if (isNaN(date.getTime())) {
      return safeDateString
    }
    const formatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    return ensureString(formatted) || safeDateString
  } catch (error) {
    console.error('❌ formatDate error:', error)
    return ensureString(dateString) || "Not specified"
  }
}

// Format date and time for display
function formatDateTime(dateString: string | null | undefined, timeString: string | null | undefined): string {
  try {
    // Ensure inputs are strings
    const safeDateString = ensureString(dateString)
    const safeTimeString = ensureString(timeString)
    
    if (!safeDateString || safeDateString === 'undefined' || safeDateString === 'null') {
      console.warn('⚠️ formatDateTime: dateString is missing or invalid')
      return "Not specified"
    }
    
    if (!safeTimeString || safeTimeString === 'undefined' || safeTimeString === 'null' || safeTimeString.trim() === '') {
      console.warn('⚠️ formatDateTime: timeString is missing, formatting date only')
      // Format just the date if time is missing
      try {
        const date = new Date(safeDateString)
        if (isNaN(date.getTime())) {
          return ensureString(safeDateString) || "Not specified"
        }
        const formatted = date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
        return ensureString(formatted) || safeDateString
      } catch {
        return ensureString(safeDateString) || "Not specified"
      }
    }
    
    const date = new Date(safeDateString)
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('⚠️ formatDateTime: Invalid date:', safeDateString)
      return `${ensureString(safeDateString)} at ${ensureString(safeTimeString)}`
    }
    
    // Safely split time string
    const timeParts = ensureString(safeTimeString).split(':')
    const hours = timeParts[0]
    const minutes = timeParts[1]
    
    if (!hours || !minutes || hours === 'undefined' || minutes === 'undefined') {
      console.warn('⚠️ formatDateTime: Invalid time format:', safeTimeString)
      return `${ensureString(safeDateString)} at ${ensureString(safeTimeString)}`
    }
    
    date.setHours(parseInt(ensureString(hours), 10), parseInt(ensureString(minutes), 10))
    
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
    
    const safeFormatted = ensureString(formatted)
    if (!safeFormatted || safeFormatted.includes('Invalid')) {
      console.warn('⚠️ formatDateTime: Formatted date contains "Invalid"')
      return `${ensureString(safeDateString)} at ${ensureString(safeTimeString)}`
    }
    
    return safeFormatted
  } catch (error) {
    console.error('❌ formatDateTime error:', error)
    const safeDate = ensureString(dateString) || "Not specified"
    const safeTime = ensureString(timeString) || ""
    return safeTime ? `${safeDate} at ${safeTime}` : safeDate
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
    
    // Safely get all values with defaults using ensureString - do this BEFORE any string operations
    const safeName = ensureString(data.name) || "Not provided"
    const safeEmail = ensureString(data.email) || "Not provided"
    const safePhone = ensureString(data.phone) || "Not provided"
    const safeParticipants = ensureString(data.participants) || "Not specified"
    const safeIntroduction = ensureString(data.introduction) || "Not provided"
    const safeBiography = (data.biography && ensureString(data.biography).trim()) ? ensureString(data.biography) : null
    const safeSpecialRequests = (data.specialRequests && ensureString(data.specialRequests).trim()) ? ensureString(data.specialRequests) : null
    const safeOrganizationType = ensureString(data.organizationType) || "Not specified"
    
    // Format date range and event type with error handling
    let formattedDateRange = "Not specified"
    let formattedEventType = "Not specified"
    try {
      const dateRangeResult = formatDateRange(data)
      formattedDateRange = ensureString(dateRangeResult) || "Not specified"
    } catch (e) {
      console.error('❌ Error formatting date range:', e)
      formattedDateRange = "Not specified"
    }
    
    try {
      const eventTypeResult = formatEventType(data.eventType || "", data.otherEventType)
      formattedEventType = ensureString(eventTypeResult) || "Not specified"
    } catch (e) {
      console.error('❌ Error formatting event type:', e)
      formattedEventType = "Not specified"
    }
    
    const organizationRemark = (data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
    
    // Ensure all formatted values are strings
    const safeFormattedDateRange = ensureString(formattedDateRange)
    const safeFormattedEventType = ensureString(formattedEventType)
    const safeOrganizationRemark = ensureString(organizationRemark)
    
    // Pre-process all escaped values BEFORE template string to avoid evaluation errors
    const escapedName = escapeHtml(safeName)
    const escapedEmail = escapeHtml(safeEmail)
    const escapedPhone = escapeHtml(safePhone)
    const escapedParticipants = escapeHtml(safeParticipants)
    const escapedEventType = escapeHtml(safeFormattedEventType)
    const escapedDateRange = escapeHtml(safeFormattedDateRange)
    const escapedOrgType = escapeHtml(safeOrganizationType)
    const escapedOrgRemark = escapeHtml(safeOrganizationRemark)
    
    // Pre-process introduction with newlines - use string concatenation instead of replace
    let processedIntroduction = ''
    try {
      const introEscaped = escapeHtml(safeIntroduction)
      const intro = ensureString(introEscaped)
      if (intro && typeof intro === 'string') {
        // Use split/join instead of replace to avoid any replace issues
        processedIntroduction = intro.split('\n').join('<br>')
      } else {
        processedIntroduction = ensureString(safeIntroduction) || ''
      }
    } catch (e) {
      console.error('❌ Error processing introduction:', e)
      processedIntroduction = ensureString(safeIntroduction) || ''
    }
    
    // Pre-process biography with newlines
    let processedBiography = null
    if (safeBiography) {
      try {
        const bioEscaped = escapeHtml(safeBiography)
        const bio = ensureString(bioEscaped)
        if (bio && typeof bio === 'string') {
          processedBiography = bio.split('\n').join('<br>')
        } else {
          processedBiography = ensureString(safeBiography) || ''
        }
      } catch (e) {
        console.error('❌ Error processing biography:', e)
        processedBiography = ensureString(safeBiography) || ''
      }
    }
    
    // Pre-process special requests with newlines
    let processedSpecialRequests = null
    if (safeSpecialRequests) {
      try {
        const reqEscaped = escapeHtml(safeSpecialRequests)
        const req = ensureString(reqEscaped)
        if (req && typeof req === 'string') {
          processedSpecialRequests = req.split('\n').join('<br>')
        } else {
          processedSpecialRequests = ensureString(safeSpecialRequests) || ''
        }
      } catch (e) {
        console.error('❌ Error processing special requests:', e)
        processedSpecialRequests = ensureString(safeSpecialRequests) || ''
      }
    }
    
    // Pre-process timestamp
    let timestamp = ''
    try {
      const ts = new Date().toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'long',
        timeStyle: 'long',
      })
      timestamp = ensureString(ts) || new Date().toISOString()
    } catch {
      timestamp = new Date().toISOString()
    }
    
    console.error('   - formattedDateRange:', safeFormattedDateRange)
    console.error('   - formattedEventType:', safeFormattedEventType)

    // Build HTML using string concatenation instead of template literals to avoid any evaluation issues
    const htmlParts: string[] = []
    htmlParts.push('<!DOCTYPE html>')
    htmlParts.push('<html>')
    htmlParts.push('<head>')
    htmlParts.push('  <meta charset="UTF-8">')
    htmlParts.push('  <style>')
    htmlParts.push('    body { font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }')
    htmlParts.push('    .header { background-color: #5B9AB8; color: white; padding: 20px; border-radius: 8px 8px 0 0; }')
    htmlParts.push('    .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }')
    htmlParts.push('    .section { margin-bottom: 25px; }')
    htmlParts.push('    .section-title { font-size: 18px; font-weight: 600; color: #5a3a2a; margin-bottom: 12px; border-bottom: 2px solid #5B9AB8; padding-bottom: 5px; }')
    htmlParts.push('    .field { margin-bottom: 10px; }')
    htmlParts.push('    .field-label { font-weight: 600; color: #5a3a2a; display: inline-block; min-width: 140px; }')
    htmlParts.push('    .field-value { color: #333; }')
    htmlParts.push('    .text-content { background-color: white; padding: 15px; border-radius: 4px; margin-top: 8px; border-left: 3px solid #5B9AB8; }')
    htmlParts.push('    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; text-align: center; }')
    htmlParts.push('    .timestamp { font-size: 12px; color: #666; margin-top: 20px; font-style: italic; }')
    htmlParts.push('  </style>')
    htmlParts.push('</head>')
    htmlParts.push('<body>')
    htmlParts.push('  <div class="header">')
    htmlParts.push('    <h1 style="margin: 0;">New Reservation Inquiry</h1>')
    htmlParts.push('  </div>')
    htmlParts.push('  <div class="content">')
    htmlParts.push('    <div class="section">')
    htmlParts.push('      <div class="section-title">Booking Details</div>')
    htmlParts.push('      <div class="field"><span class="field-label">Name:</span><span class="field-value">' + escapedName + '</span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Email:</span><span class="field-value"><a href="mailto:' + escapedEmail + '">' + escapedEmail + '</a></span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Phone:</span><span class="field-value"><a href="tel:' + escapedPhone + '">' + escapedPhone + '</a></span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Number of Participants:</span><span class="field-value">' + escapedParticipants + '</span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Event Type:</span><span class="field-value">' + escapedEventType + '</span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Date & Time:</span><span class="field-value">' + escapedDateRange + '</span></div>')
    htmlParts.push('      <div class="field"><span class="field-label">Organization:</span><span class="field-value">' + escapedOrgType + ' (' + escapedOrgRemark + ')</span></div>')
    htmlParts.push('    </div>')
    htmlParts.push('    <div class="section">')
    htmlParts.push('      <div class="section-title">Guest Information</div>')
    htmlParts.push('      <div class="field"><span class="field-label">Introduction:</span><div class="text-content">' + processedIntroduction + '</div></div>')
    if (processedBiography) {
      htmlParts.push('      <div class="field"><span class="field-label">Background & Interests:</span><div class="text-content">' + processedBiography + '</div></div>')
    }
    if (processedSpecialRequests) {
      htmlParts.push('      <div class="field"><span class="field-label">Special Requests:</span><div class="text-content">' + processedSpecialRequests + '</div></div>')
    }
    htmlParts.push('    </div>')
    htmlParts.push('    <div class="timestamp">Received: ' + timestamp + '</div>')
    htmlParts.push('  </div>')
    htmlParts.push('  <div class="footer">')
    htmlParts.push('    <p>This email was automatically generated from the Hell University reservation form.</p>')
    htmlParts.push('  </div>')
    htmlParts.push('</body>')
    htmlParts.push('</html>')
    
    return htmlParts.join('\n')
  } catch (error) {
    console.error('❌ ERROR in generateAdminEmailHTML:', error)
    console.error('Data received:', JSON.stringify(data, null, 2))
    // Return a simple fallback email using string concatenation
    const fallbackParts: string[] = []
    fallbackParts.push('<!DOCTYPE html>')
    fallbackParts.push('<html>')
    fallbackParts.push('<body>')
    fallbackParts.push('  <h1>New Reservation Inquiry</h1>')
    fallbackParts.push('  <p><strong>Name:</strong> ' + ensureString(data.name || 'Not provided') + '</p>')
    fallbackParts.push('  <p><strong>Email:</strong> ' + ensureString(data.email || 'Not provided') + '</p>')
    fallbackParts.push('  <p><strong>Phone:</strong> ' + ensureString(data.phone || 'Not provided') + '</p>')
    fallbackParts.push('  <p><strong>Error generating full email template:</strong> ' + (error instanceof Error ? escapeHtml(error.message) : 'Unknown error') + '</p>')
    fallbackParts.push('</body>')
    fallbackParts.push('</html>')
    return fallbackParts.join('\n')
  }
}

// Generate plain text version for admin notification
function generateAdminEmailText(data: ReservationData): string {
  try {
    // Format date range and event type with error handling
    let formattedDateRange = "Not specified"
    let formattedEventType = "Not specified"
    try {
      const dateRangeResult = formatDateRange(data)
      formattedDateRange = ensureString(dateRangeResult) || "Not specified"
    } catch (e) {
      console.error('❌ Error formatting date range:', e)
      formattedDateRange = "Not specified"
    }
    
    try {
      const eventTypeResult = formatEventType(data.eventType || "", data.otherEventType)
      formattedEventType = ensureString(eventTypeResult) || "Not specified"
    } catch (e) {
      console.error('❌ Error formatting event type:', e)
      formattedEventType = "Not specified"
    }
    
    // Safely get all values
    const safeName = ensureString(data.name) || "Not provided"
    const safeEmail = ensureString(data.email) || "Not provided"
    const safePhone = ensureString(data.phone) || "Not provided"
    const safeParticipants = ensureString(data.participants) || "Not specified"
    const safeFormattedEventType = ensureString(formattedEventType)
    const safeFormattedDateRange = ensureString(formattedDateRange)
    const safeOrganizationType = ensureString(data.organizationType) || "Not specified"
    const safeOrganizationRemark = ensureString(data.organizationType === "Tailor Event" ? "Organized by HU" : "Organized by Client")
    const safeIntroduction = ensureString(data.introduction) || "Not provided"
    const safeBiography = (data.biography && ensureString(data.biography).trim()) ? ensureString(data.biography) : null
    const safeSpecialRequests = (data.specialRequests && ensureString(data.specialRequests).trim()) ? ensureString(data.specialRequests) : null

    // Build text using string concatenation
    const textParts: string[] = []
    textParts.push('NEW RESERVATION INQUIRY - HELL UNIVERSITY')
    textParts.push('')
    textParts.push('BOOKING DETAILS:')
    textParts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    textParts.push('Name: ' + safeName)
    textParts.push('Email: ' + safeEmail)
    textParts.push('Phone: ' + safePhone)
    textParts.push('Number of Participants: ' + safeParticipants)
    textParts.push('Event Type: ' + safeFormattedEventType)
    textParts.push('Date & Time: ' + safeFormattedDateRange)
    textParts.push('Organization: ' + safeOrganizationType + ' (' + safeOrganizationRemark + ')')
    textParts.push('')
    textParts.push('GUEST INFORMATION:')
    textParts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    textParts.push('Introduction:')
    textParts.push(safeIntroduction)
    if (safeBiography) {
      textParts.push('')
      textParts.push('Background & Interests:')
      textParts.push(safeBiography)
    }
    if (safeSpecialRequests) {
      textParts.push('')
      textParts.push('Special Requests:')
      textParts.push(safeSpecialRequests)
    }
    textParts.push('')
    textParts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    textParts.push('This email was automatically generated from the Hell University reservation form.')
    
    return textParts.join('\n')
  } catch (error) {
    console.error('❌ ERROR in generateAdminEmailText:', error)
    console.error('Data received:', JSON.stringify(data, null, 2))
    // Return a simple fallback text email using string concatenation
    const fallbackParts: string[] = []
    fallbackParts.push('NEW RESERVATION INQUIRY - HELL UNIVERSITY')
    fallbackParts.push('')
    fallbackParts.push('Name: ' + ensureString(data.name || 'Not provided'))
    fallbackParts.push('Email: ' + ensureString(data.email || 'Not provided'))
    fallbackParts.push('Phone: ' + ensureString(data.phone || 'Not provided'))
    fallbackParts.push('')
    fallbackParts.push('Error generating full email template: ' + (error instanceof Error ? error.message : 'Unknown error'))
    return fallbackParts.join('\n')
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
  
  // Generate email content with comprehensive error handling
  // If generation fails, throw error to prevent email sending
  try {
    emailText = generateAdminEmailText(data)
    if (!emailText || typeof emailText !== 'string') {
      throw new Error('Generated email text is invalid')
    }
  } catch (error) {
    console.error('❌ ERROR generating admin email text:', error)
    console.error('Error details:', error instanceof Error ? error.stack : error)
    // Re-throw to prevent email from being sent
    throw new Error(`Failed to generate admin email text: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  try {
    emailHtml = generateAdminEmailHTML(data)
    if (!emailHtml || typeof emailHtml !== 'string') {
      throw new Error('Generated email HTML is invalid')
    }
  } catch (error) {
    console.error('❌ ERROR generating admin email HTML:', error)
    console.error('Error details:', error instanceof Error ? error.stack : error)
    // Re-throw to prevent email from being sent
    throw new Error(`Failed to generate admin email HTML: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
  // Wrap in additional try-catch to ensure we catch ALL errors
  try {
    console.error('='.repeat(60))
    console.error('STEP 1: Attempting to send admin notification email...')
    console.error('='.repeat(60))
    
    // Wrap the entire admin notification in a try-catch to catch any errors during generation
    try {
      await sendAdminNotification(data)
      adminSent = true
      console.error('✅ Admin notification sent successfully')
      console.error('='.repeat(60))
    } catch (innerError) {
      // Re-throw to be caught by outer catch
      console.error('❌ INNER ERROR in sendAdminNotification:', innerError)
      throw innerError
    }
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
    console.error('🚫 RETURNING EARLY - User email will NOT be sent:', JSON.stringify(result))
    console.error('🚫 EXITING FUNCTION - User email code will NOT execute')
    return result
  }

  // CRITICAL: Triple-check admin email succeeded before proceeding
  // This should NEVER execute if admin email failed (due to early return above)
  if (!adminSent) {
    console.error('❌ CRITICAL ERROR: Admin email failed but code reached user email section (second check)!')
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

