import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

/**
 * Admin Event Image Management API
 * 
 * PATCH /api/admin/events/[id]/images/[imageId] - Update event image (display_order)
 * DELETE /api/admin/events/[id]/images/[imageId] - Remove image from event
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { imageId } = await params
    const body = await request.json()
    const { display_order } = body

    if (display_order === undefined) {
      return NextResponse.json(
        { success: false, error: "display_order is required" },
        { status: 400 }
      )
    }

    const db = getTursoClient()

    await db.execute({
      sql: `UPDATE event_images SET display_order = ? WHERE id = ?`,
      args: [parseInt(String(display_order)), imageId],
    })

    // Fetch updated event_image
    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.id = ?
      `,
      args: [imageId],
    })

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Event image not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      event_image: result.rows[0],
    })
  } catch (error) {
    console.error("Update event image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update event image",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { imageId } = await params
    const db = getTursoClient()

    await db.execute({
      sql: "DELETE FROM event_images WHERE id = ?",
      args: [imageId],
    })

    return NextResponse.json({
      success: true,
      message: "Event image removed successfully",
    })
  } catch (error) {
    console.error("Delete event image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete event image",
      },
      { status: 500 }
    )
  }
}

