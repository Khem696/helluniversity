import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { randomUUID } from "crypto"

/**
 * Admin Events CRUD API
 * 
 * POST /api/admin/events - Create event
 * GET /api/admin/events - List events
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

export async function POST(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError
    const body = await request.json()
    const { title, description, image_id, event_date, location } = body

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      )
    }

    const db = getTursoClient()
    const eventId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Convert event_date to Unix timestamp if provided as ISO string
    const eventTimestamp = event_date
      ? typeof event_date === "string"
        ? Math.floor(new Date(event_date).getTime() / 1000)
        : event_date
      : null

    await db.execute({
      sql: `
        INSERT INTO events (
          id, title, description, image_id, event_date,
          location, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        eventId,
        title,
        description || null,
        image_id || null,
        eventTimestamp,
        location || null,
        now,
        now,
      ],
    })

    // Fetch created event with image data
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
      args: [eventId],
    })

    return NextResponse.json({
      success: true,
      event: result.rows[0],
    })
  } catch (error) {
    console.error("Create event error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create event",
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const authError = await checkAuth()
    if (authError) return authError
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const upcoming = searchParams.get("upcoming") === "true"

    const db = getTursoClient()

    // Build query
    let whereClause = ""
    const args: any[] = []

    if (upcoming) {
      const now = Math.floor(Date.now() / 1000)
      whereClause = "WHERE e.event_date >= ?"
      args.push(now)
    }

    // Get total count
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM events e ${whereClause}`,
      args: upcoming ? args : [],
    })
    const total = (countResult.rows[0] as any).count

    // Get events
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, e.title, e.description, e.image_id, e.event_date,
          e.location, e.created_at, e.updated_at,
          i.blob_url as image_url, i.title as image_title
        FROM events e
        LEFT JOIN images i ON e.image_id = i.id
        ${whereClause}
        ORDER BY e.event_date ASC, e.created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...(upcoming ? args : []), limit, offset],
    })

    return NextResponse.json({
      success: true,
      events: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error("List events error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list events",
      },
      { status: 500 }
    )
  }
}

