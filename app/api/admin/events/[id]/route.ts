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

    // Get event with poster image
    const eventResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [id],
    })

    if (eventResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found" },
        { status: 404 }
      )
    }

    // Get in-event photos
    const inEventPhotos = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.image_id, ei.display_order,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.event_id = ? AND ei.image_type = 'in_event'
        ORDER BY ei.display_order ASC
      `,
      args: [id],
    })

    return NextResponse.json({
      success: true,
      event: {
        ...eventResult.rows[0],
        in_event_photos: inEventPhotos.rows,
      },
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
    const { title, description, image_id, event_date, start_date, end_date, location } = body

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

    const convertToTimestamp = (date: string | number | null | undefined): number | null => {
      if (date === undefined) return undefined as any
      if (!date) return null
      if (typeof date === "number") return date
      return Math.floor(new Date(date).getTime() / 1000)
    }

    if (event_date !== undefined) {
      updates.push("event_date = ?")
      args.push(convertToTimestamp(event_date))
    }

    if (start_date !== undefined) {
      updates.push("start_date = ?")
      args.push(convertToTimestamp(start_date))
    }

    if (end_date !== undefined) {
      updates.push("end_date = ?")
      args.push(convertToTimestamp(end_date))
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

    // Fetch updated event with poster image
    const eventResult = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.start_date, e.end_date, e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        WHERE e.id = ?
      `,
      args: [id],
    })

    // Get in-event photos
    const inEventPhotos = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.image_id, ei.display_order,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.event_id = ? AND ei.image_type = 'in_event'
        ORDER BY ei.display_order ASC
      `,
      args: [id],
    })

    return NextResponse.json({
      success: true,
      event: {
        ...eventResult.rows[0],
        in_event_photos: inEventPhotos.rows,
      },
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

