import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, unauthorizedResponse, forbiddenResponse } from "@/lib/api-response"
import { requireAuthorizedDomain } from "@/lib/auth"

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

/**
 * Admin Settings API
 * 
 * GET /api/admin/settings - Get all settings or a specific setting
 * PATCH /api/admin/settings - Update a setting value
 */

export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/settings')
    
    await logger.info('Get settings request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Get settings request rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get("key")

    const db = getTursoClient()

    // Check if settings table exists
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length === 0) {
      await logger.warn('Settings table does not exist')
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        'Settings table does not exist. Please initialize the database first.',
        undefined,
        404,
        { requestId }
      )
    }

    if (key) {
      // Get specific setting
      const result = await db.execute({
        sql: `SELECT key, value, description, updated_at, updated_by FROM settings WHERE key = ?`,
        args: [key],
      })

      if (result.rows.length === 0) {
        await logger.warn('Setting not found', { key })
        return errorResponse(
          ErrorCodes.NOT_FOUND,
          `Setting '${key}' not found`,
          undefined,
          404,
          { requestId }
        )
      }

      const setting = result.rows[0] as any
      await logger.info('Setting retrieved', { key })

      return successResponse(
        {
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updated_at: setting.updated_at,
          updated_by: setting.updated_by,
        },
        { requestId }
      )
    } else {
      // Get all settings
      const result = await db.execute({
        sql: `SELECT key, value, description, updated_at, updated_by FROM settings ORDER BY key`,
        args: [],
      })

      await logger.info('All settings retrieved', { count: result.rows.length })

      return successResponse(
        {
          settings: result.rows.map((row: any) => ({
            key: row.key,
            value: row.value,
            description: row.description,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
          })),
        },
        { requestId }
      )
    }
  }, { endpoint: '/api/admin/settings' })
}

export async function PATCH(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/settings')
    
    await logger.info('Update setting request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Update setting request rejected: authentication failed')
      return authError
    }

    const body = await request.json()
    const { key, value } = body

    if (!key || value === undefined) {
      await logger.warn('Update setting rejected: missing key or value')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Key and value are required",
        undefined,
        400,
        { requestId }
      )
    }

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Get session for updated_by
    const { auth } = await import("@/lib/auth-config")
    const session = await auth()
    const updatedBy = session?.user?.email || session?.user?.name || "system"

    // Check if settings table exists
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length === 0) {
      await logger.warn('Settings table does not exist')
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        'Settings table does not exist. Please initialize the database first.',
        undefined,
        404,
        { requestId }
      )
    }

    // Check if setting exists
    const existing = await db.execute({
      sql: `SELECT key FROM settings WHERE key = ?`,
      args: [key],
    })

    if (existing.rows.length === 0) {
      await logger.warn('Setting not found', { key })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        `Setting '${key}' not found`,
        undefined,
        404,
        { requestId }
      )
    }

    // Update setting
    await db.execute({
      sql: `UPDATE settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?`,
      args: [String(value), now, updatedBy, key],
    })

    await logger.info('Setting updated', { key, value, updatedBy })

    // Return updated setting
    const result = await db.execute({
      sql: `SELECT key, value, description, updated_at, updated_by FROM settings WHERE key = ?`,
      args: [key],
    })

    const setting = result.rows[0] as any

    return successResponse(
      {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        updated_at: setting.updated_at,
        updated_by: setting.updated_by,
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/settings' })
}

