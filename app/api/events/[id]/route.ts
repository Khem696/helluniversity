import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"

/**
 * Public Event Details API
 * 
 * GET /api/events/[id]
 * - Get event details with poster and in-event photos
 * - Public endpoint (no authentication required)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

