import { NextResponse } from "next/server"
import { getBookingByToken, submitUserResponse } from "@/lib/bookings"

/**
 * User Booking Response API
 * 
 * GET /api/booking/response/[token] - Get booking details by token
 * POST /api/booking/response/[token] - Submit user response
 * - Public endpoints (authenticated by token)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const booking = await getBookingByToken(token)

    if (!booking) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 404 }
      )
    }

    // Return booking details (without sensitive admin info)
    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        email: booking.email,
        eventType: booking.eventType,
        otherEventType: booking.otherEventType,
        startDate: booking.startDate,
        endDate: booking.endDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        proposedDate: booking.proposedDate,
        userResponse: booking.userResponse,
      },
    })
  } catch (error) {
    console.error("Get booking by token error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get booking",
      },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const { response, proposedDate, message } = body

    // Validate response type
    if (!response || !["accept", "propose", "cancel"].includes(response)) {
      return NextResponse.json(
        { success: false, error: "Invalid response. Must be: accept, propose, or cancel" },
        { status: 400 }
      )
    }

    // Get booking by token
    const booking = await getBookingByToken(token)
    if (!booking) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 404 }
      )
    }

    // Validate email matches (extra security)
    const emailHeader = request.headers.get("x-user-email")
    if (emailHeader && emailHeader !== booking.email) {
      return NextResponse.json(
        { success: false, error: "Email mismatch" },
        { status: 403 }
      )
    }

    // Validate proposed date if response is "propose"
    if (response === "propose" && !proposedDate) {
      return NextResponse.json(
        { success: false, error: "proposedDate is required when response is 'propose'" },
        { status: 400 }
      )
    }

    // Submit user response
    const updatedBooking = await submitUserResponse(booking.id, response, {
      proposedDate,
      message,
    })

    return NextResponse.json({
      success: true,
      message: "Your response has been submitted successfully",
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status,
        userResponse: updatedBooking.userResponse,
      },
    })
  } catch (error) {
    console.error("Submit user response error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit response",
      },
      { status: 500 }
    )
  }
}

