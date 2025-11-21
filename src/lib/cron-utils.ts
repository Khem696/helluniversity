/**
 * Cron Job Utilities
 * 
 * Common utilities for cron job routes to ensure smooth execution
 */

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
export function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`))
    }, ms)
  })
}

/**
 * Execute a function with a timeout
 * Returns the result if completed within timeout, otherwise throws
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  return Promise.race([
    fn(),
    createTimeout(timeoutMs).then(() => {
      throw new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`)
    })
  ])
}

/**
 * Verify cron secret from request headers
 * Returns true if valid, throws error if invalid
 * 
 * Vercel cron jobs send the Authorization header as: "Bearer <CRON_SECRET>"
 * We also check for x-vercel-signature header as a fallback (if Vercel uses it)
 */
export function verifyCronSecret(request: Request): void {
  const authHeader = request.headers.get('authorization')
  const vercelSignature = request.headers.get('x-vercel-signature')
  const cronSecret = process.env.CRON_SECRET

  // Debug logging to help diagnose authentication issues (no credential exposure)
  console.log('[verifyCronSecret] Checking cron authentication:', {
    hasAuthHeader: !!authHeader,
    authHeaderLength: authHeader?.length || 0,
    hasVercelSignature: !!vercelSignature,
    vercelSignatureLength: vercelSignature?.length || 0,
    hasCronSecret: !!cronSecret,
    cronSecretLength: cronSecret?.length || 0,
  })

  if (!cronSecret) {
    console.error('[verifyCronSecret] CRON_SECRET not configured in environment variables')
    throw new Error('CRON_SECRET not configured')
  }

  // Check Authorization header (standard Vercel cron format)
  if (authHeader === `Bearer ${cronSecret}`) {
    console.log('[verifyCronSecret] Authentication successful via Authorization header')
    return
  }

  // Check x-vercel-signature header (alternative Vercel format, if used)
  if (vercelSignature && vercelSignature === cronSecret) {
    console.log('[verifyCronSecret] Authentication successful via x-vercel-signature header')
    return
  }

  // Log detailed failure info for debugging (with fully redacted sensitive headers)
  const safeHeaders: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    // Fully redact sensitive headers to prevent any credential exposure in logs
    if (lowerKey === 'authorization' || lowerKey === 'x-vercel-signature') {
      safeHeaders[key] = `[REDACTED] (length: ${value.length})`
    } else {
      safeHeaders[key] = value
    }
  })

  console.error('[verifyCronSecret] Authentication failed:', {
    expectedFormat: 'Bearer <CRON_SECRET>',
    receivedAuthHeader: authHeader ? `[REDACTED] (length: ${authHeader.length})` : 'null',
    receivedVercelSignature: vercelSignature ? `[REDACTED] (length: ${vercelSignature.length})` : 'null',
    headers: safeHeaders,
  })

  throw new Error('Unauthorized cron job attempt')
}

/**
 * Cron job execution timeout (25 seconds - safety margin before 30s Vercel limit)
 */
export const CRON_TIMEOUT_MS = 25000

/**
 * Default limits for cron jobs
 */
export const CRON_LIMITS = {
  JOB_QUEUE: 10,
  EMAIL_QUEUE: 20,
  AUTO_UPDATE_BATCH: 50,
} as const

