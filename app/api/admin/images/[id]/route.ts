import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { deleteImageWithMetadata } from "@/lib/blob"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

/**
 * Admin Image Management API
 * 
 * GET /api/admin/images/[id] - Get image by ID
 * DELETE /api/admin/images/[id] - Delete image (from both Blob Storage and database)
 * PATCH /api/admin/images/[id] - Update image metadata
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
    const db = getTursoClient()

    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, event_info, format,
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
    console.error("Get image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get image",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError
    const { id } = await params

    // Delete from both Blob Storage and database
    await deleteImageWithMetadata(id)

    return NextResponse.json({
      success: true,
      message: "Image deleted successfully",
    })
  } catch (error) {
    console.error("Delete image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete image",
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
    const { title, event_info } = body

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Build update query dynamically based on provided fields
    const updates: string[] = []
    const args: any[] = []

    if (title !== undefined) {
      updates.push("title = ?")
      args.push(title || null)
    }

    if (event_info !== undefined) {
      updates.push("event_info = ?")
      args.push(event_info || null)
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      )
    }

    updates.push("updated_at = ?")
    args.push(now)
    args.push(id) // For WHERE clause

    await db.execute({
      sql: `UPDATE images SET ${updates.join(", ")} WHERE id = ?`,
      args,
    })

    // Fetch updated image
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, event_info, format,
          width, height, file_size, original_filename,
          created_at, updated_at
        FROM images
        WHERE id = ?
      `,
      args: [id],
    })

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

