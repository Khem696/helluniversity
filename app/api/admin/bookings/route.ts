import { NextResponse } from "next/server"
import { listBookings } from "@/lib/bookings"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

/**
 * Admin Bookings Management API
 * 
 * GET /api/admin/bookings - List all bookings with filters
 * - Requires Google Workspace authentication
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

export async function GET(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const status = searchParams.get("status") as
      | "pending"
      | "accepted"
      | "rejected"
      | "postponed"
      | null
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const email = searchParams.get("email") || undefined

    // Parse date filters (Unix timestamps)
    const startDateFrom = searchParams.get("startDateFrom")
      ? parseInt(searchParams.get("startDateFrom")!)
      : undefined
    const startDateTo = searchParams.get("startDateTo")
      ? parseInt(searchParams.get("startDateTo")!)
      : undefined

    const result = await listBookings({
      status: status || undefined,
      limit,
      offset,
      email,
      startDateFrom,
      startDateTo,
    })

    return NextResponse.json({
      success: true,
      bookings: result.bookings,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
    })
  } catch (error) {
    console.error("List bookings error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list bookings",
      },
      { status: 500 }
    )
  }
}

