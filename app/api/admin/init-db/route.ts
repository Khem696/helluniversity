import { NextResponse } from "next/server"
import { initializeDatabase } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

/**
 * Database Initialization Route
 * 
 * Initializes the database schema (creates tables if they don't exist).
 * Safe to call multiple times.
 * 
 * POST requires Google Workspace authentication
 * GET is public (for status checking)
 */

export async function POST() {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/init-db')
    
    await logger.info('Database initialization request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Database initialization rejected: authentication failed')
        return unauthorizedResponse("Authentication required")
      }
      await logger.warn('Database initialization rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }
    
    await logger.info('Initializing database')
    // Enable orphaned image cleanup to sync database with blob storage
    await initializeDatabase({ cleanupOrphanedImages: true })
    
    await logger.info('Database initialized successfully')
    
    return successResponse(
      {
        message: "Database initialized successfully",
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/init-db' })
}

/**
 * GET endpoint to check database status
 */
export async function GET() {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/init-db')
    
    await logger.info('Database status check request received')
    
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        await logger.warn('Database status check rejected: authentication failed')
        return unauthorizedResponse("Authentication required")
      }
      await logger.warn('Database status check rejected: authorization failed')
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }
    
    const { getTursoClient } = await import("@/lib/turso")
    const db = getTursoClient()
    
    // Check if all required tables exist
    const requiredTables = [
      'images',
      'events',
      'rate_limits',
      'bookings',
      'booking_status_history',
      'admin_actions',
      'event_images',
      'email_queue',
      'email_sent_log',
      'email_event_log'
    ]
    
    // SQLite IN clause with string literals
    const tableNames = requiredTables.map(name => `'${name}'`).join(', ')
    const result = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN (${tableNames})
    `)
    
    const existingTables = result.rows.map((row: any) => row.name)
    const tablesStatus: Record<string, boolean> = {}
    
    requiredTables.forEach(table => {
      tablesStatus[table] = existingTables.includes(table)
    })
    
    const allTablesExist = existingTables.length === requiredTables.length
    const missingTables = requiredTables.filter(table => !existingTables.includes(table))
    
    await logger.info('Database status checked', {
      allTablesExist,
      missingTablesCount: missingTables.length
    })
    
    return successResponse(
      {
        tables: tablesStatus,
        allTablesExist,
        missingTables,
      },
      { requestId }
    )
  }, { endpoint: '/api/admin/init-db' })
}

