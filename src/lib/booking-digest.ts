/**
 * Booking Digest System
 * 
 * Sends daily/weekly digest emails to admin with booking statistics
 */

import { getTursoClient } from "./turso"
import { getTransporter } from "./email"
import { getBangkokDateString, createBangkokTimestamp } from "./timezone"
import { logInfo, logError } from "./logger"

/**
 * Send daily digest email to admin with booking statistics
 */
export async function sendDailyBookingDigest(): Promise<void> {
  const db = getTursoClient()
  
  // Use Bangkok timezone day boundaries for "today" and "this week" calculations
  // This ensures "new_today" and "new_week" represent calendar days in Bangkok timezone,
  // not just "last 24 hours" or "last 7 days" in UTC
  const todayBangkok = getBangkokDateString() // "2024-12-19"
  const todayStart = createBangkokTimestamp(todayBangkok, "00:00") // Start of today in Bangkok (UTC timestamp)
  const oneDayAgo = todayStart // Start of today in Bangkok timezone
  const oneWeekAgo = todayStart - (7 * 24 * 60 * 60) // 7 days ago from start of today

  // Get booking statistics
  const stats = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'pending_deposit' THEN 1 ELSE 0 END) as pending_deposit,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_today,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_week
      FROM bookings
    `,
    args: [oneDayAgo, oneWeekAgo],
  })

  const statsRow = stats.rows[0] as any

  // Get recent bookings (last 24 hours)
  // Optimized: Uses idx_bookings_created_at index for filtering and ordering
  const recentBookings = await db.execute({
    sql: `
      SELECT id, name, email, event_type, status, created_at
      FROM bookings
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 20
    `,
    args: [oneDayAgo],
  })

  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER
  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Booking Digest</title>
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
                Daily Booking Digest
              </h1>
              <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 14px;">
                ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' })}
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 20px;">Booking Statistics</h2>
              
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; margin-bottom: 30px;">
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb; font-weight: bold;">Total Bookings</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right;">${statsRow.total || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Pending</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.pending || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Pending Deposit</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.pending_deposit || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Confirmed</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.confirmed || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Cancelled</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${statsRow.cancelled || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Finished</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #3b82f6;">${statsRow.finished || 0}</td>
                </tr>
              </table>

              <h3 style="margin: 30px 0 10px 0; color: #1f2937; font-size: 16px;">New Bookings</h3>
              <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 14px;">
                <strong>Today:</strong> ${statsRow.new_today || 0} booking${(statsRow.new_today || 0) !== 1 ? 's' : ''}<br>
                <strong>This Week:</strong> ${statsRow.new_week || 0} booking${(statsRow.new_week || 0) !== 1 ? 's' : ''}
              </p>

              ${recentBookings.rows.length > 0 ? `
              <h3 style="margin: 30px 0 10px 0; color: #1f2937; font-size: 16px;">Recent Bookings (Last 24 Hours)</h3>
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; margin-bottom: 20px;">
                <tr style="background-color: #f9fafb; font-weight: bold;">
                  <td style="border: 1px solid #e5e7eb;">Name</td>
                  <td style="border: 1px solid #e5e7eb;">Event Type</td>
                  <td style="border: 1px solid #e5e7eb;">Status</td>
                </tr>
                ${recentBookings.rows.map((row: any) => `
                  <tr>
                    <td style="border: 1px solid #e5e7eb;">${row.name}</td>
                    <td style="border: 1px solid #e5e7eb;">${row.event_type}</td>
                    <td style="border: 1px solid #e5e7eb;">
                      <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; background-color: ${
                        row.status === 'pending' ? '#fef3c7' :
                        row.status === 'pending_deposit' ? '#fef3c7' :
                        row.status === 'confirmed' ? '#d1fae5' :
                        row.status === 'cancelled' ? '#f3f4f6' :
                        row.status === 'finished' ? '#dbeafe' :
                        '#f3f4f6'
                      }; color: ${
                        row.status === 'pending' ? '#92400e' :
                        row.status === 'pending_deposit' ? '#92400e' :
                        row.status === 'confirmed' ? '#065f46' :
                        row.status === 'cancelled' ? '#374151' :
                        row.status === 'finished' ? '#1e40af' :
                        '#374151'
                      };">
                        ${row.status}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </table>
              ` : ''}

              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This is an automated daily digest of your booking system. You can review and manage bookings in the admin dashboard.
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

  const textContent = `
Daily Booking Digest
${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' })}

Booking Statistics:
- Total Bookings: ${statsRow.total || 0}
- Pending: ${statsRow.pending || 0}
- Pending Deposit: ${statsRow.pending_deposit || 0}
- Confirmed: ${statsRow.confirmed || 0}
- Cancelled: ${statsRow.cancelled || 0}
- Finished: ${statsRow.finished || 0}

New Bookings:
- Today: ${statsRow.new_today || 0} booking${(statsRow.new_today || 0) !== 1 ? 's' : ''}
- This Week: ${statsRow.new_week || 0} booking${(statsRow.new_week || 0) !== 1 ? 's' : ''}

${recentBookings.rows.length > 0 ? `Recent Bookings (Last 24 Hours):\n${recentBookings.rows.map((row: any) => `- ${row.name} (${row.event_type}) - ${row.status}`).join('\n')}\n` : ''}

This is an automated daily digest of your booking system.

Best regards,
Hell University Reservation System
  `.trim()

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail({
      from: `"Hell University" <${process.env.SMTP_USER}>`,
      to: recipientEmail,
      subject: `Daily Booking Digest - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })}`,
      html: htmlContent,
      text: textContent,
    })
    
    await logInfo('Daily booking digest email sent', { messageId: result.messageId })
  } catch (error) {
    await logError('Failed to send daily booking digest', { recipientEmail }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * Send weekly digest email to admin with booking statistics
 */
export async function sendWeeklyBookingDigest(): Promise<void> {
  const db = getTursoClient()
  
  // Use Bangkok timezone day boundaries for "this week" and "last week" calculations
  // This ensures "new_week" and "new_last_week" represent calendar weeks in Bangkok timezone
  const todayBangkok = getBangkokDateString() // "2024-12-19"
  const todayStart = createBangkokTimestamp(todayBangkok, "00:00") // Start of today in Bangkok (UTC timestamp)
  const oneWeekAgo = todayStart - (7 * 24 * 60 * 60) // 7 days ago from start of today
  const twoWeeksAgo = todayStart - (14 * 24 * 60 * 60) // 14 days ago from start of today

  // Get booking statistics
  const stats = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'pending_deposit' THEN 1 ELSE 0 END) as pending_deposit,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_week,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_last_week
      FROM bookings
    `,
    args: [oneWeekAgo, twoWeeksAgo],
  })

  const statsRow = stats.rows[0] as any

  // Get recent bookings (last 7 days)
  // Optimized: Uses idx_bookings_created_at index for filtering and ordering
  const recentBookings = await db.execute({
    sql: `
      SELECT id, name, email, event_type, status, created_at, reference_number
      FROM bookings
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 50
    `,
    args: [oneWeekAgo],
  })

  const recipientEmail = process.env.RESERVATION_EMAIL || process.env.SMTP_USER
  if (!recipientEmail) {
    throw new Error('RESERVATION_EMAIL or SMTP_USER not configured')
  }

  // Use Bangkok timezone for date formatting in email
  const weekStart = new Date(oneWeekAgo * 1000)
  const weekEnd = new Date(todayStart * 1000)

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Booking Digest</title>
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
                Weekly Booking Digest
              </h1>
              <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 14px;">
                ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Bangkok' })}
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 20px;">Booking Statistics</h2>
              
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; margin-bottom: 30px;">
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb; font-weight: bold;">Total Bookings</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right;">${statsRow.total || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Pending</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.pending || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Pending Deposit</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.pending_deposit || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Confirmed</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.confirmed || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Cancelled</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${statsRow.cancelled || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Finished</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #3b82f6;">${statsRow.finished || 0}</td>
                </tr>
              </table>

              <h3 style="margin: 30px 0 10px 0; color: #1f2937; font-size: 16px;">New Bookings</h3>
              <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 14px;">
                <strong>This Week:</strong> ${statsRow.new_week || 0} booking${(statsRow.new_week || 0) !== 1 ? 's' : ''}<br>
                <strong>Last Week:</strong> ${statsRow.new_last_week || 0} booking${(statsRow.new_last_week || 0) !== 1 ? 's' : ''}
              </p>

              ${recentBookings.rows.length > 0 ? `
              <h3 style="margin: 30px 0 10px 0; color: #1f2937; font-size: 16px;">Recent Bookings (Last 7 Days)</h3>
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; margin-bottom: 20px;">
                <tr style="background-color: #f9fafb; font-weight: bold;">
                  <td style="border: 1px solid #e5e7eb;">Reference</td>
                  <td style="border: 1px solid #e5e7eb;">Name</td>
                  <td style="border: 1px solid #e5e7eb;">Event Type</td>
                  <td style="border: 1px solid #e5e7eb;">Status</td>
                </tr>
                ${recentBookings.rows.map((row: any) => `
                  <tr>
                    <td style="border: 1px solid #e5e7eb; font-family: monospace; font-size: 12px; color: #6b7280;">${row.reference_number || 'N/A'}</td>
                    <td style="border: 1px solid #e5e7eb;">${row.name}</td>
                    <td style="border: 1px solid #e5e7eb;">${row.event_type}</td>
                    <td style="border: 1px solid #e5e7eb;">
                      <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; background-color: ${
                        row.status === 'pending' ? '#fef3c7' :
                        row.status === 'pending_deposit' ? '#fef3c7' :
                        row.status === 'confirmed' ? '#d1fae5' :
                        row.status === 'cancelled' ? '#f3f4f6' :
                        row.status === 'finished' ? '#dbeafe' :
                        '#f3f4f6'
                      }; color: ${
                        row.status === 'pending' ? '#92400e' :
                        row.status === 'pending_deposit' ? '#92400e' :
                        row.status === 'confirmed' ? '#065f46' :
                        row.status === 'cancelled' ? '#374151' :
                        row.status === 'finished' ? '#1e40af' :
                        '#374151'
                      };">
                        ${row.status}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </table>
              ` : ''}

              <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This is an automated weekly digest of your booking system. You can review and manage bookings in the admin dashboard.
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

  const textContent = `
Weekly Booking Digest
${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Bangkok' })}

Booking Statistics:
- Total Bookings: ${statsRow.total || 0}
- Pending: ${statsRow.pending || 0}
- Pending Deposit: ${statsRow.pending_deposit || 0}
- Confirmed: ${statsRow.confirmed || 0}
- Cancelled: ${statsRow.cancelled || 0}
- Finished: ${statsRow.finished || 0}

New Bookings:
- This Week: ${statsRow.new_week || 0} booking${(statsRow.new_week || 0) !== 1 ? 's' : ''}
- Last Week: ${statsRow.new_last_week || 0} booking${(statsRow.new_last_week || 0) !== 1 ? 's' : ''}

${recentBookings.rows.length > 0 ? `Recent Bookings (Last 7 Days):\n${recentBookings.rows.map((row: any) => `- ${row.reference_number || 'N/A'}: ${row.name} (${row.event_type}) - ${row.status}`).join('\n')}\n` : ''}

This is an automated weekly digest of your booking system.

Best regards,
Hell University Reservation System
  `.trim()

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail({
      from: `"Hell University" <${process.env.SMTP_USER}>`,
      to: recipientEmail,
      subject: `Weekly Booking Digest - ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })} to ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })}`,
      html: htmlContent,
      text: textContent,
    })
    
    await logInfo('Weekly booking digest email sent', { messageId: result.messageId })
  } catch (error) {
    await logError('Failed to send weekly booking digest', { recipientEmail }, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}







