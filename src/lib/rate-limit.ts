import { getTursoClient } from "./turso"

/**
 * Rate Limiting Utility using Turso SQLite
 * 
 * Implements sliding window rate limiting.
 * Stores rate limit data in Turso SQLite database.
 * 
 * Environment Variables:
 * - RATE_LIMIT: Number of requests allowed per window (default: 5)
 * - RATE_WINDOW_SECONDS: Time window in seconds (default: 600 = 10 minutes)
 */

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

/**
 * Check rate limit for an identifier (IP address, user ID, etc.)
 * 
 * @param identifier - Unique identifier (IP address, user ID, etc.)
 * @param endpoint - API endpoint name (e.g., "ai-space", "booking")
 * @returns Rate limit result with success status and remaining requests
 */
export async function checkRateLimit(
  identifier: string,
  endpoint: string = "default"
): Promise<RateLimitResult> {
  const db = getTursoClient()
  
  const limit = parseInt(process.env.RATE_LIMIT || "5")
  const windowSeconds = parseInt(process.env.RATE_WINDOW_SECONDS || "600")
  
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds

  try {
    // ATOMIC RATE LIMIT CHECK AND INCREMENT
    // Use atomic UPDATE to prevent race conditions from concurrent requests
    // Strategy: Try to increment atomically, check if limit exceeded
    
    // First, try to increment existing record atomically (if count < limit)
    const updateResult = await db.execute({
      sql: `
        UPDATE rate_limits 
        SET count = count + 1 
        WHERE identifier = ? AND endpoint = ? AND window_start = ? AND count < ?
      `,
      args: [identifier, endpoint, windowStart, limit],
    })

    // If UPDATE affected rows, we successfully incremented (and were under limit)
    if (updateResult.rowsAffected && updateResult.rowsAffected > 0) {
      // FIXED: Remove unnecessary transaction overhead (Issue #16)
      // The UPDATE is already atomic, so a simple SELECT is sufficient
      // No need for transaction isolation for a read operation
      const countResult = await db.execute({
        sql: `
          SELECT count 
          FROM rate_limits 
          WHERE identifier = ? AND endpoint = ? AND window_start = ?
        `,
        args: [identifier, endpoint, windowStart],
      })
      
      const newCount = countResult.rows.length > 0 ? (countResult.rows[0] as any).count : limit
      const remaining = limit - newCount
      const reset = windowStart + windowSeconds

      return {
        success: true,
        limit,
        remaining: Math.max(0, remaining),
        reset,
      }
    }

    // UPDATE didn't affect rows - either record doesn't exist or limit exceeded
    // Check if record exists
    const checkResult = await db.execute({
      sql: `
        SELECT count 
        FROM rate_limits 
        WHERE identifier = ? AND endpoint = ? AND window_start = ?
      `,
      args: [identifier, endpoint, windowStart],
    })

    if (checkResult.rows.length > 0) {
      // Record exists but UPDATE failed - limit exceeded (race condition: another request hit limit)
      const currentCount = (checkResult.rows[0] as any).count
      const reset = windowStart + windowSeconds
      
      // Track rate limit hit
      try {
        const { trackRateLimitHit } = await import('./monitoring')
        trackRateLimitHit(endpoint, identifier)
      } catch {
        // Ignore monitoring errors
      }
      
      return {
        success: false,
        limit,
        remaining: 0,
        reset,
      }
    }

    // Record doesn't exist - try to insert (handle race condition with INSERT OR IGNORE)
    try {
      await db.execute({
        sql: `
          INSERT INTO rate_limits (identifier, endpoint, count, window_start)
          VALUES (?, ?, 1, ?)
        `,
        args: [identifier, endpoint, windowStart],
      })
      
      // Insert succeeded - we're the first request in this window
      const remaining = limit - 1
      const reset = windowStart + windowSeconds
      return {
        success: true,
        limit,
        remaining: Math.max(0, remaining),
        reset,
      }
    } catch (insertError: any) {
      // Insert failed (likely unique constraint violation from race condition)
      // Another request inserted between our check and insert
      // Try to increment the record that was just created
      const retryUpdateResult = await db.execute({
        sql: `
          UPDATE rate_limits 
          SET count = count + 1 
          WHERE identifier = ? AND endpoint = ? AND window_start = ? AND count < ?
        `,
        args: [identifier, endpoint, windowStart, limit],
      })

      if (retryUpdateResult.rowsAffected && retryUpdateResult.rowsAffected > 0) {
        // Successfully incremented - use simple query for count retrieval (read-only, no transaction needed)
        // IMPROVED: Removed unnecessary transaction overhead for read-only operation
        const countResult = await db.execute({
          sql: `
            SELECT count 
            FROM rate_limits 
            WHERE identifier = ? AND endpoint = ? AND window_start = ?
          `,
          args: [identifier, endpoint, windowStart],
        })
        
        const newCount = countResult.rows.length > 0 ? (countResult.rows[0] as any).count : limit
        const remaining = limit - newCount
        const reset = windowStart + windowSeconds

        return {
          success: true,
          limit,
          remaining: Math.max(0, remaining),
          reset,
        }
      }

      // Still failed - check current count
      const finalCheckResult = await db.execute({
        sql: `
          SELECT count 
          FROM rate_limits 
          WHERE identifier = ? AND endpoint = ? AND window_start = ?
        `,
        args: [identifier, endpoint, windowStart],
      })

      if (finalCheckResult.rows.length > 0) {
        const currentCount = (finalCheckResult.rows[0] as any).count
        if (currentCount >= limit) {
          const reset = windowStart + windowSeconds
          
          // Track rate limit hit
          try {
            const { trackRateLimitHit } = await import('./monitoring')
            trackRateLimitHit(endpoint, identifier)
          } catch {
            // Ignore monitoring errors
          }
          
          return {
            success: false,
            limit,
            remaining: 0,
            reset,
          }
        }
      }

      // Fallback: allow request (shouldn't happen, but fail open)
      const reset = windowStart + windowSeconds
      return {
        success: true,
        limit,
        remaining: limit - 1,
        reset,
      }
    }
  } catch (error) {
    // Use structured logger for errors
    import('./logger').then(({ logError }) => {
      logError('Rate limit check error', {
        identifier,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : new Error(String(error))).catch(() => {
        // Fallback if logger fails
      })
    }).catch(() => {
      // Fallback if logger import fails
    })
    
    // Track rate limit bypass (error occurred)
    try {
      const { trackRateLimitBypass } = await import('./monitoring')
      trackRateLimitBypass(endpoint, identifier)
    } catch {
      // Ignore monitoring errors
    }
    
    // IMPROVED: Fail-closed in production by default, fail-open in development
    // Can be overridden with RATE_LIMIT_FAIL_CLOSED environment variable
    const FAIL_CLOSED_ON_ERROR = process.env.RATE_LIMIT_FAIL_CLOSED === 'true' || 
                                  (process.env.RATE_LIMIT_FAIL_CLOSED !== 'false' && 
                                   process.env.NODE_ENV === 'production')
    
    if (FAIL_CLOSED_ON_ERROR) {
      // Fail closed: reject request when rate limiting fails
      return {
        success: false,
        limit,
        remaining: 0,
        reset: windowStart + windowSeconds,
      }
    }
    
    // Fail open: allow request when rate limiting fails (development only)
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: windowStart + windowSeconds,
    }
  }
}

/**
 * Clean up old rate limit records
 * Should be called periodically (e.g., via cron job or scheduled function)
 */
export async function cleanupRateLimits(): Promise<void> {
  const db = getTursoClient()
  const windowSeconds = parseInt(process.env.RATE_WINDOW_SECONDS || "600")
  const now = Math.floor(Date.now() / 1000)
  
  // Delete records older than 2 windows (to keep some buffer)
  const cutoff = now - (windowSeconds * 2)

  try {
    await db.execute({
      sql: `
        DELETE FROM rate_limits 
        WHERE window_start < ?
      `,
      args: [cutoff],
    })
  } catch (error) {
    // Use structured logger for errors
    import('./logger').then(({ logError }) => {
      logError('Rate limit cleanup error', {
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : new Error(String(error))).catch(() => {
        // Fallback if logger fails
      })
    }).catch(() => {
      // Fallback if logger import fails
    })
    // Don't throw - cleanup failures shouldn't break the app
  }
}

/**
 * Get client IP address from request
 * Handles Vercel's proxy headers
 */
export function getClientIP(request: Request): string {
  // Check various headers for IP address
  const forwarded = request.headers.get("x-forwarded-for")
  const realIP = request.headers.get("x-real-ip")
  const cfConnectingIP = request.headers.get("cf-connecting-ip") // Cloudflare

  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim()
  }

  if (realIP) {
    return realIP
  }

  if (cfConnectingIP) {
    return cfConnectingIP
  }

  // Fallback (shouldn't happen in production)
  return "unknown"
}

/**
 * Create a device fingerprint from available request headers
 * Combines IP with User-Agent and other headers to create a unique identifier
 * This provides similar functionality to MAC address tracking but using available data
 * 
 * Note: MAC addresses are NOT available in HTTP requests (they're layer 2 addresses
 * that are stripped at each router hop). This function uses available headers instead.
 */
export function createDeviceFingerprint(request: Request): string {
  const ip = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"
  const acceptLanguage = request.headers.get("accept-language") || "unknown"
  const acceptEncoding = request.headers.get("accept-encoding") || "unknown"
  
  // Create a simple hash-like identifier from these values
  // This creates a more unique identifier than IP alone
  const fingerprint = `${ip}|${userAgent}|${acceptLanguage}|${acceptEncoding}`
  
  // Create a simple hash (not cryptographically secure, but good enough for rate limiting)
  // Using a simple hash to keep it short and consistent
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  
  // Return IP + hash for better readability and debugging
  return `${ip}:${Math.abs(hash).toString(36)}`
}

/**
 * Get rate limit identifier from request
 * Uses device fingerprint (IP + User-Agent + other headers) for better tracking
 * 
 * @param request - HTTP request object
 * @param useFingerprint - Whether to use device fingerprint
 *                        If not provided, reads from RATE_LIMIT_USE_FINGERPRINT env var (default: true)
 *                        If false, uses only IP address
 * @returns Identifier string for rate limiting
 */
export function getRateLimitIdentifier(
  request: Request,
  useFingerprint?: boolean
): string {
  // Check environment variable if useFingerprint not explicitly provided
  if (useFingerprint === undefined) {
    useFingerprint = process.env.RATE_LIMIT_USE_FINGERPRINT !== "false"
  }
  
  if (useFingerprint) {
    return createDeviceFingerprint(request)
  }
  return getClientIP(request)
}

