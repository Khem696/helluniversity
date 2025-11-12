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
 * Get database client with retry logic for connection failures
 * 
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in milliseconds (default: exponential backoff)
 * @returns Database client
 */
export async function getTursoClientWithRetry(
  maxRetries: number = 3
): Promise<ReturnType<typeof createClient>> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = getTursoClient()
      
      // Test connection with simple query
      await client.execute("SELECT 1")
      
      return client
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // Don't retry on configuration errors
      if (lastError.message.includes("is not set") || lastError.message.includes("required")) {
        throw lastError
      }
      
      // If not the last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000 // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw new Error(
    `Database connection failed after ${maxRetries} attempts: ${lastError?.message}`
  )
}

/**
 * Check database health
 * 
 * @returns Health check result with latency
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean
  latency?: number
  error?: string
}> {
  try {
    const startTime = Date.now()
    const db = getTursoClient()
    
    // Simple query to test connection
    await db.execute("SELECT 1")
    
    const latency = Date.now() - startTime
    
    return {
      healthy: true,
      latency,
    }
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
 * 
 * @param options - Optional configuration
 * @param options.cleanupOrphanedImages - If true, will check and remove orphaned image records (default: false)
 */
export async function initializeDatabase(options?: { cleanupOrphanedImages?: boolean }): Promise<void> {
  const db = getTursoClient()

  try {
    // Check if tables already exist
    const checkTables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN (
        'images', 'events', 'rate_limits', 'bookings', 
        'booking_status_history', 'admin_actions', 'event_images', 'email_queue', 'email_sent_log', 'email_event_log', 'error_logs', 'job_queue'
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
          ai_selected INTEGER DEFAULT 0,
          ai_order INTEGER,
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
          reference_number TEXT UNIQUE NOT NULL,
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
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'postponed', 'cancelled', 'finished', 'checked-in', 'paid_deposit')),
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
      await db.execute(`
        CREATE INDEX idx_bookings_reference_number ON bookings(reference_number)
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

    // Create job_queue table for background job processing
    if (!existingTables.has("job_queue")) {
      await db.execute(`
        CREATE TABLE job_queue (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          retry_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
          error_message TEXT,
          scheduled_at INTEGER NOT NULL,
          completed_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      // Create indexes for job processing
      await db.execute(`
        CREATE INDEX idx_job_queue_status ON job_queue(status, scheduled_at, priority)
      `)
      await db.execute(`
        CREATE INDEX idx_job_queue_type ON job_queue(type, status)
      `)
      await db.execute(`
        CREATE INDEX idx_job_queue_created ON job_queue(created_at)
      `)
      console.log("✓ Created job_queue table")
    }

    // Create error_logs table for error tracking
    if (!existingTables.has("error_logs")) {
      await db.execute(`
        CREATE TABLE error_logs (
          id TEXT PRIMARY KEY,
          level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
          message TEXT NOT NULL,
          context TEXT,
          error_name TEXT,
          error_message TEXT,
          error_stack TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      // Create indexes for error analysis
      await db.execute(`
        CREATE INDEX idx_error_logs_level ON error_logs(level, created_at)
      `)
      await db.execute(`
        CREATE INDEX idx_error_logs_created_at ON error_logs(created_at)
      `)
      console.log("✓ Created error_logs table")
    }

    // Run migrations for existing tables
    await migrateExistingTables(db, existingTables)

    // Optional: Cleanup orphaned image records (where blob files don't exist)
    if (options?.cleanupOrphanedImages && existingTables.has("images")) {
      try {
        console.log("⚠️ Checking for orphaned image records...")
        const { imageExists } = await import('./blob')
        const allImages = await db.execute({
          sql: `SELECT id, blob_url, original_filename FROM images`,
        })

        let orphanedCount = 0
        for (const image of allImages.rows) {
          const img = image as any
          const blobUrl = img.blob_url

          if (!blobUrl) {
            // No blob URL - consider it orphaned
            await db.execute({
              sql: `DELETE FROM images WHERE id = ?`,
              args: [img.id],
            })
            orphanedCount++
            console.log(`  ✓ Deleted record with no blob_url: ${img.original_filename || img.id}`)
            continue
          }

          // Check if blob file exists
          try {
            const exists = await imageExists(blobUrl)
            if (!exists) {
              // Blob file doesn't exist - delete the orphaned record
              await db.execute({
                sql: `DELETE FROM images WHERE id = ?`,
                args: [img.id],
              })
              orphanedCount++
              console.log(`  ✓ Deleted orphaned record: ${img.original_filename || img.id}`)
            }
          } catch (error) {
            // Error checking blob existence - assume it doesn't exist
            await db.execute({
              sql: `DELETE FROM images WHERE id = ?`,
              args: [img.id],
            })
            orphanedCount++
            console.log(`  ✓ Deleted record (blob check failed): ${img.original_filename || img.id}`)
          }
        }

        if (orphanedCount > 0) {
          console.log(`✓ Cleaned up ${orphanedCount} orphaned image record(s)`)
        } else {
          console.log("✓ No orphaned image records found")
        }
      } catch (cleanupError) {
        console.error("⚠️ Error during orphaned image cleanup:", cleanupError)
        // Don't throw - cleanup is optional
      }
    }

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

      if (!columnNames.has("ai_selected")) {
        await db.execute(`
          ALTER TABLE images ADD COLUMN ai_selected INTEGER DEFAULT 0
        `)
        console.log("✓ Added ai_selected column to images table")
      }

      if (!columnNames.has("ai_order")) {
        await db.execute(`
          ALTER TABLE images ADD COLUMN ai_order INTEGER
        `)
        console.log("✓ Added ai_order column to images table")
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

      // Add deposit-related fields
      if (!columnNames.has("deposit_evidence_url")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN deposit_evidence_url TEXT
        `)
        console.log("✓ Added deposit_evidence_url column to bookings table")
      }

      if (!columnNames.has("deposit_verified_at")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN deposit_verified_at INTEGER
        `)
        console.log("✓ Added deposit_verified_at column to bookings table")
      }

      if (!columnNames.has("deposit_verified_by")) {
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN deposit_verified_by TEXT
        `)
        console.log("✓ Added deposit_verified_by column to bookings table")
      }

      // Add reference_number column for short booking IDs
      if (!columnNames.has("reference_number")) {
        console.log("⚠️ Migrating bookings table to add reference_number column...")
        
        // Step 1: Add column as nullable first (SQLite limitation)
        await db.execute(`
          ALTER TABLE bookings ADD COLUMN reference_number TEXT
        `)
        
        // Step 2: Generate reference numbers for ALL existing bookings (including NULL ones)
        const allBookings = await db.execute(`
          SELECT id FROM bookings
        `)
        
        // Generate and update reference numbers for existing bookings
        const { randomBytes } = await import('crypto')
        const generateReferenceNumber = () => {
          const timestamp = Math.floor(Date.now() / 1000)
          const randomBytesData = randomBytes(3)
          const randomValue = parseInt(randomBytesData.toString('hex'), 16)
          const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
          const randomPart = (randomValue % 1296).toString(36).toUpperCase().padStart(2, '0')
          return `HU-${timestampPart}${randomPart}`
        }
        
        for (const row of allBookings.rows as any[]) {
          const bookingId = row.id
          const referenceNumber = generateReferenceNumber()
          
          await db.execute({
            sql: `UPDATE bookings SET reference_number = ? WHERE id = ?`,
            args: [referenceNumber, bookingId]
          })
        }
        
        // Step 3: Create unique index
        await db.execute(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_reference_number_unique ON bookings(reference_number)
        `)
        
        // Step 4: Create regular index for lookups
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_bookings_reference_number ON bookings(reference_number)
        `)
        
        console.log(`✓ Added reference_number column to bookings table and generated ${allBookings.rows.length} reference numbers for existing bookings`)
      } else {
        // Column exists - check if any bookings have NULL reference_number and fix them
        const nullReferenceBookings = await db.execute(`
          SELECT id FROM bookings WHERE reference_number IS NULL
        `)
        
        if (nullReferenceBookings.rows.length > 0) {
          console.log(`⚠️ Found ${nullReferenceBookings.rows.length} bookings with NULL reference_number, generating values...`)
          const { randomBytes } = await import('crypto')
          const generateReferenceNumber = () => {
            const timestamp = Math.floor(Date.now() / 1000)
            const randomBytesData = randomBytes(3)
            const randomValue = parseInt(randomBytesData.toString('hex'), 16)
            const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
            const randomPart = (randomValue % 1296).toString(36).toUpperCase().padStart(2, '0')
            return `HU-${timestampPart}${randomPart}`
          }
          
          for (const row of nullReferenceBookings.rows as any[]) {
            const bookingId = row.id
            const referenceNumber = generateReferenceNumber()
            
            await db.execute({
              sql: `UPDATE bookings SET reference_number = ? WHERE id = ?`,
              args: [referenceNumber, bookingId]
            })
          }
          console.log(`✓ Generated reference numbers for ${nullReferenceBookings.rows.length} bookings`)
        }
      }

      // Update status check constraint to include 'paid_deposit', 'checked-in', and 'pending_deposit'
      // SQLite doesn't support modifying CHECK constraints directly, so we need to recreate the table
      // Check if we need to migrate the CHECK constraint
      try {
        // Get the current table definition
        const tableInfo = await db.execute(`
          SELECT sql FROM sqlite_master 
          WHERE type='table' AND name='bookings'
        `)
        
        if (tableInfo.rows.length > 0) {
          const createSql = (tableInfo.rows[0] as any).sql as string
          // Check if the constraint includes 'paid_deposit', 'checked-in', and 'pending_deposit'
          const hasPaidDeposit = createSql.includes("'paid_deposit'")
          const hasCheckedIn = createSql.includes("'checked-in'")
          const hasPendingDeposit = createSql.includes("'pending_deposit'")
          
          if (!hasPaidDeposit || !hasCheckedIn || !hasPendingDeposit) {
            console.log("⚠️ Migrating bookings table to update CHECK constraint...")
            
            // Step 1: Create new table with correct constraint
            await db.execute(`
              CREATE TABLE bookings_new (
                id TEXT PRIMARY KEY,
                reference_number TEXT UNIQUE NOT NULL,
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
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'postponed', 'cancelled', 'finished', 'checked-in', 'paid_deposit', 'pending_deposit')),
                admin_notes TEXT,
                response_token TEXT,
                token_expires_at INTEGER,
                proposed_date INTEGER,
                proposed_end_date INTEGER,
                user_response TEXT,
                response_date INTEGER,
                deposit_evidence_url TEXT,
                deposit_verified_at INTEGER,
                deposit_verified_by TEXT,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch())
              )
            `)
            
            // Step 2: Copy all data from old table to new table
            // Check if reference_number column exists in old table
            const oldTableColumns = await db.execute(`PRAGMA table_info(bookings)`)
            const hasReferenceNumber = oldTableColumns.rows.some((row: any) => row.name === 'reference_number')
            
            if (hasReferenceNumber) {
              // Old table has reference_number - copy it
            await db.execute(`
              INSERT INTO bookings_new 
              SELECT 
                  id, reference_number, name, email, phone, participants, event_type, other_event_type,
                date_range, start_date, end_date, start_time, end_time,
                organization_type, organized_person, introduction, biography, special_requests,
                status, admin_notes, response_token, token_expires_at,
                proposed_date, proposed_end_date, user_response, response_date,
                deposit_evidence_url, deposit_verified_at, deposit_verified_by,
                created_at, updated_at
              FROM bookings
            `)
            } else {
              // Old table doesn't have reference_number - generate it during migration
              const { randomBytes } = await import('crypto')
              const generateReferenceNumber = () => {
                const timestamp = Math.floor(Date.now() / 1000)
                const randomBytesData = randomBytes(3)
                const randomValue = parseInt(randomBytesData.toString('hex'), 16)
                const timestampPart = (timestamp % 46656).toString(36).toUpperCase().padStart(3, '0')
                const randomPart = (randomValue % 1296).toString(36).toUpperCase().padStart(2, '0')
                return `HU-${timestampPart}${randomPart}`
              }
              
              // Get all bookings from old table
              const allBookings = await db.execute(`SELECT * FROM bookings`)
              
              // Insert each booking with generated reference_number
              for (const booking of allBookings.rows as any[]) {
                const referenceNumber = generateReferenceNumber()
                await db.execute({
                  sql: `
                    INSERT INTO bookings_new (
                      id, reference_number, name, email, phone, participants, event_type, other_event_type,
                      date_range, start_date, end_date, start_time, end_time,
                      organization_type, organized_person, introduction, biography, special_requests,
                      status, admin_notes, response_token, token_expires_at,
                      proposed_date, proposed_end_date, user_response, response_date,
                      deposit_evidence_url, deposit_verified_at, deposit_verified_by,
                      created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `,
                  args: [
                    booking.id,
                    referenceNumber,
                    booking.name,
                    booking.email,
                    booking.phone,
                    booking.participants,
                    booking.event_type,
                    booking.other_event_type,
                    booking.date_range,
                    booking.start_date,
                    booking.end_date,
                    booking.start_time,
                    booking.end_time,
                    booking.organization_type,
                    booking.organized_person,
                    booking.introduction,
                    booking.biography,
                    booking.special_requests,
                    booking.status,
                    booking.admin_notes,
                    booking.response_token,
                    booking.token_expires_at,
                    booking.proposed_date,
                    booking.proposed_end_date,
                    booking.user_response,
                    booking.response_date,
                    booking.deposit_evidence_url,
                    booking.deposit_verified_at,
                    booking.deposit_verified_by,
                    booking.created_at,
                    booking.updated_at,
                  ],
                })
              }
            }
            
            // Step 3: Drop old table
            await db.execute(`DROP TABLE bookings`)
            
            // Step 4: Rename new table to original name
            await db.execute(`ALTER TABLE bookings_new RENAME TO bookings`)
            
            // Step 5: Recreate indexes
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)
            `)
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email)
            `)
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_start_date ON bookings(start_date)
            `)
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at)
            `)
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_response_token ON bookings(response_token)
            `)
            await db.execute(`
              CREATE INDEX IF NOT EXISTS idx_bookings_reference_number ON bookings(reference_number)
            `)
            
            console.log("✓ Successfully migrated bookings table with updated CHECK constraint")
          }
        }
      } catch (migrationError) {
        console.error("⚠️ Error migrating bookings table CHECK constraint:", migrationError)
        // Don't throw - allow application to continue
        // The constraint might not be strictly enforced in some SQLite configurations
      }
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

    // Migrate error_logs table: add if it doesn't exist
    if (!existingTables.has("error_logs")) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS error_logs (
          id TEXT PRIMARY KEY,
          level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
          message TEXT NOT NULL,
          context TEXT,
          error_name TEXT,
          error_message TEXT,
          error_stack TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)
      
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_error_logs_level ON error_logs(level, created_at)
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at)
      `)
      console.log("✓ Added error_logs table")
    }
  } catch (error) {
    console.error("Migration error:", error)
    // Don't throw - migrations are optional enhancements
    console.warn("Some migrations may have failed, but core functionality should still work")
  }
}


