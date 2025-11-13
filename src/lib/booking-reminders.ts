/**
 * Booking Reminder System
 * 
 * Sends reminder emails to users before their event start date
 */

import { getTursoClient } from "./turso"
import { sendBookingStatusNotification } from "./email"
import { formatBooking } from "./bookings"
import { calculateStartTimestamp } from "./booking-validations"

// Note: formatBooking is imported from bookings.ts

/**
 * Send reminder emails for upcoming bookings
 * - 7 days before start date
 * - 24 hours before start date
 */
export async function sendBookingReminders(): Promise<{
  sent7Day: number
  sent24Hour: number
  errors: number
}> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // Calculate reminder timestamps
  const sevenDaysFromNow = now + (7 * 24 * 60 * 60) // 7 days in seconds
  const oneDayFromNow = now + (24 * 60 * 60) // 24 hours in seconds
  const sevenDaysWindow = sevenDaysFromNow + (24 * 60 * 60) // 7 days + 1 day window
  const oneDayWindow = oneDayFromNow + (2 * 60 * 60) // 24 hours + 2 hour window

  let sent7Day = 0
  let sent24Hour = 0
  let errors = 0

  // Find bookings that need 7-day reminders (confirmed bookings, start date in 6-8 days)
  // Optimized: Uses idx_bookings_status_start_date composite index for status + date range filtering
  const sevenDayBookings = await db.execute({
    sql: `
      SELECT id, start_date, start_time, status, email
      FROM bookings
      WHERE status = 'confirmed'
        AND start_date >= ?
        AND start_date <= ?
      ORDER BY start_date ASC
    `,
    args: [sevenDaysFromNow - (24 * 60 * 60), sevenDaysWindow],
  })

  // Find bookings that need 24-hour reminders (confirmed bookings, start date in 23-25 hours)
  // Optimized: Uses idx_bookings_status_start_date composite index for status + date range filtering
  const oneDayBookings = await db.execute({
    sql: `
      SELECT id, start_date, start_time, status, email
      FROM bookings
      WHERE status = 'confirmed'
        AND start_date >= ?
        AND start_date <= ?
      ORDER BY start_date ASC
    `,
    args: [oneDayFromNow - (60 * 60), oneDayWindow],
  })

  // Process 7-day reminders
  for (const row of sevenDayBookings.rows) {
    const bookingRow = row as any
    const startTimestamp = calculateStartTimestamp(bookingRow.start_date, bookingRow.start_time)
    
    // Check if booking is exactly 7 days away (within 24 hour window)
    const daysUntilStart = Math.floor((startTimestamp - now) / (24 * 60 * 60))
    
    if (daysUntilStart >= 6 && daysUntilStart <= 8) {
      try {
        // Fetch full booking details
        const fullBookingResult = await db.execute({
          sql: "SELECT * FROM bookings WHERE id = ?",
          args: [bookingRow.id],
        })
        
        if (fullBookingResult.rows.length > 0) {
          const fullBooking = formatBooking(fullBookingResult.rows[0] as any)
          
          // Check if reminder already sent (using email tracking)
          const { hasEmailBeenSent, logEmailSent } = await import("./email-tracking")
          const reminderAlreadySent = await hasEmailBeenSent(
            bookingRow.id,
            "reminder",
            "7day",
            bookingRow.email
          )
          
          if (!reminderAlreadySent) {
            // Send 7-day reminder
            await sendBookingStatusNotification(fullBooking, bookingRow.status, {
              changeReason: `Reminder: Your booking is coming up in ${daysUntilStart} day${daysUntilStart !== 1 ? 's' : ''}. Please confirm your attendance.`,
              skipDuplicateCheck: true, // Use email tracking instead
            })
            
            // Log reminder sent
            await logEmailSent(bookingRow.id, "reminder", "7day", bookingRow.email)
            sent7Day++
            console.log(`7-day reminder sent for booking ${bookingRow.id}`)
          }
        }
      } catch (error) {
        console.error(`Failed to send 7-day reminder for booking ${bookingRow.id}:`, error)
        errors++
      }
    }
  }

  // Process 24-hour reminders
  for (const row of oneDayBookings.rows) {
    const bookingRow = row as any
    const startTimestamp = calculateStartTimestamp(bookingRow.start_date, bookingRow.start_time)
    
    // Check if booking is exactly 24 hours away (within 2 hour window)
    const hoursUntilStart = Math.floor((startTimestamp - now) / (60 * 60))
    
    if (hoursUntilStart >= 23 && hoursUntilStart <= 25) {
      try {
        // Fetch full booking details
        const fullBookingResult = await db.execute({
          sql: "SELECT * FROM bookings WHERE id = ?",
          args: [bookingRow.id],
        })
        
        if (fullBookingResult.rows.length > 0) {
          const fullBooking = formatBooking(fullBookingResult.rows[0] as any)
          
          // Check if reminder already sent
          const { hasEmailBeenSent, logEmailSent } = await import("./email-tracking")
          const reminderAlreadySent = await hasEmailBeenSent(
            bookingRow.id,
            "reminder",
            "24hour",
            bookingRow.email
          )
          
          if (!reminderAlreadySent) {
            // Send 24-hour reminder
            await sendBookingStatusNotification(fullBooking, bookingRow.status, {
              changeReason: `Reminder: Your booking is tomorrow! Please confirm your attendance and prepare for your event.`,
              skipDuplicateCheck: true, // Use email tracking instead
            })
            
            // Log reminder sent
            await logEmailSent(bookingRow.id, "reminder", "24hour", bookingRow.email)
            sent24Hour++
            console.log(`24-hour reminder sent for booking ${bookingRow.id}`)
          }
        }
      } catch (error) {
        console.error(`Failed to send 24-hour reminder for booking ${bookingRow.id}:`, error)
        errors++
      }
    }
  }

  return {
    sent7Day,
    sent24Hour,
    errors,
  }
}

