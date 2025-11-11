/**
 * Booking Reminders Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends reminder emails for upcoming bookings
 */

import { NextResponse } from "next/server"
import { sendBookingReminders } from "@/lib/booking-reminders"

export async function GET(request: Request) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret) {
      console.error('CRON_SECRET not configured')
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      )
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('Unauthorized cron job attempt')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Send reminders
    const result = await sendBookingReminders()
    
    return NextResponse.json({
      success: true,
      message: "Reminders sent successfully",
      result: {
        sent7Day: result.sent7Day,
        sent24Hour: result.sent24Hour,
        errors: result.errors,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Reminders cron error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send reminders",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}



