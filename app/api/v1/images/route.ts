/**
 * Images API v1
 * 
 * Versioned endpoint for public images
 * 
 * GET /api/v1/images - Get images by category, sorted by display_order
 * - Public endpoint (no authentication required)
 * 
 * Query parameters:
 * - category: Filter by category (artwork_studio, building_studio, gallery, aispace_studio)
 * - limit: Number of images to return (default: 100)
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Get images request received')
    
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")
    // CRITICAL: Validate and clamp limit to prevent DoS
    const rawLimit = parseInt(searchParams.get("limit") || "100")
    const limit = isNaN(rawLimit) ? 100 : Math.max(1, Math.min(1000, rawLimit))

    if (!category) {
      await logger.warn('Get images rejected: missing category parameter')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Category parameter is required",
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.debug('Get images parameters', { category, limit })

    const db = getTursoClient()

    // Get images by category, ordered by display_order
    const result = await db.execute({
      sql: `
        SELECT 
          id, blob_url, title, category, display_order, ai_selected, format,
          width, height, created_at
        FROM images
        WHERE category = ?
        ORDER BY display_order ASC, created_at ASC
        LIMIT ?
      `,
      args: [category, limit],
    })
    
    await logger.info('Images retrieved', { 
      category, 
      count: result.rows.length,
      limit 
    })

    return successResponse(
      {
        images: result.rows,
        count: result.rows.length,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

