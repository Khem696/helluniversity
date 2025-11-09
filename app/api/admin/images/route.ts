import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { processAndUploadImage, validateImageFile } from "@/lib/image-processor"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { randomUUID } from "crypto"

/**
 * Admin Image Upload API
 * 
 * POST /api/admin/images
 * - Uploads an image, converts to WebP, stores in Vercel Blob, saves metadata to Turso
 * - Requires Google Workspace authentication
 * 
 * Body (FormData):
 * - file: Image file (File)
 * - title: Optional title (string)
 * - event_info: Optional event information (string)
 */

export async function POST(request: Request) {
  try {
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        return unauthorizedResponse("Authentication required")
      }
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const title = formData.get("title") as string | null
    const eventInfo = formData.get("event_info") as string | null
    const category = formData.get("category") as string | null
    const displayOrder = formData.get("display_order") as string | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      )
    }

    // Validate image file
    const validation = validateImageFile(file)
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      )
    }

    // Process and upload image (converts to WebP)
    const processed = await processAndUploadImage(
      file,
      file.name,
      {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 85,
        format: "webp",
      }
    )

    // Save metadata to database
    const db = getTursoClient()
    const imageId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Get max display_order for this category if not provided
    let finalDisplayOrder = displayOrder ? parseInt(displayOrder) : null
    if (finalDisplayOrder === null && category) {
      const maxResult = await db.execute({
        sql: `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM images WHERE category = ?`,
        args: [category],
      })
      finalDisplayOrder = (maxResult.rows[0] as any).next_order
    } else if (finalDisplayOrder === null) {
      finalDisplayOrder = 0
    }

    await db.execute({
      sql: `
        INSERT INTO images (
          id, blob_url, title, event_info, category, display_order, format, 
          width, height, file_size, original_filename, 
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        imageId,
        processed.url,
        title || null,
        eventInfo || null,
        category || null,
        finalDisplayOrder,
        processed.format,
        processed.width,
        processed.height,
        processed.fileSize,
        file.name,
        now,
        now,
      ],
    })

    return NextResponse.json({
      success: true,
      image: {
        id: imageId,
        url: processed.url,
        pathname: processed.pathname,
        title: title || null,
        event_info: eventInfo || null,
        category: category || null,
        display_order: finalDisplayOrder,
        width: processed.width,
        height: processed.height,
        file_size: processed.fileSize,
        format: processed.format,
        created_at: now,
      },
    })
  } catch (error) {
    console.error("Image upload error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to upload image",
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/images
 * - List all images with pagination
 * 
 * Query parameters:
 * - limit: Number of images to return (default: 50)
 * - offset: Offset for pagination (default: 0)
 */
export async function GET(request: Request) {
  try {
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        return unauthorizedResponse("Authentication required")
      }
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const category = searchParams.get("category") || null

    const db = getTursoClient()

    // Build WHERE clause
    const whereClause = category ? "WHERE category = ?" : ""
    const countArgs = category ? [category] : []

    // Get total count
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM images ${whereClause}`,
      args: countArgs,
    })
    const total = (countResult.rows[0] as any).count

    // Get images - order by category, then display_order, then created_at
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, event_info, category, display_order, format,
          width, height, file_size, original_filename,
          created_at, updated_at
        FROM images
        ${whereClause}
        ORDER BY category ASC, display_order ASC, created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...countArgs, limit, offset],
    })

    return NextResponse.json({
      success: true,
      images: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error("List images error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list images",
      },
      { status: 500 }
    )
  }
}

