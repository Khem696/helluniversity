import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

/**
 * Admin Image Update API
 * 
 * PATCH /api/admin/images/[id]
 * - Update image metadata (category, display_order, title, etc.)
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { category, display_order, title, event_info } = body

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Build update fields
    const updates: string[] = ["updated_at = ?"]
    const args: any[] = [now]

    if (category !== undefined) {
      updates.push("category = ?")
      args.push(category)
    }

    if (display_order !== undefined) {
      updates.push("display_order = ?")
      args.push(parseInt(String(display_order)))
    }

    if (title !== undefined) {
      updates.push("title = ?")
      args.push(title)
    }

    if (event_info !== undefined) {
      updates.push("event_info = ?")
      args.push(event_info)
    }

    if (updates.length === 1) {
      // Only updated_at, nothing to update
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      )
    }

    args.push(id)

    await db.execute({
      sql: `UPDATE images SET ${updates.join(", ")} WHERE id = ?`,
      args,
    })

    // Fetch updated image
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, event_info, category, display_order, format,
          width, height, file_size, original_filename,
          created_at, updated_at
        FROM images
        WHERE id = ?
      `,
      args: [id],
    })

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Image not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      image: result.rows[0],
    })
  } catch (error) {
    console.error("Update image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update image",
      },
      { status: 500 }
    )
  }
}
