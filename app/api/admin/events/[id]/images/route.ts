import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { randomUUID } from "crypto"

/**
 * Admin Event Images Management API
 * 
 * POST /api/admin/events/[id]/images - Add image to event
 * GET /api/admin/events/[id]/images - List event images
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id: eventId } = await params
    const body = await request.json()
    const { image_id, image_type = "in_event", display_order } = body

    if (!image_id) {
      return NextResponse.json(
        { success: false, error: "image_id is required" },
        { status: 400 }
      )
    }

    // Validate image_type
    if (image_type !== "poster" && image_type !== "in_event") {
      return NextResponse.json(
        { success: false, error: "image_type must be 'poster' or 'in_event'" },
        { status: 400 }
      )
    }

    const db = getTursoClient()
    const eventImageId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Get max display_order if not provided
    let finalDisplayOrder = display_order
    if (finalDisplayOrder === undefined || finalDisplayOrder === null) {
      const maxResult = await db.execute({
        sql: `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM event_images WHERE event_id = ? AND image_type = ?`,
        args: [eventId, image_type],
      })
      finalDisplayOrder = (maxResult.rows[0] as any).next_order
    }

    await db.execute({
      sql: `
        INSERT INTO event_images (
          id, event_id, image_id, image_type, display_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [eventImageId, eventId, image_id, image_type, finalDisplayOrder, now],
    })

    // Fetch created event_image with image data
    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        WHERE ei.id = ?
      `,
      args: [eventImageId],
    })

    return NextResponse.json({
      success: true,
      event_image: result.rows[0],
    })
  } catch (error) {
    console.error("Add event image error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to add event image",
      },
      { status: 500 }
    )
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await checkAuth()
    if (authError) return authError

    const { id: eventId } = await params
    const { searchParams } = new URL(request.url)
    const imageType = searchParams.get("image_type") || null

    const db = getTursoClient()

    let whereClause = "WHERE ei.event_id = ?"
    const args: any[] = [eventId]

    if (imageType) {
      whereClause += " AND ei.image_type = ?"
      args.push(imageType)
    }

    const result = await db.execute({
      sql: `
        SELECT 
          ei.id, ei.event_id, ei.image_id, ei.image_type, ei.display_order, ei.created_at,
          i.blob_url, i.title, i.width, i.height
        FROM event_images ei
        JOIN images i ON ei.image_id = i.id
        ${whereClause}
        ORDER BY ei.display_order ASC
      `,
      args,
    })

    return NextResponse.json({
      success: true,
      event_images: result.rows,
      count: result.rows.length,
    })
  } catch (error) {
    console.error("List event images error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list event images",
      },
      { status: 500 }
    )
  }
}

