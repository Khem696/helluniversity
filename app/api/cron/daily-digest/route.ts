/**
 * Daily Booking Digest Cron Job
 * 
 * This endpoint is called by Vercel cron jobs
 * Sends daily booking digest email to admin
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest } from "@/lib/booking-digest"

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

    // Send daily digest
    await sendDailyBookingDigest()
    
    return NextResponse.json({
      success: true,
      message: "Daily booking digest sent successfully",
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Daily digest cron error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send daily digest",
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

