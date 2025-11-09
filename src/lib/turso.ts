import { createClient } from "@libsql/client"

/**
 * Turso Database Client
 * 
 * Provides a singleton database client for Turso SQLite.
 * Works with both local development (file-based) and production (remote).
 * 
 * Environment Variables:
 * - TURSO_DATABASE_URL: Database URL (libsql:// or file://)
 * - TURSO_AUTH_TOKEN: Authentication token (required for remote)
 */

let client: ReturnType<typeof createClient> | null = null

/**
 * Get or create the Turso database client
 */
export function getTursoClient() {
  if (client) {
    return client
  }

  const databaseUrl = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!databaseUrl) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. " +
      "Please set it in your environment variables. " +
      "For local development, use: file:./local.db " +
      "For production, use your Turso database URL (libsql://...)"
    )
  }

  // For local development, use file-based SQLite
  // For production, use remote Turso with auth token
  if (databaseUrl.startsWith("file:")) {
    client = createClient({
      url: databaseUrl,
    })
  } else {
    if (!authToken) {
      throw new Error(
        "TURSO_AUTH_TOKEN is required for remote Turso databases. " +
        "Please set it in your environment variables."
      )
    }

    client = createClient({
      url: databaseUrl,
      authToken: authToken,
    })
  }

  return client
}

/**
 * Execute a database query with error handling
 */
export async function dbQuery<T = any>(
  sql: string,
  args?: any[]
): Promise<{ rows: T[]; rowsAffected: number }> {
  const db = getTursoClient()
  
  try {
    if (args && args.length > 0) {
      const result = await db.execute({
        sql,
        args: args as any,
      })
      return {
        rows: result.rows as T[],
        rowsAffected: result.rowsAffected,
      }
    } else {
      const result = await db.execute(sql)
      return {
        rows: result.rows as T[],
        rowsAffected: result.rowsAffected,
      }
    }
  } catch (error) {
    console.error("Database query error:", error)
    throw error
  }
}

/**
 * Execute a transaction
 */
export async function dbTransaction<T>(
  callback: (tx: ReturnType<typeof createClient>) => Promise<T>
): Promise<T> {
  const db = getTursoClient()
  
  try {
    return await db.transaction(callback)
  } catch (error) {
    console.error("Database transaction error:", error)
    throw error
  }
}

/**
 * Initialize database schema (run migrations)
 * Safe to call multiple times - checks if tables exist first
 */
export async function initializeDatabase(): Promise<void> {
  const db = getTursoClient()

  try {
    // Check if tables already exist
    const checkTables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('images', 'events', 'rate_limits')
    `)

    const existingTables = new Set(
      checkTables.rows.map((row: any) => row.name)
    )

    // Create images table
    if (!existingTables.has("images")) {
      await db.execute(`
        CREATE TABLE images (
          id TEXT PRIMARY KEY,
          blob_url TEXT NOT NULL,
          title TEXT,
          event_info TEXT,
          format TEXT DEFAULT 'webp',
          width INTEGER,
          height INTEGER,
          file_size INTEGER,
          original_filename TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `)
      console.log("✓ Created images table")
    }

    // Create events table
    if (!existingTables.has("events")) {
      await db.execute(`
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          image_id TEXT,
          event_date INTEGER,
          location TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
        )
      `)
      console.log("✓ Created events table")
    }

    // Create rate_limits table for rate limiting
    if (!existingTables.has("rate_limits")) {
      await db.execute(`
        CREATE TABLE rate_limits (
          identifier TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          count INTEGER DEFAULT 1,
          window_start INTEGER NOT NULL,
          PRIMARY KEY (identifier, endpoint, window_start)
        )
      `)
      
      // Create index for faster lookups
      await db.execute(`
        CREATE INDEX idx_rate_limits_lookup 
        ON rate_limits(identifier, endpoint, window_start)
      `)
      console.log("✓ Created rate_limits table")
    }

    console.log("✓ Database initialization complete")
  } catch (error) {
    console.error("Database initialization error:", error)
    throw error
  }
}


