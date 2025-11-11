/**
 * Booking Reminders API
 * 
 * Endpoint to send reminder emails for upcoming bookings
 */

import { NextResponse } from "next/server"
import { sendBookingReminders } from "@/lib/booking-reminders"
import { checkAuth } from "@/lib/auth"

export async function POST(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const result = await sendBookingReminders()
    
    return NextResponse.json({
      success: true,
      message: "Reminders sent successfully",
      result: {
        sent7Day: result.sent7Day,
        sent24Hour: result.sent24Hour,
        errors: result.errors,
      },
    })
  } catch (error) {
    console.error("Reminder error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send reminders",
      },
      { status: 500 }
    )
  }
}


