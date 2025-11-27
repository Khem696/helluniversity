/**
 * System Monitoring and Alerting
 * 
 * Provides monitoring capabilities for:
 * - Race condition detection
 * - Performance metrics
 * - Error rate tracking
 * - System health alerts
 */

import { getTursoClient } from './turso'
import { logWarn, logError, type LogContext } from './logger'

export interface MonitoringMetrics {
  timestamp: number
  rateLimitHits: number
  rateLimitBypasses: number
  optimisticLockConflicts: number
  collisionRetries: number
  stuckItemResets: number
  transactionFailures: number
  cacheInvalidationFailures: number
}

export interface AlertThresholds {
  rateLimitBypassRate?: number // Percentage of requests bypassing rate limits
  optimisticLockConflictRate?: number // Percentage of updates with conflicts
  collisionRetryRate?: number // Percentage of operations requiring retries
  stuckItemCount?: number // Number of stuck items
  transactionFailureRate?: number // Percentage of transaction failures
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  rateLimitBypassRate: 5, // Alert if >5% of requests bypass rate limits
  optimisticLockConflictRate: 10, // Alert if >10% of updates have conflicts
  collisionRetryRate: 1, // Alert if >1% of operations require retries
  stuckItemCount: 10, // Alert if >10 stuck items
  transactionFailureRate: 5, // Alert if >5% of transactions fail
}

// In-memory metrics tracking (last 1 hour)
const metricsWindow: MonitoringMetrics[] = []
const METRICS_WINDOW_SIZE = 60 // 60 minutes
const METRICS_CLEANUP_INTERVAL = 5 * 60 * 1000 // Cleanup every 5 minutes

/**
 * Track a rate limit hit (request was rate limited)
 */
export function trackRateLimitHit(endpoint: string, identifier: string): void {
  addMetric('rateLimitHits', { endpoint, identifier })
}

/**
 * Track a rate limit bypass (shouldn't happen with atomic operations)
 */
export function trackRateLimitBypass(endpoint: string, identifier: string): void {
  addMetric('rateLimitBypasses', { endpoint, identifier })
  // This is a critical issue - log immediately
  logWarn('Rate limit bypass detected', { endpoint, identifier }).catch(() => {
    // Ignore logging errors
  })
}

/**
 * Track an optimistic locking conflict
 */
export function trackOptimisticLockConflict(
  resourceType: string,
  resourceId: string,
  context?: LogContext
): void {
  addMetric('optimisticLockConflicts', { resourceType, resourceId, ...context })
}

/**
 * Track a collision retry (token/reference number collision)
 */
export function trackCollisionRetry(
  type: 'token' | 'reference',
  attempt: number,
  context?: LogContext
): void {
  addMetric('collisionRetries', { type, attempt, ...context })
  
  // Log if retry count is high (potential issue)
  if (attempt >= 2) {
    logWarn(`High collision retry count for ${type}`, { type, attempt, ...context }).catch(() => {
      // Ignore logging errors
    })
  }
}

/**
 * Track stuck item reset
 */
export function trackStuckItemReset(
  type: 'job' | 'email',
  count: number
): void {
  addMetric('stuckItemResets', { type, count })
  
  // Log if many items were reset
  if (count > 5) {
    logWarn(`Multiple stuck ${type}s reset`, { type, count }).catch(() => {
      // Ignore logging errors
    })
  }
}

/**
 * Track transaction failure
 */
export function trackTransactionFailure(
  operation: string,
  error: Error,
  context?: LogContext
): void {
  addMetric('transactionFailures', { operation, error: error.message, ...context })
  logError(`Transaction failure: ${operation}`, { ...context, operation }, error).catch(() => {
    // Ignore logging errors
  })
}

/**
 * Track cache invalidation failure
 */
export function trackCacheInvalidationFailure(
  pattern: string,
  error: Error
): void {
  addMetric('cacheInvalidationFailures', { pattern, error: error.message })
  // Cache failures are non-critical, so only log at warn level
  logWarn(`Cache invalidation failed`, { pattern, error: error.message }).catch(() => {
    // Ignore logging errors
  })
}

/**
 * Add a metric to the tracking window
 */
function addMetric(
  metricType: keyof Omit<MonitoringMetrics, 'timestamp'>,
  context?: Record<string, any>
): void {
  const now = Date.now()
  const currentMinute = Math.floor(now / 60000) * 60000 // Round to minute
  
  // Find or create metric entry for this minute
  let metric = metricsWindow.find(m => m.timestamp === currentMinute)
  if (!metric) {
    metric = {
      timestamp: currentMinute,
      rateLimitHits: 0,
      rateLimitBypasses: 0,
      optimisticLockConflicts: 0,
      collisionRetries: 0,
      stuckItemResets: 0,
      transactionFailures: 0,
      cacheInvalidationFailures: 0,
    }
    metricsWindow.push(metric)
    
    // Keep only last METRICS_WINDOW_SIZE minutes
    if (metricsWindow.length > METRICS_WINDOW_SIZE) {
      metricsWindow.shift()
    }
  }
  
  // Increment the metric
  metric[metricType]++
  
  // Store additional context if needed (for detailed analysis)
  if (context && Object.keys(context).length > 0) {
    // Could store in database for detailed analysis, but for now just track counts
  }
}

/**
 * Get current metrics summary
 */
export function getMetricsSummary(): {
  lastHour: MonitoringMetrics
  alerts: Array<{ type: string; message: string; severity: 'warning' | 'error' }>
} {
  const now = Date.now()
  const oneHourAgo = now - (60 * 60 * 1000)
  
  // Aggregate metrics from last hour
  const lastHour: MonitoringMetrics = {
    timestamp: now,
    rateLimitHits: 0,
    rateLimitBypasses: 0,
    optimisticLockConflicts: 0,
    collisionRetries: 0,
    stuckItemResets: 0,
    transactionFailures: 0,
    cacheInvalidationFailures: 0,
  }
  
  for (const metric of metricsWindow) {
    if (metric.timestamp >= oneHourAgo) {
      lastHour.rateLimitHits += metric.rateLimitHits
      lastHour.rateLimitBypasses += metric.rateLimitBypasses
      lastHour.optimisticLockConflicts += metric.optimisticLockConflicts
      lastHour.collisionRetries += metric.collisionRetries
      lastHour.stuckItemResets += metric.stuckItemResets
      lastHour.transactionFailures += metric.transactionFailures
      lastHour.cacheInvalidationFailures += metric.cacheInvalidationFailures
    }
  }
  
  // Check for alerts
  const alerts: Array<{ type: string; message: string; severity: 'warning' | 'error' }> = []
  const thresholds = DEFAULT_THRESHOLDS
  
  // Calculate total operations for rate calculations
  const totalRateLimitChecks = lastHour.rateLimitHits + lastHour.rateLimitBypasses
  if (totalRateLimitChecks > 0) {
    const bypassRate = (lastHour.rateLimitBypasses / totalRateLimitChecks) * 100
    if (bypassRate > (thresholds.rateLimitBypassRate || 5)) {
      alerts.push({
        type: 'rate_limit_bypass',
        message: `High rate limit bypass rate: ${bypassRate.toFixed(2)}% (${lastHour.rateLimitBypasses} bypasses out of ${totalRateLimitChecks} checks)`,
        severity: 'error',
      })
    }
  }
  
  // Optimistic lock conflicts (need total update operations - approximate from conflicts)
  // For now, alert if conflicts are high in absolute terms
  if (lastHour.optimisticLockConflicts > 50) {
    alerts.push({
      type: 'optimistic_lock_conflicts',
      message: `High number of optimistic lock conflicts: ${lastHour.optimisticLockConflicts} in the last hour`,
      severity: 'warning',
    })
  }
  
  // Collision retries
  if (lastHour.collisionRetries > 10) {
    alerts.push({
      type: 'collision_retries',
      message: `High number of collision retries: ${lastHour.collisionRetries} in the last hour (unusual - investigate)`,
      severity: 'warning',
    })
  }
  
  // Stuck items
  if (lastHour.stuckItemResets > (thresholds.stuckItemCount || 10)) {
    alerts.push({
      type: 'stuck_items',
      message: `High number of stuck items reset: ${lastHour.stuckItemResets} in the last hour`,
      severity: 'warning',
    })
  }
  
  // Transaction failures
  if (lastHour.transactionFailures > 20) {
    alerts.push({
      type: 'transaction_failures',
      message: `High number of transaction failures: ${lastHour.transactionFailures} in the last hour`,
      severity: 'error',
    })
  }
  
  // Cache invalidation failures
  if (lastHour.cacheInvalidationFailures > 50) {
    alerts.push({
      type: 'cache_invalidation_failures',
      message: `High number of cache invalidation failures: ${lastHour.cacheInvalidationFailures} in the last hour`,
      severity: 'warning',
    })
  }
  
  return { lastHour, alerts }
}

/**
 * Check system health and send alerts if needed
 */
export async function checkSystemHealth(): Promise<{
  healthy: boolean
  metrics: MonitoringMetrics
  alerts: Array<{ type: string; message: string; severity: 'warning' | 'error' }>
}> {
  const { lastHour, alerts } = getMetricsSummary()
  
  // Log alerts
  for (const alert of alerts) {
    if (alert.severity === 'error') {
      await logError(`System Health Alert: ${alert.message}`, { alertType: alert.type }).catch(() => {
        // Ignore logging errors
      })
    } else {
      await logWarn(`System Health Alert: ${alert.message}`, { alertType: alert.type }).catch(() => {
        // Ignore logging errors
      })
    }
  }
  
  const healthy = alerts.filter(a => a.severity === 'error').length === 0
  
  return {
    healthy,
    metrics: lastHour,
    alerts,
  }
}

/**
 * Cleanup old metrics (called periodically)
 */
export function cleanupOldMetrics(): void {
  const now = Date.now()
  const oneHourAgo = now - (60 * 60 * 1000)
  
  // Remove metrics older than 1 hour
  const initialLength = metricsWindow.length
  while (metricsWindow.length > 0 && metricsWindow[0].timestamp < oneHourAgo) {
    metricsWindow.shift()
  }
  
  // Only log cleanup in development
  if (process.env.NODE_ENV !== 'production' && initialLength !== metricsWindow.length) {
    console.log(`[monitoring] Cleaned up ${initialLength - metricsWindow.length} old metric entries`)
  }
}

// Store interval ID for cleanup
let metricsCleanupInterval: NodeJS.Timeout | null = null

// Initialize cleanup interval
if (typeof setInterval !== 'undefined') {
  metricsCleanupInterval = setInterval(() => {
    cleanupOldMetrics()
  }, METRICS_CLEANUP_INTERVAL)
}

/**
 * Cleanup metrics interval (call on application shutdown)
 */
export function cleanupMetricsInterval(): void {
  if (metricsCleanupInterval) {
    clearInterval(metricsCleanupInterval)
    metricsCleanupInterval = null
  }
}



