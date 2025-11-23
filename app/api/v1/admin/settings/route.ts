/**
 * Admin Settings API v1
 * 
 * Versioned endpoint for admin settings
 * Maintains backward compatibility with /api/admin/settings
 * 
 * GET /api/v1/admin/settings - Get settings
 * PATCH /api/v1/admin/settings - Update settings
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, unauthorizedResponse, forbiddenResponse } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
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

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
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
  }, { endpoint: getRequestPath(request) })
})

export const PATCH = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Update setting request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Update setting request rejected: authentication failed')
      return authError
    }

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 102400) // 100KB limit for settings data
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

    // Get admin info from session
    const { auth } = await import("@/lib/auth-config")
    const session = await auth()
    const updatedBy = session?.user?.email || session?.user?.name || "system"
    const adminEmail = session?.user?.email || undefined
    const adminName = session?.user?.name || undefined

    // CRITICAL: Acquire action lock for settings updates (especially bookings_enabled)
    // Use 'dashboard' resource type with the setting key as resource ID
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        const actionType = `update_setting_${key}`
        actionLockId = await acquireActionLock('dashboard', key, actionType, adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is performing this action', {
            settingKey: key,
            action: actionType,
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            `Another admin is currently updating the "${key}" setting. Please wait a moment and try again.`,
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { settingKey: key, action: actionType, lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          settingKey: key
        })
      }
    }
    
    // Ensure lock is released even if update fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { settingKey: key, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            settingKey: key,
            lockId: actionLockId
          })
        }
      }
    }

    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)

    // Check if settings table exists
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length === 0) {
      await logger.warn('Settings table does not exist')
      await releaseLock() // CRITICAL: Release lock before returning
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
      await releaseLock() // CRITICAL: Release lock before returning
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        `Setting '${key}' not found`,
        undefined,
        404,
        { requestId }
      )
    }

    try {
      // Update setting
      await db.execute({
        sql: `UPDATE settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?`,
        args: [String(value), now, updatedBy, key],
      })

      await logger.info('Setting updated', { key, value, updatedBy })

      // Broadcast SSE event if bookings_enabled setting was updated
      if (key === 'bookings_enabled') {
        try {
          // Use relative path for dynamic import to avoid TypeScript resolution issues
          const { broadcastBookingEnabledStatus } = await import('../../settings/booking-enabled/stream/route')
          const enabled = value === '1' || value === 1 || value === true
          
          // Log before broadcast
          const streamModule = await import('../../settings/booking-enabled/stream/route')
          const clientCount = streamModule.getSSEClientCount?.() ?? 'unknown'
          await logger.info('About to broadcast booking enabled status change via SSE', { 
            enabled,
            // Get client count from the module - use nullish coalescing to distinguish between 0 and undefined
            clientCount
          })
          
          // Broadcast the change
          broadcastBookingEnabledStatus(enabled)
          
          await logger.info('Broadcasted booking enabled status change via SSE', { enabled })
        } catch (broadcastError) {
          await logger.warn('Failed to broadcast booking enabled status change', {
            error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
            stack: broadcastError instanceof Error ? broadcastError.stack : undefined
          })
          // Don't fail the request if broadcast fails
        }
      }

      // Return updated setting
      const result = await db.execute({
        sql: `SELECT key, value, description, updated_at, updated_by FROM settings WHERE key = ?`,
        args: [key],
      })

      const setting = result.rows[0] as any

      await releaseLock()

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
    } catch (error) {
      await releaseLock()
      throw error
    }
  }, { endpoint: getRequestPath(request) })
})

