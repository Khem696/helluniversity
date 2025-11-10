import { NextResponse } from "next/server"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { 
  processEmailQueue, 
  getEmailQueueStats, 
  getEmailQueueItems,
  cleanupOldSentEmails 
} from "@/lib/email-queue"

/**
 * Admin Email Queue Management API
 * 
 * GET /api/admin/email-queue - Get email queue statistics and items
 * POST /api/admin/email-queue - Process pending emails or cleanup old emails
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

/**
 * GET /api/admin/email-queue
 * Get email queue statistics and items
 */
export async function GET(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") as any
    const emailType = searchParams.get("emailType") as any
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : undefined
    const statsOnly = searchParams.get("statsOnly") === "true"

    if (statsOnly) {
      const stats = await getEmailQueueStats()
      return NextResponse.json({
        success: true,
        stats,
      })
    }

    // Get items with filters
    const result = await getEmailQueueItems({
      status,
      emailType,
      limit,
      offset,
    })

    const stats = await getEmailQueueStats()

    return NextResponse.json({
      success: true,
      items: result.items,
      total: result.total,
      stats,
    })
  } catch (error) {
    console.error("Get email queue error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get email queue",
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/email-queue
 * Process pending emails in queue or cleanup old emails
 */
export async function POST(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const body = await request.json().catch(() => ({}))
    const { action, limit, daysOld } = body

    if (action === "cleanup") {
      const deletedCount = await cleanupOldSentEmails(daysOld || 30)
      return NextResponse.json({
        success: true,
        message: `Cleaned up ${deletedCount} old sent emails`,
        deletedCount,
      })
    }

    // Default: process queue
    const result = await processEmailQueue(limit || 10)

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error("Process email queue error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to process email queue",
      },
      { status: 500 }
    )
  }
}

