import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Toggle AI Selection with Automatic Ordering
 * 
 * POST /api/admin/images/toggle-ai-selection
 * - Toggles ai_selected for an image
 * - Automatically manages ai_order for all selected images
 * - Requires Google Workspace authentication
 * 
 * Body:
 * - imageId: Image ID to toggle
 * - selected: true to select, false to deselect
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
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images/toggle-ai-selection')
    
    await logger.info('Admin toggle AI selection request received')
    
    const authError = await checkAuth()
    if (authError) {
      await logger.warn('Admin toggle AI selection rejected: authentication failed')
      return authError
    }

    const body = await request.json()
    const { imageId, selected } = body
    
    await logger.debug('Toggle AI selection data', { imageId, selected })

    if (!imageId) {
      await logger.warn('Toggle AI selection rejected: missing imageId')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "imageId is required",
        undefined,
        400,
        { requestId }
      )
    }

    if (typeof selected !== "boolean") {
      await logger.warn('Toggle AI selection rejected: invalid selected type', { imageId, selected })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "selected must be a boolean",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Update the image's ai_selected status
    await db.execute({
      sql: `UPDATE images SET ai_selected = ?, updated_at = ? WHERE id = ?`,
      args: [selected ? 1 : 0, now, imageId],
    })

    // Get all selected images for aispace_studio category
    const selectedImages = await db.execute({
      sql: `
        SELECT id, ai_order, display_order, created_at
        FROM images
        WHERE category = 'aispace_studio' AND ai_selected = 1
        ORDER BY ai_order ASC, display_order ASC, created_at ASC
      `,
      args: [],
    })

    // Automatically reorder all selected images (1, 2, 3, ...)
    for (let i = 0; i < selectedImages.rows.length; i++) {
      const img = selectedImages.rows[i] as any
      await db.execute({
        sql: `UPDATE images SET ai_order = ?, updated_at = ? WHERE id = ?`,
        args: [i + 1, now, img.id],
      })
    }

    // Clear ai_order for deselected images
    if (!selected) {
      await db.execute({
        sql: `UPDATE images SET ai_order = NULL, updated_at = ? WHERE id = ?`,
        args: [now, imageId],
      })
    }

    // Fetch updated image
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, event_info, category, display_order, ai_selected, ai_order, format,
          width, height, file_size, original_filename,
          created_at, updated_at
        FROM images
        WHERE id = ?
      `,
      args: [imageId],
    })

    if (result.rows.length === 0) {
      await logger.warn('Image not found', { imageId })
      return notFoundResponse('Image', { requestId })
    }
    
    await logger.info('AI selection toggled successfully', {
      imageId,
      selected,
      totalSelected: selectedImages.rows.length
    })

    return successResponse(
      {
        image: result.rows[0],
        totalSelected: selectedImages.rows.length,
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/images/toggle-ai-selection' })
}

