/**
 * Action Locks API
 * 
 * GET /api/v1/admin/action-locks - Get all active locks for bookings
 * GET /api/v1/admin/action-locks?bookingId=xxx - Get locks for specific booking
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { requireAuthorizedDomain } from "@/lib/auth"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, unauthorizedResponse, forbiddenResponse } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { createRequestLogger } from "@/lib/logger"
import { getResourceLocks, isActionLocked, type ResourceType } from "@/lib/action-lock"

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

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Get action locks request')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Get action locks rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    const resourceType = searchParams.get('resourceType') as ResourceType | null
    const resourceId = searchParams.get('resourceId')
    const action = searchParams.get('action')
    
    // Backward compatibility: support bookingId parameter
    const bookingId = searchParams.get('bookingId')
    const finalResourceType = resourceType || (bookingId ? 'booking' : null)
    const finalResourceId = resourceId || bookingId

    if (finalResourceType && finalResourceId && action) {
      // Check if specific action is locked
      const lockStatus = await isActionLocked(finalResourceType, finalResourceId, action)
      return successResponse({ lockStatus }, { requestId })
    } else if (finalResourceType && finalResourceId) {
      // Get all locks for a resource
      const locks = await getResourceLocks(finalResourceType, finalResourceId)
      return successResponse({ locks }, { requestId })
    } else {
      // Get all active locks (for admin dashboard)
      const db = getTursoClient()
      const now = Math.floor(Date.now() / 1000)
      
      const result = await db.execute({
        sql: `
          SELECT * FROM action_locks 
          WHERE expires_at > ? 
          ORDER BY locked_at DESC
        `,
        args: [now],
      })
      
      const locks = result.rows.map((row: any) => ({
        id: row.id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        action: row.action,
        adminEmail: row.admin_email,
        adminName: row.admin_name || undefined,
        lockedAt: row.locked_at,
        expiresAt: row.expires_at,
      }))
      
      return successResponse({ locks }, { requestId })
    }
  }, { endpoint: getRequestPath(request) })
})

