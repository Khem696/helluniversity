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
        // Update existing lock expiration
        await db.execute({
          sql: `UPDATE action_locks SET expires_at = ?, locked_at = ? WHERE id = ?`,
          args: [expiresAt, now, lock.id],
        })
        
        // Broadcast lock extension (after successful DB update)
        try {
          const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
          broadcastActionLockEvent(
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
      // Different admin has the lock
      return null
    }
    
    // Create new lock
    // CRITICAL: Use INSERT OR IGNORE to handle race conditions gracefully
    // If two admins try to acquire the same lock simultaneously, the second INSERT will be ignored
    // We then check if we successfully acquired the lock by querying for it
    const lockId = randomUUID()
    try {
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO action_locks (id, resource_type, resource_id, action, admin_email, admin_name, locked_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [lockId, resourceType, resourceId, action, adminEmail, adminName || null, now, expiresAt],
      })
      
      // Check if we successfully acquired the lock
      // If another admin inserted first, our INSERT was ignored and we need to verify
      const verifyLock = await db.execute({
        sql: `SELECT * FROM action_locks WHERE resource_type = ? AND resource_id = ? AND action = ? AND expires_at > ?`,
        args: [resourceType, resourceId, action, now],
      })
      
      if (verifyLock.rows.length > 0) {
        const lock = verifyLock.rows[0] as any
        // Only return lock ID if we're the one who acquired it
        if (lock.admin_email === adminEmail) {
          // Broadcast lock acquisition (after successful DB insert)
          try {
            const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
            broadcastActionLockEvent(
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
        // Another admin acquired it first
        return null
      }
      
      // No lock found (shouldn't happen, but handle gracefully)
      return null
    } catch (error) {
      // If INSERT fails for any reason (including constraint violations), return null
      // This handles edge cases where the database doesn't support INSERT OR IGNORE
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('UNIQUE constraint') || errorMessage.includes('constraint')) {
        // Another admin acquired the lock first - return null
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
 */
export async function releaseActionLock(lockId: string, adminEmail: string): Promise<boolean> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // Get lock details before deleting (for broadcast)
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
  
  // Broadcast lock release (after successful DB delete)
  if (released && lockResult.rows.length > 0) {
    const lock = lockResult.rows[0] as any
    try {
      const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
      broadcastActionLockEvent(
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
 */
export async function extendActionLock(lockId: string, adminEmail: string): Promise<boolean> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + LOCK_DURATION
  
  // Get lock details before updating (for broadcast)
  const lockResult = await db.execute({
    sql: `SELECT * FROM action_locks WHERE id = ? AND admin_email = ? AND expires_at > ?`,
    args: [lockId, adminEmail, now],
  })
  
  // Only allow the admin who created the lock to extend it
  const result = await db.execute({
    sql: `UPDATE action_locks SET expires_at = ? WHERE id = ? AND admin_email = ? AND expires_at > ?`,
    args: [expiresAt, lockId, adminEmail, now],
  })
  
  const extended = (result.rowsAffected || 0) > 0
  
  // Broadcast lock extension (after successful DB update)
  if (extended && lockResult.rows.length > 0) {
    const lock = lockResult.rows[0] as any
    try {
      const { broadcastActionLockEvent } = await import('../../app/api/v1/admin/action-locks/stream/route')
      broadcastActionLockEvent(
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
  
  return extended
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
          broadcastActionLockEvent(
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
}

/**
 * Get all active locks for a booking (backward compatibility)
 */
export async function getBookingLocks(bookingId: string): Promise<ActionLock[]> {
  return getResourceLocks('booking', bookingId)
}

