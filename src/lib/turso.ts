import { createClient, type Transaction } from "@libsql/client"

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
  callback: (tx: Transaction) => Promise<T>
): Promise<T> {
  const db = getTursoClient()
  
  try {
    const tx = await db.transaction()
    try {
      const result = await callback(tx)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
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
      WHERE type='table' AND name IN (
        'images', 'events', 'rate_limits', 'bookings', 
        'booking_status_history', 'admin_actions', 'event_images', 'email_queue', 'email_sent_log'
      )
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
          category TEXT,
          display_order INTEGER DEFAULT 0,
          format TEXT DEFAULT 'webp',
          width INTEGER,
          height INTEGER,
          file_size INTEGER,
          original_filename TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      // Create index for category + display_order queries
      await db.execute(`
        CREATE INDEX idx_images_category_order 
        ON images(category, display_order)
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
          start_date INTEGER,
          end_date INTEGER,
          location TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
        )
      `)
      
      // Create index for end_date queries (for slider logic)
      await db.execute(`
        CREATE INDEX idx_events_end_date ON events(end_date)
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

    // Create bookings table for reservation management
    if (!existingTables.has("bookings")) {
      await db.execute(`
        CREATE TABLE bookings (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          participants TEXT,
          event_type TEXT NOT NULL,
          other_event_type TEXT,
          date_range INTEGER DEFAULT 0,
          start_date INTEGER NOT NULL,
          end_date INTEGER,
          start_time TEXT,
          end_time TEXT,
          organization_type TEXT,
          organized_person TEXT,
          introduction TEXT,
          biography TEXT,
          special_requests TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'postponed', 'cancelled', 'finished', 'checked-in')),
          admin_notes TEXT,
          response_token TEXT,
          token_expires_at INTEGER,
          proposed_date INTEGER,
          proposed_end_date INTEGER,
          user_response TEXT,
          response_date INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      // Create indexes for common queries
      await db.execute(`
        CREATE INDEX idx_bookings_status ON bookings(status)
      `)
      await db.execute(`
        CREATE INDEX idx_bookings_email ON bookings(email)
      `)
      await db.execute(`
        CREATE INDEX idx_bookings_start_date ON bookings(start_date)
      `)
      await db.execute(`
        CREATE INDEX idx_bookings_created_at ON bookings(created_at)
      `)
      await db.execute(`
        CREATE INDEX idx_bookings_response_token ON bookings(response_token)
      `)
      console.log("✓ Created bookings table")
    }

    // Create booking_status_history table for audit trail
    if (!existingTables.has("booking_status_history")) {
      await db.execute(`
        CREATE TABLE booking_status_history (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL,
          old_status TEXT,
          new_status TEXT NOT NULL,
          changed_by TEXT,
          change_reason TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
        )
      `)
      
      await db.execute(`
        CREATE INDEX idx_status_history_booking_id ON booking_status_history(booking_id)
      `)
      await db.execute(`
        CREATE INDEX idx_status_history_created_at ON booking_status_history(created_at)
      `)
      console.log("✓ Created booking_status_history table")
    }

    // Create admin_actions table for general admin action logging
    if (!existingTables.has("admin_actions")) {
      await db.execute(`
        CREATE TABLE admin_actions (
          id TEXT PRIMARY KEY,
          action_type TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          admin_email TEXT,
          admin_name TEXT,
          description TEXT,
          metadata TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      await db.execute(`
        CREATE INDEX idx_admin_actions_type ON admin_actions(action_type)
      `)
      await db.execute(`
        CREATE INDEX idx_admin_actions_resource ON admin_actions(resource_type, resource_id)
      `)
      await db.execute(`
        CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at)
      `)
      console.log("✓ Created admin_actions table")
    }

    // Create event_images table for multiple images per event (future in-event photos)
    if (!existingTables.has("event_images")) {
      await db.execute(`
        CREATE TABLE event_images (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          image_id TEXT NOT NULL,
          image_type TEXT DEFAULT 'poster' CHECK(image_type IN ('poster', 'in_event')),
          display_order INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
      `)
      
      await db.execute(`
        CREATE INDEX idx_event_images_event_id ON event_images(event_id)
      `)
      await db.execute(`
        CREATE INDEX idx_event_images_type ON event_images(event_id, image_type)
      `)
      console.log("✓ Created event_images table")
    }

    // Create email_queue table for failed email retry system
    if (!existingTables.has("email_queue")) {
      await db.execute(`
        CREATE TABLE email_queue (
          id TEXT PRIMARY KEY,
          email_type TEXT NOT NULL CHECK(email_type IN ('admin_notification', 'user_confirmation', 'status_change', 'user_response', 'auto_update')),
          recipient_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          html_content TEXT NOT NULL,
          text_content TEXT NOT NULL,
          metadata TEXT,
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 5,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
          error_message TEXT,
          scheduled_at INTEGER DEFAULT (unixepoch()),
          next_retry_at INTEGER,
          sent_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      // Create indexes for queue processing
      await db.execute(`
        CREATE INDEX idx_email_queue_status ON email_queue(status, next_retry_at)
      `)
      await db.execute(`
        CREATE INDEX idx_email_queue_retry ON email_queue(status, retry_count, next_retry_at)
      `)
      await db.execute(`
        CREATE INDEX idx_email_queue_created ON email_queue(created_at)
      `)
      console.log("✓ Created email_queue table")
    }

    // Create email_sent_log table for duplicate email prevention
    if (!existingTables.has("email_sent_log")) {
      await db.execute(`
        CREATE TABLE email_sent_log (
          id TEXT PRIMARY KEY,
          booking_id TEXT,
          email_type TEXT NOT NULL,
          recipient_email TEXT NOT NULL,
          status TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(booking_id, email_type, status, sent_at)
        )
      `)
      
      // Create indexes for faster lookups
      await db.execute(`
        CREATE INDEX idx_email_sent_log_booking ON email_sent_log(booking_id, email_type, status)
      `)
      await db.execute(`
        CREATE INDEX idx_email_sent_log_recipient ON email_sent_log(recipient_email, sent_at)
      `)
      console.log("✓ Created email_sent_log table")
    }

    // Run migrations for existing tables
    await migrateExistingTables(db, existingTables)

    console.log("✓ Database initialization complete")
  } catch (error) {
    console.error("Database initialization error:", error)
    throw error
  }
}

/**
 * Migrate existing tables by adding new columns if they don't exist
 * Safe to run multiple times - checks for column existence first
 */
async function migrateExistingTables(
  db: ReturnType<typeof createClient>,
  existingTables: Set<string>
): Promise<void> {
  try {
    // Migrate images table: add category and display_order
    if (existingTables.has("images")) {
      const imageColumns = await db.execute(`
        PRAGMA table_info(images)
      `)
      const columnNames = new Set(
        imageColumns.rows.map((row: any) => row.name)
      )

      if (!columnNames.has("category")) {
        await db.execute(`
          ALTER TABLE images ADD COLUMN category TEXT
        `)
        console.log("✓ Added category column to images table")
      }

      if (!columnNames.has("display_order")) {
        await db.execute(`
          ALTER TABLE images ADD COLUMN display_order INTEGER DEFAULT 0
        `)
        // Create index for category + display_order queries
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_images_category_order 
          ON images(category, display_order)
        `)
        console.log("✓ Added display_order column to images table")
      }
    }

    // Migrate events table: add start_date and end_date
    if (existingTables.has("events")) {
      const eventColumns = await db.execute(`
        PRAGMA table_info(events)
      `)
      const columnNames = new Set(
        eventColumns.rows.map((row: any) => row.name)
      )

      if (!columnNames.has("start_date")) {
        await db.execute(`
          ALTER TABLE events ADD COLUMN start_date INTEGER
        `)
        // Migrate existing event_date to start_date if event_date exists
        await db.execute(`
          UPDATE events SET start_date = event_date WHERE start_date IS NULL AND event_date IS NOT NULL
        `)
        console.log("✓ Added start_date column to events table")
      }

      if (!columnNames.has("end_date")) {
        await db.execute(`
          ALTER TABLE events ADD COLUMN end_date INTEGER
        `)
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_events_end_date ON events(end_date)
        `)
        console.log("✓ Added end_date column to events table")
      }
    }

    // Migrate bookings table: add response fields
    if (existingTables.has("bookings")) {
      const bookingColumns = await db.execute(`
        PRAGMA table_info(bookings)
      `)
      const columnNames = new Set(
        bookingColumns.rows.map((row: any) => row.name)
      )

      if (!columnNames.has("response_token")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN response_token TEXT
        `)
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_bookings_response_token ON bookings(response_token)
        `)
        console.log("✓ Added response_token column to bookings table")
      }

      if (!columnNames.has("proposed_date")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN proposed_date INTEGER
        `)
        console.log("✓ Added proposed_date column to bookings table")
      }

      if (!columnNames.has("user_response")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN user_response TEXT
        `)
        console.log("✓ Added user_response column to bookings table")
      }

      if (!columnNames.has("response_date")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN response_date INTEGER
        `)
        console.log("✓ Added response_date column to bookings table")
      }

      if (!columnNames.has("token_expires_at")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN token_expires_at INTEGER
        `)
        console.log("✓ Added token_expires_at column to bookings table")
      }

      if (!columnNames.has("proposed_end_date")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN proposed_end_date INTEGER
        `)
        console.log("✓ Added proposed_end_date column to bookings table")
      }

      // Update status check constraint to include 'cancelled'
      // Note: SQLite doesn't support modifying CHECK constraints directly
      // We'll handle this in application logic
    }

    // Migrate email_sent_log table: add if it doesn't exist
    if (!existingTables.has("email_sent_log")) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS email_sent_log (
          id TEXT PRIMARY KEY,
          booking_id TEXT,
          email_type TEXT NOT NULL,
          recipient_email TEXT NOT NULL,
          status TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          UNIQUE(booking_id, email_type, status, sent_at)
        )
      `)
      
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_email_sent_log_booking ON email_sent_log(booking_id, email_type, status)
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_email_sent_log_recipient ON email_sent_log(recipient_email, sent_at)
      `)
      console.log("✓ Added email_sent_log table")
    }
  } catch (error) {
    console.error("Migration error:", error)
    // Don't throw - migrations are optional enhancements
    console.warn("Some migrations may have failed, but core functionality should still work")
  }
}


