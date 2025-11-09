import { NextResponse } from "next/server"
import { initializeDatabase } from "@/lib/turso"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"

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
  try {
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        return unauthorizedResponse("Authentication required")
      }
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }
    await initializeDatabase()
    
    return NextResponse.json({
      success: true,
      message: "Database initialized successfully",
    })
  } catch (error) {
    console.error("Database initialization error:", error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to initialize database",
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check database status
 */
export async function GET() {
  try {
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
      'event_images'
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
    
    return NextResponse.json({
      success: true,
      tables: tablesStatus,
      allTablesExist: existingTables.length === requiredTables.length,
      missingTables: requiredTables.filter(table => !existingTables.includes(table)),
    })
  } catch (error) {
    console.error("Database status check error:", error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check database status",
      },
      { status: 500 }
    )
  }
}

