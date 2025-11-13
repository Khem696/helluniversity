import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { imageExists } from "@/lib/blob"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Cleanup Orphaned Image Records
 * 
 * Removes database records where the blob_url no longer exists in Blob Storage
 * 
 * POST /api/admin/cleanup-orphaned-images
 * - Checks all images in database
 * - Verifies blob files exist
 * - Deletes records where blob files are missing
 * - Requires Google Workspace authentication
 */

export async function POST() {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/cleanup-orphaned-images')
    
    await logger.info('Cleanup orphaned images request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Cleanup orphaned images rejected: authentication failed')
        return unauthorizedResponse("Authentication required", { requestId })
      }
      await logger.warn('Cleanup orphaned images rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
    }

    const db = getTursoClient()
    const results = {
      checked: 0,
      orphaned: 0,
      deleted: 0,
      errors: [] as string[],
    }

    // Get all images from database
    const allImages = await db.execute({
      sql: `SELECT id, blob_url, original_filename FROM images`,
    })

    results.checked = allImages.rows.length

    for (const image of allImages.rows) {
      const img = image as any
      const blobUrl = img.blob_url

      if (!blobUrl) {
        // No blob URL - consider it orphaned
        try {
          await db.execute({
            sql: `DELETE FROM images WHERE id = ?`,
            args: [img.id],
          })
          results.orphaned++
          results.deleted++
          await logger.debug(`Deleted record with no blob_url: ${img.original_filename || img.id}`)
        } catch (error) {
          results.errors.push(`Failed to delete ${img.id}: ${error instanceof Error ? error.message : "Unknown error"}`)
        }
        continue
      }

      // Check if blob file exists
      try {
        const exists = await imageExists(blobUrl)
        if (!exists) {
          // Blob file doesn't exist - delete the orphaned record
          try {
            await db.execute({
              sql: `DELETE FROM images WHERE id = ?`,
              args: [img.id],
            })
            results.orphaned++
            results.deleted++
            await logger.debug(`Deleted orphaned record: ${img.original_filename || img.id} (blob_url: ${blobUrl})`)
          } catch (error) {
            results.errors.push(`Failed to delete ${img.id}: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        }
      } catch (error) {
        // Error checking blob existence - assume it doesn't exist
        try {
          await db.execute({
            sql: `DELETE FROM images WHERE id = ?`,
            args: [img.id],
          })
          results.orphaned++
          results.deleted++
          await logger.debug(`Deleted record (blob check failed): ${img.original_filename || img.id}`)
        } catch (deleteError) {
          results.errors.push(`Failed to delete ${img.id}: ${error instanceof Error ? error.message : "Unknown error"}`)
        }
      }
    }

    await logger.info('Cleanup orphaned images completed', {
      checked: results.checked,
      orphaned: results.orphaned,
      deleted: results.deleted,
      errorsCount: results.errors.length
    })
    
    return successResponse(
      {
        message: `Cleanup completed: ${results.deleted} orphaned records deleted out of ${results.checked} checked`,
        stats: {
          checked: results.checked,
          orphaned: results.orphaned,
          deleted: results.deleted,
          errors: results.errors.length,
        },
        errors: results.errors.length > 0 ? results.errors : undefined,
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/cleanup-orphaned-images' })
}

