import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"

/**
 * Public Images API
 * 
 * GET /api/images
 * - Get images by category, sorted by display_order
 * - Public endpoint (no authentication required)
 * 
 * Query parameters:
 * - category: Filter by category (artwork_studio, building_studio, gallery, aispace_studio)
 * - limit: Number of images to return (default: 100)
 */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")
    const limit = parseInt(searchParams.get("limit") || "100")

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category parameter is required" },
        { status: 400 }
      )
    }

    const db = getTursoClient()

    // Get images by category, ordered by display_order
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, category, display_order, format,
          width, height, created_at
        FROM images
        WHERE category = ?
        ORDER BY display_order ASC, created_at ASC
        LIMIT ?
      `,
      args: [category, limit],
    })

    return NextResponse.json({
      success: true,
      images: result.rows,
      count: result.rows.length,
    })
  } catch (error) {
    console.error("Get images error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get images",
      },
      { status: 500 }
    )
  }
}

