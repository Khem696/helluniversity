/**
 * Admin Cleanup Orphaned Deposit Blobs API v1
 *
 * Versioned endpoint for batch cleanup of orphaned deposit blobs
 * Maintains backward compatibility with /api/admin/cleanup-orphaned-deposits
 *
 * POST /api/v1/admin/cleanup-orphaned-deposits - Cleanup orphaned deposit blobs
 */

import { NextResponse } from "next/server"
import { cleanupOrphanedDepositBlobs } from "@/lib/deposit-cleanup"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Cleanup Orphaned Deposit Blobs
 * 
 * Removes deposit evidence blobs from Vercel Blob Storage that are not referenced in the bookings table
 * 
 * POST /api/admin/cleanup-orphaned-deposits
 * - Lists all blobs with "deposit-" prefix from Blob Storage
 * - Checks if each blob URL exists in bookings.deposit_evidence_url
 * - Deletes blobs that are not referenced in database
 * - Requires Google Workspace authentication
 */

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Cleanup orphaned deposit blobs request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Cleanup orphaned deposit blobs rejected: authentication failed')
        return unauthorizedResponse("Authentication required", { requestId })
      }
      await logger.warn('Cleanup orphaned deposit blobs rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
    }

    // Run cleanup using shared function
    const results = await cleanupOrphanedDepositBlobs(logger)
    
    return successResponse(
      {
        message: `Cleanup completed: ${results.deleted} orphaned deposit blobs deleted out of ${results.checked} checked`,
        stats: {
          checked: results.checked,
          orphaned: results.orphaned,
          deleted: results.deleted,
          errors: results.errors.length,
        },
        errors: results.errors.length > 0 ? results.errors.slice(0, 50) : undefined, // Limit to first 50 errors
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

