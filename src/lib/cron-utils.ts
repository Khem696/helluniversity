/**
 * Cron Job Utilities
 * 
 * Common utilities for cron job routes to ensure smooth execution
 */

import { logInfo, logError, logWarn } from './logger'

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

  // Debug logging only in development (no credential exposure)
  if (process.env.NODE_ENV !== 'production') {
    logInfo('[verifyCronSecret] Checking cron authentication', {
      hasAuthHeader: !!authHeader,
      authHeaderLength: authHeader?.length || 0,
      hasVercelSignature: !!vercelSignature,
      hasCronSecret: !!cronSecret,
    }).catch(() => {})
  }

  if (!cronSecret) {
    logError('[verifyCronSecret] CRON_SECRET not configured', {}, new Error('CRON_SECRET not configured')).catch(() => {})
    throw new Error('CRON_SECRET not configured')
  }

  // Check Authorization header (standard Vercel cron format)
  if (authHeader === `Bearer ${cronSecret}`) {
    return
  }

  // Check x-vercel-signature header (alternative Vercel format, if used)
  if (vercelSignature && vercelSignature === cronSecret) {
    return
  }

  // Log authentication failure (security event - always log, even in production)
  logWarn('[verifyCronSecret] Authentication failed', {
    hasAuthHeader: !!authHeader,
    hasVercelSignature: !!vercelSignature,
    // Never log actual header values
  }).catch(() => {})

  throw new Error('Unauthorized cron job attempt')
}

/**
 * Cron job execution timeout
 * 
 * Default: 25000ms (25 seconds) - safety margin before 30s Vercel limit
 * Can be configured via CRON_TIMEOUT_MS environment variable
 * 
 * Note: Vercel free/hobby plan has 10s limit, Pro has 300s for background functions
 * Adjust this based on your plan and expected execution time
 */
export const CRON_TIMEOUT_MS = parseInt(process.env.CRON_TIMEOUT_MS || '25000', 10)

/**
 * Default limits for cron jobs
 * Can be configured via environment variables
 */
export const CRON_LIMITS = {
  JOB_QUEUE: parseInt(process.env.CRON_JOB_QUEUE_LIMIT || '10', 10),
  EMAIL_QUEUE: parseInt(process.env.CRON_EMAIL_QUEUE_LIMIT || '20', 10),
  AUTO_UPDATE_BATCH: parseInt(process.env.CRON_AUTO_UPDATE_LIMIT || '50', 10),
} as const

