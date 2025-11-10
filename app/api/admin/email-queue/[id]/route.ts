import { NextResponse } from "next/server"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { getEmailQueueItem, retryEmail, cancelEmail, deleteEmail } from "@/lib/email-queue"

/**
 * Admin Email Queue Item Management API
 * 
 * GET /api/admin/email-queue/[id] - Get specific email queue item
 * POST /api/admin/email-queue/[id] - Retry specific email
 * PATCH /api/admin/email-queue/[id] - Update email status (cancel/retry)
 * DELETE /api/admin/email-queue/[id] - Delete email from queue
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

/**
 * GET /api/admin/email-queue/[id]
 * Get specific email queue item
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const email = await getEmailQueueItem(id)

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Email not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      email,
    })
  } catch (error) {
    console.error("Get email queue item error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get email queue item",
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/email-queue/[id]/retry
 * Manually retry a specific email
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const result = await retryEmail(id)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Email retried successfully",
    })
  } catch (error) {
    console.error("Retry email error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to retry email",
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/email-queue/[id]
 * Delete an email from queue
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    await deleteEmail(id)

    return NextResponse.json({
      success: true,
      message: "Email deleted successfully",
    })
  } catch (error) {
    console.error("Delete email error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete email",
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/email-queue/[id]
 * Update email status (cancel)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (action === "cancel") {
      await cancelEmail(id)
      return NextResponse.json({
        success: true,
        message: "Email cancelled successfully",
      })
    } else if (action === "retry") {
      const result = await retryEmail(id)
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        )
      }
      return NextResponse.json({
        success: true,
        message: "Email retried successfully",
      })
    }

    return NextResponse.json(
      { success: false, error: "Invalid action" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Update email error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update email",
      },
      { status: 500 }
    )
  }
}

