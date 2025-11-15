import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { processAndUploadImage, validateImageFile } from "@/lib/image-processor"
import { requireAuthorizedDomain } from "@/lib/auth"
import { randomUUID } from "crypto"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

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
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images')
    
    await logger.info('Admin image upload request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Admin image upload rejected: authentication failed')
        return unauthorizedResponse("Authentication required", { requestId })
      }
      await logger.warn('Admin image upload rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
    }
    
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const title = formData.get("title") as string | null
    const eventInfo = formData.get("event_info") as string | null
    const category = formData.get("category") as string | null
    const displayOrder = formData.get("display_order") as string | null

    if (!file) {
      await logger.warn('Admin image upload rejected: no file provided')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No file provided",
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.info('Image file received', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      category: category || undefined
    })

    // Validate image file
    const validation = validateImageFile(file)
    if (!validation.valid) {
      await logger.warn('Admin image upload rejected: invalid file', { error: validation.error })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        validation.error || "Invalid image file",
        undefined,
        400,
        { requestId }
      )
    }

    // Process and upload image (converts to WebP)
    await logger.info('Processing and uploading image')
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
    
    await logger.info('Image processed and uploaded', {
      imageUrl: processed.url,
      width: processed.width,
      height: processed.height,
      format: processed.format
    })

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
    
    await logger.info('Image metadata saved to database', { imageId, category: category || undefined })

    return successResponse(
      {
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
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/images' })
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
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images')
    
    await logger.info('Admin images list request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Admin images list rejected: authentication failed')
        return unauthorizedResponse("Authentication required", { requestId })
      }
      await logger.warn('Admin images list rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
    }
    
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const category = searchParams.get("category") || null
    const title = searchParams.get("title") || undefined
    const sortBy = (searchParams.get("sortBy") as "created_at" | "updated_at" | "display_order" | "title") || undefined
    const sortOrder = (searchParams.get("sortOrder") as "ASC" | "DESC") || undefined
    
    await logger.debug('List images parameters', { 
      limit, 
      offset, 
      category: category || undefined,
      hasTitle: !!title,
      sortBy,
      sortOrder
    })

    const db = getTursoClient()

    // Build WHERE clause
    const conditions: string[] = []
    const args: any[] = []

    // Exclude images that are linked to events (poster or in-event photos)
    // These images are managed in the Admin Events page, not the Admin Images page
    // Poster images: linked via events.image_id
    // In-event photos: linked via event_images.image_id
    // Note: Orphaned event images are automatically cleaned up when deleted/replaced
    conditions.push(`i.id NOT IN (
      SELECT DISTINCT image_id FROM events WHERE image_id IS NOT NULL
      UNION
      SELECT DISTINCT image_id FROM event_images WHERE image_id IS NOT NULL
    )`)

    if (category) {
      // Uses idx_images_category_order for category filtering
      conditions.push("i.category = ?")
      args.push(category)
    }

    if (title) {
      // Title search (prefix search for better performance)
      conditions.push("i.title LIKE ?")
      args.push(`${title}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    // Get total count
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM images i ${whereClause}`,
      args,
    })
    const total = (countResult.rows[0] as any).count

    // Optimize ORDER BY based on user preferences
    // Default: Sort by category, then display_order, then created_at (uses idx_images_category_order)
    let orderByClause = ""
    if (sortBy) {
      const order = sortOrder || "DESC"
      if (sortBy === "title") {
        // Title sorting (alphabetical)
        orderByClause = `ORDER BY i.title ${order}, i.created_at DESC`
      } else if (sortBy === "created_at" || sortBy === "updated_at") {
        // Timestamp sorting
        orderByClause = `ORDER BY i.${sortBy} ${order}`
      } else if (sortBy === "display_order") {
        // Display order sorting - if category filter, uses idx_images_category_order
        if (category) {
          orderByClause = `ORDER BY i.display_order ${order}, i.created_at DESC`
        } else {
          orderByClause = `ORDER BY i.category ASC, i.display_order ${order}, i.created_at DESC`
        }
      } else {
        // Fallback to default
        orderByClause = `ORDER BY i.category ASC, i.display_order ASC, i.created_at DESC`
      }
    } else {
      // Default: Sort by category, then display_order, then created_at
      // Uses idx_images_category_order composite index
      orderByClause = `ORDER BY i.category ASC, i.display_order ASC, i.created_at DESC`
    }

    // Get images (exclude event images)
    const result = await db.execute({
      sql: `
        SELECT 
          i.id, i.blob_url, i.title, i.event_info, i.category, i.display_order, i.ai_selected, i.ai_order, i.format,
          i.width, i.height, i.file_size, i.original_filename,
          i.created_at, i.updated_at
        FROM images i
        ${whereClause}
        ${orderByClause}
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    })
    
    await logger.info('Images list retrieved', {
      count: result.rows.length,
      total,
      category: category || undefined
    })

    return successResponse(
      {
        images: result.rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/images' })
}

