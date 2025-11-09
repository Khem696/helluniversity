import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import {
  getBookingById,
  updateBookingStatus,
  getBookingStatusHistory,
  logAdminAction,
} from "@/lib/bookings"
import { sendBookingStatusNotification } from "@/lib/email"
import {
  requireAuthorizedDomain,
  unauthorizedResponse,
  forbiddenResponse,
  getAuthSession,
} from "@/lib/auth"

/**
 * Admin Booking Management API
 * 
 * GET /api/admin/bookings/[id] - Get booking details
 * PATCH /api/admin/bookings/[id] - Update booking status
 * - All routes require Google Workspace authentication
 */

async function checkAuth() {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required")
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
  }
  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const booking = await getBookingById(id)

    if (!booking) {
      return NextResponse.json(
        { success: false, error: "Booking not found" },
        { status: 404 }
      )
    }

    // Get status history
    const statusHistory = await getBookingStatusHistory(id)

    return NextResponse.json({
      success: true,
      booking,
      statusHistory,
    })
  } catch (error) {
    console.error("Get booking error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get booking",
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { status, changeReason, adminNotes, proposedDate } = body

    // Validate status
    if (
      !status ||
      !["pending", "accepted", "rejected", "postponed", "cancelled"].includes(status)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid status. Must be: pending, accepted, rejected, postponed, or cancelled" },
        { status: 400 }
      )
    }

    // Get current booking to check if it exists
    const currentBooking = await getBookingById(id)
    if (!currentBooking) {
      return NextResponse.json(
        { success: false, error: "Booking not found" },
        { status: 404 }
      )
    }

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined

    try {
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      // Session might not be available, continue without admin info
      console.warn("Could not get session for admin action logging:", sessionError)
    }

    // Update booking status
    const updatedBooking = await updateBookingStatus(id, status, {
      changedBy: adminEmail,
      changeReason,
      adminNotes,
      proposedDate: proposedDate || undefined,
      sendNotification: true, // Always send notification on status change
    })

    // Log admin action
    try {
      await logAdminAction({
        actionType: "update_booking_status",
        resourceType: "booking",
        resourceId: id,
        adminEmail,
        adminName,
        description: `Changed booking status from ${currentBooking.status} to ${status}`,
        metadata: {
          oldStatus: currentBooking.status,
          newStatus: status,
          changeReason,
        },
      })
    } catch (logError) {
      // Don't fail the request if logging fails
      console.error("Failed to log admin action:", logError)
    }

    // Send email notification to user (don't fail request if email fails)
    if (updatedBooking.responseToken || status !== "pending") {
      try {
        await sendBookingStatusNotification(updatedBooking, status, {
          changeReason,
          proposedDate: updatedBooking.proposedDate,
          responseToken: updatedBooking.responseToken,
        })
        console.log("Booking status notification email sent successfully")
      } catch (emailError) {
        console.error("Failed to send booking status notification email:", emailError)
        // Don't fail the request - email is secondary
      }
    }

    return NextResponse.json({
      success: true,
      booking: updatedBooking,
    })
  } catch (error) {
    console.error("Update booking error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update booking",
      },
      { status: 500 }
    )
  }
}

