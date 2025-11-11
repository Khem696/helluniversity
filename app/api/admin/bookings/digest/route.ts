/**
 * Booking Digest API
 * 
 * Endpoints for daily/weekly booking digest emails
 */

import { NextResponse } from "next/server"
import { sendDailyBookingDigest, sendWeeklyBookingDigest } from "@/lib/booking-digest"
import { checkAuth } from "@/lib/auth"

export async function POST(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const body = await request.json()
    const { type } = body // "daily" or "weekly"

    if (!type || !["daily", "weekly"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Invalid type. Must be 'daily' or 'weekly'" },
        { status: 400 }
      )
    }

    if (type === "daily") {
      await sendDailyBookingDigest()
      return NextResponse.json({
        success: true,
        message: "Daily booking digest sent successfully",
      })
    } else {
      await sendWeeklyBookingDigest()
      return NextResponse.json({
        success: true,
        message: "Weekly booking digest sent successfully",
      })
    }
  } catch (error) {
    console.error("Digest error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send digest",
      },
      { status: 500 }
    )
  }
}



