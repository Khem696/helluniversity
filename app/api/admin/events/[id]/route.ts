import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

/**
 * Admin Event Management API
 * 
 * GET /api/admin/events/[id] - Get event by ID
 * PATCH /api/admin/events/[id] - Update event
 * DELETE /api/admin/events/[id] - Delete event
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
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [id],
    })

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      event: result.rows[0],
    })
  } catch (error) {
    console.error("Get event error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get event",
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
    const { title, description, image_id, event_date, location } = body

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Build update query dynamically
    const updates: string[] = []
    const args: any[] = []

    if (title !== undefined) {
      updates.push("title = ?")
      args.push(title)
    }

    if (description !== undefined) {
      updates.push("description = ?")
      args.push(description || null)
    }

    if (image_id !== undefined) {
      updates.push("image_id = ?")
      args.push(image_id || null)
    }

    if (event_date !== undefined) {
      const eventTimestamp = event_date
        ? typeof event_date === "string"
          ? Math.floor(new Date(event_date).getTime() / 1000)
          : event_date
        : null
      updates.push("event_date = ?")
      args.push(eventTimestamp)
    }

    if (location !== undefined) {
      updates.push("location = ?")
      args.push(location || null)
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
      sql: `UPDATE events SET ${updates.join(", ")} WHERE id = ?`,
      args,
    })

    // Fetch updated event
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [id],
    })

    return NextResponse.json({
      success: true,
      event: result.rows[0],
    })
  } catch (error) {
    console.error("Update event error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update event",
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
    const db = getTursoClient()

    await db.execute({
      sql: "DELETE FROM events WHERE id = ?",
      args: [id],
    })

    return NextResponse.json({
      success: true,
      message: "Event deleted successfully",
    })
  } catch (error) {
    console.error("Delete event error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete event",
      },
      { status: 500 }
    )
  }
}

