/**
 * Action Locking System
 * 
 * Prevents concurrent execution of the same action on the same resource by multiple admins.
 * Uses database-level locking to ensure atomicity across all admin sessions.
 * Supports multiple resource types: bookings, events, images, emails, dashboard actions.
 */

import { getTursoClient, dbTransaction } from "./turso"
import { randomUUID } from "crypto"
import type { Transaction } from "@libsql/client"

export type ResourceType = 'booking' | 'event' | 'image' | 'email' | 'dashboard' | 'global'

export interface ActionLock {
  id: string
  resourceType: ResourceType
  resourceId: string
  action: string
  adminEmail: string
  adminName?: string
  lockedAt: number
  expiresAt: number
}

const LOCK_DURATION = 30 // seconds - how long a lock is held
const LOCK_CLEANUP_INTERVAL = 60 // seconds - how often to clean up expired locks

/**
 * Acquire an action lock for a resource
 * Returns lock ID if successful, null if already locked
 */
export async function acquireActionLock(
  resourceType: ResourceType,
  resourceId: string,
  action: string,
  adminEmail: string,
  adminName?: string
): Promise<string | null> {
  return await dbTransaction(async (db: Transaction) => {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + LOCK_DURATION
    
    // Clean up expired locks first
    await db.execute({
      sql: `DELETE FROM action_locks WHERE expires_at < ?`,
      args: [now],
    })
    
    // Check if there's an existing lock for this resource+action
    const existingLock = await db.execute({
      sql: `SELECT * FROM action_locks WHERE resource_type = ? AND resource_id = ? AND action = ? AND expires_at > ?`,
      args: [resourceType, resourceId, action, now],
    })
    
    if (existingLock.rows.length > 0) {
      const lock = existingLock.rows[0] as any
      // If it's the same admin, allow re-acquisition (extend lock)
      if (lock.admin_email === adminEmail) {
        // FIXED: Added expiration check in WHERE clause to ensure lock hasn't expired (Issue #11)
        // This prevents extending a lock that expired between SELECT and UPDATE
        const updateResult = await db.execute({
          sql: `UPDATE action_locks SET expires_at = ?, locked_at = ? WHERE id = ? AND expires_at > ?`,
          args: [expiresAt, now, lock.id, now],
        })
        
        // If update failed (lock expired), allow new lock acquisition
        if ((updateResult.rowsAffected || 0) === 0) {
          // Lock expired between SELECT and UPDATE - delete expired lock and continue to create new one
          await db.execute({
            sql: `DELETE FROM action_locks WHERE id = ?`,
            args: [lock.id],
          })
          // Continue to create new lock below (fall through)
        } else {
          // Update succeeded - broadcast and return lock ID
          // Broadcast lock extension (after successful DB update)
          try {
            const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
            await broadcastActionLockEvent(
              'lock:extended',
              resourceType,
              resourceId,
              action,
              {
                lockId: lock.id,
                adminEmail,
                adminName: adminName || undefined,
                lockedAt: now,
                expiresAt,
              }
            )
          } catch (broadcastError) {
            // Don't fail if broadcast fails - logging is optional
            const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
            try {
              const { logWarn } = await import('./logger')
              await logWarn('Failed to broadcast lock extension', {
                resourceType,
                resourceId,
                action,
                error: errorMessage,
              })
            } catch (logError) {
              // Fallback: if logger fails, silently continue (avoid infinite loops)
            }
          }
          
          return lock.id
        }
      } else {
        // Different admin has the lock
        return null
      }
    }
    
    // Create new lock
    // FIXED: Improved atomicity by checking rowsAffected and using INSERT ... ON CONFLICT
    // The unique constraint on (resource_type, resource_id, action) ensures only one lock exists
    // We use INSERT ... ON CONFLICT DO NOTHING and check rowsAffected to verify insertion
    const lockId = randomUUID()
    try {
      // FIXED: Use INSERT ... ON CONFLICT DO NOTHING for better atomicity
      // This is more explicit than INSERT OR IGNORE and works better with unique constraints
      const insertResult = await db.execute({
        sql: `
          INSERT INTO action_locks (id, resource_type, resource_id, action, admin_email, admin_name, locked_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(resource_type, resource_id, action) DO NOTHING
        `,
        args: [lockId, resourceType, resourceId, action, adminEmail, adminName || null, now, expiresAt],
      })
      
      // FIXED: Check rowsAffected to verify if we successfully inserted
      // If rowsAffected is 0, another admin acquired the lock first (conflict occurred)
      if ((insertResult.rowsAffected || 0) === 0) {
        // FIXED: Removed redundant re-check - ON CONFLICT DO NOTHING already indicates lock exists (Issue #8)
        // If rowsAffected is 0, it means another admin acquired the lock (or it already existed)
        // No need to re-check - just return null
        return null
      }
      
      // FIXED: We successfully inserted - verify we got the lock we inserted
      // Query for the lock we just inserted to get its details
      const verifyLock = await db.execute({
        sql: `SELECT * FROM action_locks WHERE id = ? AND resource_type = ? AND resource_id = ? AND action = ?`,
        args: [lockId, resourceType, resourceId, action],
      })
      
      if (verifyLock.rows.length > 0) {
        const lock = verifyLock.rows[0] as any
        // Verify it's our lock (admin_email should match)
        if (lock.admin_email === adminEmail) {
          // Broadcast lock acquisition (after successful DB insert)
          try {
            const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
            await broadcastActionLockEvent(
              'lock:acquired',
              resourceType,
              resourceId,
              action,
              {
                lockId: lock.id,
                adminEmail,
                adminName: adminName || undefined,
                lockedAt: lock.locked_at,
                expiresAt: lock.expires_at,
              }
            )
          } catch (broadcastError) {
            // Don't fail if broadcast fails - logging is optional
            const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
            try {
              const { logWarn } = await import('./logger')
              await logWarn('Failed to broadcast lock acquisition', {
                resourceType,
                resourceId,
                action,
                adminEmail,
                error: errorMessage,
              })
            } catch (logError) {
              // Fallback: if logger fails, silently continue (avoid infinite loops)
            }
          }
          
          return lock.id
        }
        // Race condition: lock was inserted but admin_email doesn't match (shouldn't happen)
        // Delete the lock we inserted and return null
        await db.execute({
          sql: `DELETE FROM action_locks WHERE id = ?`,
          args: [lockId],
        })
        return null
      }
      
      // Lock not found after insertion (shouldn't happen)
      return null
    } catch (error) {
      // If INSERT fails for any reason (including constraint violations), return null
      // This handles edge cases where the database doesn't support ON CONFLICT
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('UNIQUE constraint') || errorMessage.includes('constraint') || errorMessage.includes('ON CONFLICT')) {
        // Another admin acquired the lock first or database doesn't support ON CONFLICT
        // Fallback: query to verify
        try {
          const verifyLock = await db.execute({
            sql: `SELECT * FROM action_locks WHERE resource_type = ? AND resource_id = ? AND action = ? AND expires_at > ?`,
            args: [resourceType, resourceId, action, now],
          })
          if (verifyLock.rows.length > 0) {
            return null // Lock exists, acquired by another admin
          }
        } catch (queryError) {
          // Query failed, return null to be safe
        }
        return null
      }
      // Re-throw unexpected errors
      throw error
    }
  })
}

/**
 * Acquire an action lock for a booking (backward compatibility)
 */
export async function acquireBookingActionLock(
  bookingId: string,
  action: string,
  adminEmail: string,
  adminName?: string
): Promise<string | null> {
  return acquireActionLock('booking', bookingId, action, adminEmail, adminName)
}

/**
 * Release an action lock
 * FIXED: Made atomic using transaction to ensure consistency (Issue #5)
 */
export async function releaseActionLock(lockId: string, adminEmail: string): Promise<boolean> {
  return await dbTransaction(async (db: Transaction) => {
    const now = Math.floor(Date.now() / 1000)
    
    // FIXED: Get lock details and delete in same transaction for atomicity (Issue #5)
    // This ensures lock details are fetched before deletion, preventing race conditions
    const lockResult = await db.execute({
      sql: `SELECT * FROM action_locks WHERE id = ? AND admin_email = ?`,
      args: [lockId, adminEmail],
    })
    
    // Only allow the admin who created the lock to release it
    const result = await db.execute({
      sql: `DELETE FROM action_locks WHERE id = ? AND admin_email = ?`,
      args: [lockId, adminEmail],
    })
    
    const released = (result.rowsAffected || 0) > 0
    
    // Broadcast lock release (after successful DB delete, outside transaction)
    if (released && lockResult.rows.length > 0) {
      const lock = lockResult.rows[0] as any
      // Broadcast outside transaction to avoid blocking
      try {
        const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
        await broadcastActionLockEvent(
          'lock:released',
          lock.resource_type,
          lock.resource_id,
          lock.action,
          {
            lockId,
            adminEmail,
            adminName: lock.admin_name || undefined,
          }
        )
      } catch (broadcastError) {
        // Don't fail if broadcast fails - logging is optional
        const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
        try {
          const { logWarn } = await import('./logger')
          await logWarn('Failed to broadcast lock release', {
            lockId: lock.id,
            resourceType: lock.resource_type,
            resourceId: lock.resource_id,
            action: lock.action,
            error: errorMessage,
          })
        } catch (logError) {
          // Fallback: if logger fails, silently continue (avoid infinite loops)
        }
      }
    }
    
    return released
  })
}

/**
 * Check if an action is locked
 */
export async function isActionLocked(
  resourceType: ResourceType,
  resourceId: string,
  action: string
): Promise<{ locked: boolean; lockedBy?: string; lockId?: string }> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  const result = await db.execute({
    sql: `SELECT * FROM action_locks WHERE resource_type = ? AND resource_id = ? AND action = ? AND expires_at > ?`,
    args: [resourceType, resourceId, action, now],
  })
  
  if (result.rows.length === 0) {
    return { locked: false }
  }
  
  const lock = result.rows[0] as any
  return {
    locked: true,
    lockedBy: lock.admin_email,
    lockId: lock.id,
  }
}

/**
 * Check if a booking action is locked (backward compatibility)
 */
export async function isBookingActionLocked(
  bookingId: string,
  action: string
): Promise<{ locked: boolean; lockedBy?: string; lockId?: string }> {
  return isActionLocked('booking', bookingId, action)
}

/**
 * Extend an action lock (called periodically while action is in progress)
 * FIXED: Made atomic using transaction to prevent race conditions (Issues #1, #3)
 */
export async function extendActionLock(lockId: string, adminEmail: string): Promise<boolean> {
  return await dbTransaction(async (db: Transaction) => {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + LOCK_DURATION
    
    // FIXED: Use atomic UPDATE with WHERE clause to check and update in one operation
    // This prevents race conditions where lock could expire between SELECT and UPDATE
    const result = await db.execute({
      sql: `UPDATE action_locks SET expires_at = ?, locked_at = ? WHERE id = ? AND admin_email = ? AND expires_at > ?`,
      args: [expiresAt, now, lockId, adminEmail, now],
    })
    
    const extended = (result.rowsAffected || 0) > 0
    
    // Only fetch lock details for broadcast if extension succeeded
    // This avoids unnecessary SELECT if UPDATE failed
    if (extended) {
      // Get lock details after successful update (for broadcast)
      const lockResult = await db.execute({
        sql: `SELECT * FROM action_locks WHERE id = ? AND admin_email = ?`,
        args: [lockId, adminEmail],
      })
      
      if (lockResult.rows.length > 0) {
        const lock = lockResult.rows[0] as any
        // Broadcast lock extension (after successful DB update)
        try {
          const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
          await broadcastActionLockEvent(
            'lock:extended',
            lock.resource_type,
            lock.resource_id,
            lock.action,
            {
              lockId,
              adminEmail,
              adminName: lock.admin_name || undefined,
              lockedAt: lock.locked_at,
              expiresAt,
            }
          )
        } catch (broadcastError) {
          // Don't fail if broadcast fails - logging is optional
          const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
          try {
            const { logWarn } = await import('./logger')
            await logWarn('Failed to broadcast lock extension', {
              lockId: lock.id,
              resourceType: lock.resource_type,
              resourceId: lock.resource_id,
              action: lock.action,
              error: errorMessage,
            })
          } catch (logError) {
            // Fallback: if logger fails, silently continue (avoid infinite loops)
          }
        }
      }
    }
    
    return extended
  })
}

/**
 * Clean up expired locks (should be called periodically)
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // Get expired locks before deleting (for broadcast)
  const expiredLocks = await db.execute({
    sql: `SELECT * FROM action_locks WHERE expires_at < ?`,
    args: [now],
  })
  
  const result = await db.execute({
    sql: `DELETE FROM action_locks WHERE expires_at < ?`,
    args: [now],
  })
  
  const deletedCount = result.rowsAffected || 0
  
  // Broadcast lock expiration for each expired lock (after successful DB delete)
  if (deletedCount > 0 && expiredLocks.rows.length > 0) {
    try {
      const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
      for (const lockRow of expiredLocks.rows) {
        const lock = lockRow as any
        try {
          await broadcastActionLockEvent(
            'lock:expired',
            lock.resource_type,
            lock.resource_id,
            lock.action,
            {
              lockId: lock.id,
              adminEmail: lock.admin_email,
              adminName: lock.admin_name || undefined,
            }
          )
        } catch (broadcastError) {
          // Continue with other locks even if one broadcast fails
          const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
          try {
            const { logWarn } = await import('./logger')
            await logWarn('Failed to broadcast lock expiration', {
              lockId: lock.id,
              resourceType: lock.resource_type,
              resourceId: lock.resource_id,
              action: lock.action,
              error: errorMessage,
            })
          } catch (logError) {
            // Fallback: if logger fails, silently continue (avoid infinite loops)
          }
        }
      }
    } catch (broadcastError) {
      // Don't fail if broadcast fails - logging is optional
      const errorMessage = broadcastError instanceof Error ? broadcastError.message : String(broadcastError)
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to broadcast expired locks', {
          error: errorMessage,
        })
      } catch (logError) {
        // Fallback: if logger fails, silently continue (avoid infinite loops)
      }
    }
  }
  
  return deletedCount
}

/**
 * Get all active locks for a resource
 */
export async function getResourceLocks(
  resourceType: ResourceType,
  resourceId: string
): Promise<ActionLock[]> {
  try {
    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)
    
    const result = await db.execute({
      sql: `SELECT * FROM action_locks WHERE resource_type = ? AND resource_id = ? AND expires_at > ? ORDER BY locked_at DESC`,
      args: [resourceType, resourceId, now],
    })
    
    return result.rows.map((row: any) => ({
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      action: row.action,
      adminEmail: row.admin_email,
      adminName: row.admin_name || undefined,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    }))
  } catch (error) {
    // FIXED: Return empty array on error instead of throwing (Issue #3)
    // This makes the function more defensive and prevents unexpected crashes
    try {
      const { logWarn } = await import('./logger')
      await logWarn('Failed to get resource locks', {
        resourceType,
        resourceId,
        error: error instanceof Error ? error.message : String(error),
      })
    } catch {
      // Ignore logger errors
    }
    return []
  }
}

/**
 * Get all active locks for a booking (backward compatibility)
 */
export async function getBookingLocks(bookingId: string): Promise<ActionLock[]> {
  return getResourceLocks('booking', bookingId)
}

/**
 * Lock extension interval configuration
 */
const LOCK_EXTENSION_INTERVAL = 20 // seconds - extend lock every 20 seconds (before 30s expiration)
const LOCK_EXTENSION_BUFFER = 5 // seconds - buffer before expiration to ensure extension happens in time

/**
 * Automatic lock extension manager for long operations
 * Extends the lock periodically to prevent expiration during long-running operations
 * FIXED: Added callback mechanism to notify when lock is lost (Issue #7)
 */
export class LockExtensionManager {
  private intervalId: NodeJS.Timeout | null = null
  private lockId: string
  private adminEmail: string
  private isActive: boolean = true
  private onLockLost?: () => void
  private consecutiveFailures: number = 0
  private readonly MAX_CONSECUTIVE_FAILURES = 3

  constructor(lockId: string, adminEmail: string, onLockLost?: () => void) {
    this.lockId = lockId
    this.adminEmail = adminEmail
    this.onLockLost = onLockLost
  }

  /**
   * Start automatic lock extension
   * Extends the lock every LOCK_EXTENSION_INTERVAL seconds
   */
  start(): void {
    // FIXED: Check both intervalId and isActive to prevent race conditions (CRITICAL-1, CRITICAL-3, HIGH-1)
    if (this.intervalId || !this.isActive) {
      // Already started or stopped
      return
    }

    // Set up periodic extension FIRST to prevent race condition with stop()
    // FIXED: Create interval before async operations to prevent race condition (CRITICAL-1)
    // FIXED: Added error handling wrapper to ensure interval is cleared on critical errors (Issue #9)
    // FIXED: Added isActive check at start of callback to prevent race condition (Issue #4)
    this.intervalId = setInterval(async () => {
      // FIXED: Check isActive at the very start to prevent execution after stop() (Issue #4)
      // Store in local variable to prevent race condition where isActive changes during execution
      const isStillActive = this.isActive
      if (!isStillActive) {
        return
      }
      
      try {
        await this.extendLock()
      } catch (error) {
        // FIXED: If extendLock throws an unexpected error, stop the interval to prevent spam (Issue #9)
        // This is a safety measure - extendLock should catch its own errors, but this provides extra protection
        // FIXED: Double-check isActive before stopping to prevent race condition (Issue #4)
        if (!this.isActive) {
          return
        }
        
        try {
          const { logError } = await import('./logger')
          await logError(
            'Unexpected error in lock extension interval',
            {
              lockId: this.lockId,
              adminEmail: this.adminEmail,
            },
            error instanceof Error ? error : new Error(String(error))
          )
        } catch {
          // Ignore logger errors
        }
        // Stop interval on unexpected error to prevent repeated failures
        this.stop()
      }
    }, LOCK_EXTENSION_INTERVAL * 1000)

    // Extend immediately AFTER interval is set to prevent race condition
    // FIXED: Call extendLock after setInterval to prevent race condition with stop() (CRITICAL-1)
    // NOTE: extendLock() internally calls stop() if lock doesn't exist, so we don't need to check the result
    // The interval callback checks isActive at the start, so it will exit immediately if stop() was called
    this.extendLock()
      .catch((error) => {
        // If extend fails and stop() was called, clean up interval (defensive measure)
        // NOTE: stop() already clears the interval, but this handles the rare race condition window
        if (!this.isActive && this.intervalId) {
          clearInterval(this.intervalId)
          this.intervalId = null
        } else {
          // Log error but don't stop interval if still active
          // The interval will handle retries
          import('./logger')
            .then(({ logWarn }) => {
              return logWarn('Failed to extend lock on start', {
                lockId: this.lockId,
                adminEmail: this.adminEmail,
                error: error instanceof Error ? error.message : String(error),
              })
            })
            .catch(() => {
              // Ignore logger errors
            })
        }
      })
  }

  /**
   * Stop automatic lock extension
   * FIXED: Made atomic to prevent race conditions with interval callback (Issue #4)
   */
  stop(): void {
    // FIXED: Set isActive first, then clear interval atomically (Issue #4)
    // This prevents the interval callback from executing after stop() is called
    this.isActive = false
    
    // FIXED: Store intervalId in local variable before clearing to prevent race condition (Issue #4)
    const intervalToClear = this.intervalId
    this.intervalId = null
    
    if (intervalToClear) {
      clearInterval(intervalToClear)
    }
  }

  /**
   * Extend the lock periodically
   * 
   * This method attempts to extend the action lock to prevent expiration during long operations.
   * If the lock cannot be extended (expired or released), it stops the extension manager and
   * notifies the onLockLost callback if provided.
   * 
   * @private
   * @returns Promise that resolves when extension attempt completes
   * @throws Never throws - all errors are caught and logged internally
   */
  private async extendLock(): Promise<void> {
    if (!this.isActive) {
      return
    }

    try {
      const extended = await extendActionLock(this.lockId, this.adminEmail)
      if (!extended) {
        // FIXED: Stop immediately on lock expiration, don't wait for multiple failures (MEDIUM-2)
        // Lock expired or was released - stop extending and notify immediately
        this.stop()
        // FIXED: Notify callback that lock was lost (Issue #7)
        if (this.onLockLost) {
          try {
            this.onLockLost()
          } catch (callbackError) {
            // Don't let callback errors break the manager
            try {
              const { logWarn } = await import('./logger')
              await logWarn('Error in lock loss callback', {
                lockId: this.lockId,
                error: callbackError instanceof Error ? callbackError.message : String(callbackError),
              })
            } catch {
              // Ignore logger errors
            }
          }
        }
        return
      } else {
        // Reset failure counter on successful extension
        this.consecutiveFailures = 0
      }
    } catch (error) {
      // Log error and track failures
      this.consecutiveFailures++
      try {
        const { logWarn } = await import('./logger')
        await logWarn('Failed to extend action lock automatically', {
          lockId: this.lockId,
          adminEmail: this.adminEmail,
          error: error instanceof Error ? error.message : String(error),
          consecutiveFailures: this.consecutiveFailures,
        })
      } catch {
        // Ignore logger errors
      }
      
      // If too many consecutive failures, stop extending and notify
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.stop()
        // FIXED: Use consistent error handling pattern for onLockLost callback (HIGH-2)
        if (this.onLockLost) {
          try {
            this.onLockLost()
          } catch (callbackError) {
            // Don't let callback errors break the manager
            try {
              const { logWarn } = await import('./logger')
              await logWarn('Error in lock loss callback (consecutive failures)', {
                lockId: this.lockId,
                error: callbackError instanceof Error ? callbackError.message : String(callbackError),
              })
            } catch {
              // Ignore logger errors
            }
          }
        }
      }
    }
  }
}

/**
 * Create a lock extension manager for automatic lock extension during long operations
 * FIXED: Added optional callback for lock loss notification (Issue #7)
 * FIXED: Added input validation to prevent invalid managers (MEDIUM-1)
 * 
 * @param lockId - The action lock ID (must be non-empty string)
 * @param adminEmail - The admin email address (must be non-empty string)
 * @param onLockLost - Optional callback invoked when lock is lost
 * @returns LockExtensionManager instance or null if inputs are invalid
 * 
 * @example
 * ```typescript
 * const lockManager = createLockExtensionManager(lockId, adminEmail, () => {
 *   // Handle lock loss - abort operation, notify user, etc.
 * })
 * try {
 *   lockManager.start()
 *   // ... long operation ...
 * } finally {
 *   lockManager.stop()
 * }
 * ```
 */
export function createLockExtensionManager(
  lockId: string | null,
  adminEmail: string | undefined,
  onLockLost?: () => void
): LockExtensionManager | null {
  // FIXED: Validate inputs to prevent creating managers with invalid data (MEDIUM-1)
  if (!lockId || typeof lockId !== 'string' || lockId.trim().length === 0) {
    return null
  }
  if (!adminEmail || typeof adminEmail !== 'string' || adminEmail.trim().length === 0) {
    return null
  }
  return new LockExtensionManager(lockId, adminEmail, onLockLost)
}

