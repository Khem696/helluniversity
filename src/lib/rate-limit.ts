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
    // Get current count for this identifier, endpoint, and window
    const result = await db.execute({
      sql: `
        SELECT count 
        FROM rate_limits 
        WHERE identifier = ? AND endpoint = ? AND window_start = ?
      `,
      args: [identifier, endpoint, windowStart],
    })

    let currentCount = 0
    if (result.rows.length > 0) {
      currentCount = (result.rows[0] as any).count
    }

    // Check if limit exceeded
    if (currentCount >= limit) {
      const reset = windowStart + windowSeconds
      return {
        success: false,
        limit,
        remaining: 0,
        reset,
      }
    }

    // Increment count (or insert if doesn't exist)
    if (currentCount === 0) {
      await db.execute({
        sql: `
          INSERT INTO rate_limits (identifier, endpoint, count, window_start)
          VALUES (?, ?, 1, ?)
        `,
        args: [identifier, endpoint, windowStart],
      })
    } else {
      await db.execute({
        sql: `
          UPDATE rate_limits 
          SET count = count + 1 
          WHERE identifier = ? AND endpoint = ? AND window_start = ?
        `,
        args: [identifier, endpoint, windowStart],
      })
    }

    const remaining = limit - (currentCount + 1)
    const reset = windowStart + windowSeconds

    return {
      success: true,
      limit,
      remaining: Math.max(0, remaining),
      reset,
    }
  } catch (error) {
    console.error("Rate limit check error:", error)
    // On error, allow the request (fail open)
    // In production, you might want to fail closed instead
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
    console.error("Rate limit cleanup error:", error)
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

