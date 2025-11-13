import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { deleteImageWithMetadata } from "@/lib/blob"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Admin Image Update API
 * 
 * PATCH /api/admin/images/[id]
 * - Update image metadata (category, display_order, title, etc.)
 * - Requires Google Workspace authentication
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images/[id]')
    
    await logger.info('Admin image update request', { imageId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin image update rejected: authentication failed', { imageId: id })
      return authError
    }

    const body = await request.json()
    const { category, display_order, title, event_info, ai_selected, ai_order } = body
    
    await logger.debug('Image update data', {
      imageId: id,
      hasCategory: category !== undefined,
      hasDisplayOrder: display_order !== undefined,
      hasTitle: title !== undefined,
      hasAiSelected: ai_selected !== undefined
    })

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Build update fields
    const updates: string[] = ["updated_at = ?"]
    const args: any[] = [now]

    if (category !== undefined) {
      updates.push("category = ?")
      args.push(category)
    }

    if (display_order !== undefined) {
      updates.push("display_order = ?")
      args.push(parseInt(String(display_order)))
    }

    if (title !== undefined) {
      updates.push("title = ?")
      args.push(title)
    }

    if (event_info !== undefined) {
      updates.push("event_info = ?")
      args.push(event_info)
    }

    if (ai_selected !== undefined) {
      updates.push("ai_selected = ?")
      args.push(ai_selected ? 1 : 0)
    }

    if (ai_order !== undefined) {
      updates.push("ai_order = ?")
      args.push(ai_order !== null ? parseInt(String(ai_order)) : null)
    }

    if (updates.length === 1) {
      // Only updated_at, nothing to update
      await logger.warn('Image update rejected: no fields to update', { imageId: id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No fields to update",
        undefined,
        400,
        { requestId }
      )
    }

    args.push(id)

    await db.execute({
      sql: `UPDATE images SET ${updates.join(", ")} WHERE id = ?`,
      args,
    })

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
      args: [id],
    })

    if (result.rows.length === 0) {
      await logger.warn('Image update failed: image not found', { imageId: id })
      return notFoundResponse('Image', { requestId })
    }

    await logger.info('Image update completed successfully', { imageId: id })
    
    return successResponse(
      {
        image: result.rows[0],
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/images/[id]' })
}

/**
 * DELETE /api/admin/images/[id]
 * - Delete image from both Blob Storage and database
 * - Re-sequences display_order for remaining images in the same category
 * - Re-sequences ai_order if the deleted image was selected for AI generation
 * - Requires Google Workspace authentication
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/images/[id]')
    
    await logger.info('Admin image delete request', { imageId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin image delete rejected: authentication failed', { imageId: id })
      return authError
    }

    const db = getTursoClient()

    // Get image details before deletion (for re-sequencing)
    const imageResult = await db.execute({
      sql: `
        SELECT category, display_order, ai_selected, ai_order, blob_url
        FROM images
        WHERE id = ?
      `,
      args: [id],
    })

    if (imageResult.rows.length === 0) {
      await logger.warn('Image delete failed: image not found', { imageId: id })
      return notFoundResponse('Image', { requestId })
    }

    const image = imageResult.rows[0] as any
    const category = image.category
    const displayOrder = image.display_order
    const wasAISelected = image.ai_selected === 1
    const aiOrder = image.ai_order
    const blobUrl = image.blob_url

    await logger.info('Deleting image', { imageId: id, category, blobUrl })

    // Delete from both Blob Storage and database
    try {
      await deleteImageWithMetadata(id)
      await logger.info('Image blob deleted successfully', { imageId: id })
    } catch (error) {
      // Check if error is "image not found" - return 404
      if (error instanceof Error && error.message.includes("not found")) {
        await logger.warn('Image blob not found during deletion', { imageId: id })
        return notFoundResponse('Image', { requestId })
      }
      
      // If blob deletion fails, still try to delete from database
      // Log the error but continue with database cleanup
      await logger.error('Error deleting image blob (continuing with database cleanup)', error instanceof Error ? error : new Error(String(error)), { imageId: id })
      
      // Try to delete from database anyway
      try {
        const deleteResult = await db.execute({
          sql: "DELETE FROM images WHERE id = ?",
          args: [id],
        })
        
        // Check if any rows were deleted
        if (deleteResult.rowsAffected === 0) {
          await logger.warn('Image not found in database', { imageId: id })
          return notFoundResponse('Image', { requestId })
        }
        await logger.info('Image deleted from database (blob deletion failed)', { imageId: id })
      } catch (dbError) {
        await logger.error('Database deletion also failed', dbError instanceof Error ? dbError : new Error(String(dbError)), { imageId: id })
        throw dbError
      }
    }

    // Re-sequence display_order for remaining images in the same category
    if (category && displayOrder !== null) {
      await db.execute({
        sql: `
          UPDATE images
          SET display_order = display_order - 1
          WHERE category = ? AND display_order > ?
        `,
        args: [category, displayOrder],
      })
      await logger.debug('Re-sequenced display_order', { category, displayOrder })
    }

    // Re-sequence ai_order if the deleted image was selected for AI generation
    if (wasAISelected && category === "aispace_studio" && aiOrder !== null) {
      // Get all remaining selected images ordered by ai_order
      const remainingSelected = await db.execute({
        sql: `
          SELECT id FROM images
          WHERE category = 'aispace_studio' AND ai_selected = 1
          ORDER BY ai_order ASC, display_order ASC, created_at ASC
        `,
        args: [],
      })

      // Re-sequence ai_order (1, 2, 3, ...)
      for (let i = 0; i < remainingSelected.rows.length; i++) {
        const imgId = (remainingSelected.rows[i] as any).id
        await db.execute({
          sql: `UPDATE images SET ai_order = ? WHERE id = ?`,
          args: [i + 1, imgId],
        })
      }
      await logger.debug('Re-sequenced ai_order', { remainingCount: remainingSelected.rows.length })
    }

    await logger.info('Image deleted successfully', { imageId: id })

    return successResponse(
      {
        message: "Image deleted successfully",
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/images/[id]' })
}
