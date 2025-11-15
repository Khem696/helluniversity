import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Public Booking Status API
 * 
 * GET /api/settings/booking-enabled - Check if bookings are enabled
 * Public endpoint (no authentication required)
 */

export async function GET() {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/settings/booking-enabled')
    
    await logger.info('Booking status check request received')

    const db = getTursoClient()

    // Default to enabled if table doesn't exist or setting doesn't exist
    let enabled = true

    try {
      // Check if settings table exists
      const tableCheck = await db.execute({
        sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
        args: [],
      })

      if (tableCheck.rows.length > 0) {
        // Table exists, try to get the setting
        const result = await db.execute({
          sql: `SELECT value FROM settings WHERE key = 'bookings_enabled'`,
          args: [],
        })

        if (result.rows.length > 0) {
          const setting = result.rows[0] as any
          enabled = setting.value === '1' || setting.value === 1 || setting.value === true
        }
      } else {
        // Table doesn't exist - default to enabled
        await logger.debug('Settings table does not exist, defaulting to enabled')
      }
    } catch (error) {
      // If there's any error (e.g., table doesn't exist), default to enabled
      await logger.warn('Error checking booking status, defaulting to enabled', error instanceof Error ? error : new Error(String(error)))
      enabled = true
    }

    await logger.info('Booking status retrieved', { enabled })

    return successResponse(
      {
        enabled,
      },
      { requestId }
    )
  }, { endpoint: '/api/settings/booking-enabled' })
}

