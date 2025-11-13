/**
 * Booking Digest System
 * 
 * Sends daily/weekly digest emails to admin with booking statistics
 */

import { getTursoClient } from "./turso"
import { getTransporter } from "./email"

/**
 * Send daily digest email to admin with booking statistics
 */
export async function sendDailyBookingDigest(): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const oneDayAgo = now - (24 * 60 * 60)
  const oneWeekAgo = now - (7 * 24 * 60 * 60)

  // Get booking statistics
  const stats = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'postponed' THEN 1 ELSE 0 END) as postponed,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'checked-in' THEN 1 ELSE 0 END) as checked_in,
        SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_today,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_week
      FROM bookings
    `,
    args: [oneDayAgo, oneWeekAgo],
  })

  const statsRow = stats.rows[0] as any

  // Get recent bookings (last 24 hours)
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
                ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
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
                  <td style="border: 1px solid #e5e7eb;">Accepted</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.accepted || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Postponed</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.postponed || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Rejected</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #ef4444;">${statsRow.rejected || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Cancelled</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${statsRow.cancelled || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Checked-In</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.checked_in || 0}</td>
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
                        row.status === 'accepted' ? '#d1fae5' :
                        row.status === 'postponed' ? '#fef3c7' :
                        row.status === 'rejected' ? '#fee2e2' :
                        row.status === 'cancelled' ? '#f3f4f6' :
                        row.status === 'checked-in' ? '#d1fae5' :
                        '#dbeafe'
                      }; color: ${
                        row.status === 'pending' ? '#92400e' :
                        row.status === 'accepted' ? '#065f46' :
                        row.status === 'postponed' ? '#92400e' :
                        row.status === 'rejected' ? '#991b1b' :
                        row.status === 'cancelled' ? '#374151' :
                        row.status === 'checked-in' ? '#065f46' :
                        '#1e40af'
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
${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Booking Statistics:
- Total Bookings: ${statsRow.total || 0}
- Pending: ${statsRow.pending || 0}
- Accepted: ${statsRow.accepted || 0}
- Postponed: ${statsRow.postponed || 0}
- Rejected: ${statsRow.rejected || 0}
- Cancelled: ${statsRow.cancelled || 0}
- Checked-In: ${statsRow.checked_in || 0}
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
      subject: `Daily Booking Digest - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html: htmlContent,
      text: textContent,
    })
    
    console.log('Daily booking digest email sent:', result.messageId)
  } catch (error) {
    console.error('Failed to send daily booking digest:', error)
    throw error
  }
}

/**
 * Send weekly digest email to admin with booking statistics
 */
export async function sendWeeklyBookingDigest(): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const oneWeekAgo = now - (7 * 24 * 60 * 60)
  const twoWeeksAgo = now - (14 * 24 * 60 * 60)

  // Get booking statistics
  const stats = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'postponed' THEN 1 ELSE 0 END) as postponed,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'checked-in' THEN 1 ELSE 0 END) as checked_in,
        SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_week,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_last_week
      FROM bookings
    `,
    args: [oneWeekAgo, twoWeeksAgo],
  })

  const statsRow = stats.rows[0] as any

  // Get recent bookings (last 7 days)
  const recentBookings = await db.execute({
    sql: `
      SELECT id, name, email, event_type, status, created_at
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

  const weekStart = new Date(now * 1000 - (7 * 24 * 60 * 60 * 1000))
  const weekEnd = new Date(now * 1000)

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
                ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                  <td style="border: 1px solid #e5e7eb;">Accepted</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.accepted || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Postponed</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #f59e0b;">${statsRow.postponed || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Rejected</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #ef4444;">${statsRow.rejected || 0}</td>
                </tr>
                <tr>
                  <td style="border: 1px solid #e5e7eb;">Cancelled</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${statsRow.cancelled || 0}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="border: 1px solid #e5e7eb;">Checked-In</td>
                  <td style="border: 1px solid #e5e7eb; text-align: right; color: #10b981;">${statsRow.checked_in || 0}</td>
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
                        row.status === 'accepted' ? '#d1fae5' :
                        row.status === 'postponed' ? '#fef3c7' :
                        row.status === 'rejected' ? '#fee2e2' :
                        row.status === 'cancelled' ? '#f3f4f6' :
                        row.status === 'checked-in' ? '#d1fae5' :
                        '#dbeafe'
                      }; color: ${
                        row.status === 'pending' ? '#92400e' :
                        row.status === 'accepted' ? '#065f46' :
                        row.status === 'postponed' ? '#92400e' :
                        row.status === 'rejected' ? '#991b1b' :
                        row.status === 'cancelled' ? '#374151' :
                        row.status === 'checked-in' ? '#065f46' :
                        '#1e40af'
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
${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}

Booking Statistics:
- Total Bookings: ${statsRow.total || 0}
- Pending: ${statsRow.pending || 0}
- Accepted: ${statsRow.accepted || 0}
- Postponed: ${statsRow.postponed || 0}
- Rejected: ${statsRow.rejected || 0}
- Cancelled: ${statsRow.cancelled || 0}
- Checked-In: ${statsRow.checked_in || 0}
- Finished: ${statsRow.finished || 0}

New Bookings:
- This Week: ${statsRow.new_week || 0} booking${(statsRow.new_week || 0) !== 1 ? 's' : ''}
- Last Week: ${statsRow.new_last_week || 0} booking${(statsRow.new_last_week || 0) !== 1 ? 's' : ''}

${recentBookings.rows.length > 0 ? `Recent Bookings (Last 7 Days):\n${recentBookings.rows.map((row: any) => `- ${row.name} (${row.event_type}) - ${row.status}`).join('\n')}\n` : ''}

This is an automated weekly digest of your booking system.

Best regards,
Hell University Reservation System
  `.trim()

  try {
    const emailTransporter = await getTransporter()
    const result = await emailTransporter.sendMail({
      from: `"Hell University" <${process.env.SMTP_USER}>`,
      to: recipientEmail,
      subject: `Weekly Booking Digest - ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html: htmlContent,
      text: textContent,
    })
    
    console.log('Weekly booking digest email sent:', result.messageId)
  } catch (error) {
    console.error('Failed to send weekly booking digest:', error)
    throw error
  }
}







