import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

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

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images/toggle-ai-selection')
    
    await logger.info('Admin toggle AI selection request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin toggle AI selection rejected: authentication failed')
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10240) // 10KB limit for toggle AI selection data
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }
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
    // Order by display_order first (visual order), then ai_order, then created_at
    // This ensures ai_order matches the visual order after drag-and-drop
    // Exclude event images (managed in Admin Events page)
    // Poster images: linked via events.image_id
    // In-event photos: linked via event_images.image_id
    const selectedImages = await db.execute({
      sql: `
        SELECT id, ai_order, display_order, created_at
        FROM images
        WHERE category = 'aispace_studio' 
          AND ai_selected = 1
          AND id NOT IN (
            SELECT DISTINCT image_id FROM events WHERE image_id IS NOT NULL
            UNION
            SELECT DISTINCT image_id FROM event_images WHERE image_id IS NOT NULL
          )
        ORDER BY display_order ASC, ai_order ASC, created_at ASC
      `,
      args: [],
    })

    // Automatically reorder all selected images (1, 2, 3, ...) based on display_order
    // This ensures ai_order matches the visual order
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

