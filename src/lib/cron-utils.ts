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
 */
export function verifyCronSecret(request: Request): void {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('CRON_SECRET not configured')
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    throw new Error('Unauthorized cron job attempt')
  }
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

