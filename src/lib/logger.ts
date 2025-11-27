/**
 * Structured Logging Utility
 * 
 * Provides consistent logging with levels, context, and error tracking
 * Supports console logging (development) and error tracking services (production)
 */

import { getTursoClient } from './turso'
import { randomUUID } from 'crypto'

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogContext {
  userId?: string
  requestId?: string
  endpoint?: string
  bookingId?: string
  adminEmail?: string
  [key: string]: any
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

/**
 * Log a message with optional context and error
 */
export async function log(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): Promise<void> {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : undefined,
  }

  // Console logging (always, for development and production debugging)
  const consoleMethod = level === LogLevel.DEBUG ? 'debug' : level
  if (consoleMethod === 'debug' && process.env.NODE_ENV === 'production') {
    // Skip debug logs in production
    return
  }

  const logString = JSON.stringify(logEntry, null, process.env.NODE_ENV === 'development' ? 2 : 0)
  console[consoleMethod](logString)

  // Send to error tracking service (production only)
  if (level === LogLevel.ERROR && process.env.NODE_ENV === 'production') {
    try {
      // Integrate with Sentry or similar service if configured
      if (process.env.SENTRY_DSN) {
        // Dynamic import to avoid breaking if Sentry not installed
        // Use Function constructor to prevent Turbopack from analyzing the import at build time
        try {
          // Check if module exists before importing (prevents build-time analysis)
          const sentryModulePath = '@sentry/nextjs'
          // Use dynamic import with string variable to prevent static analysis
          const importSentry = new Function('modulePath', 'return import(modulePath)')
          const Sentry = await importSentry(sentryModulePath)
          if (Sentry && Sentry.captureException) {
            Sentry.captureException(error || new Error(message), {
              level: 'error',
              tags: context,
              extra: context,
            })
          }
        } catch (sentryError) {
          // Sentry not available, continue without it
          // This is expected if @sentry/nextjs is not installed
        }
      }
    } catch (trackingError) {
      // Don't fail if error tracking fails
      console.error('Failed to send error to tracking service:', trackingError)
    }
  }

  // Store errors in database for analysis (optional, can be disabled)
  if (level === LogLevel.ERROR && process.env.LOG_ERRORS_TO_DB !== 'false') {
    try {
      const db = getTursoClient()
      const errorId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      await db.execute({
        sql: `INSERT INTO error_logs (
          id, level, message, context, error_name, error_message, error_stack, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          errorId,
          level,
          message,
          context ? JSON.stringify(context) : null,
          error?.name || null,
          error?.message || null,
          error?.stack || null,
          now,
        ],
      })
    } catch (dbError) {
      // Don't fail if database logging fails (avoid infinite loops)
      // Only log to console to avoid recursion
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to log error to database:', dbError)
      }
    }
  }
}

/**
 * Convenience methods for each log level
 */
export async function logDebug(message: string, context?: LogContext): Promise<void> {
  await log(LogLevel.DEBUG, message, context)
}

export async function logInfo(message: string, context?: LogContext): Promise<void> {
  await log(LogLevel.INFO, message, context)
}

export async function logWarn(message: string, context?: LogContext): Promise<void> {
  await log(LogLevel.WARN, message, context)
}

export async function logError(
  message: string,
  context?: LogContext,
  error?: Error
): Promise<void> {
  await log(LogLevel.ERROR, message, context, error)
}

/**
 * Create a request logger with request ID
 */
export function createRequestLogger(requestId: string, endpoint?: string) {
  const baseContext: LogContext = {
    requestId,
    endpoint,
  }

  return {
    debug: (message: string, additionalContext?: LogContext) =>
      logDebug(message, { ...baseContext, ...additionalContext }),
    info: (message: string, additionalContext?: LogContext) =>
      logInfo(message, { ...baseContext, ...additionalContext }),
    warn: (message: string, additionalContext?: LogContext) =>
      logWarn(message, { ...baseContext, ...additionalContext }),
    error: (message: string, error?: Error, additionalContext?: LogContext) =>
      logError(message, { ...baseContext, ...additionalContext }, error),
  }
}

/**
 * Measure and log performance
 */
export async function logPerformance(
  operation: string,
  duration: number,
  context?: LogContext
): Promise<void> {
  const message = `${operation} took ${duration}ms`
  
  if (duration > 1000) {
    // Slow operation warning
    await logWarn(message, { ...context, operation, duration })
  } else {
    await logInfo(message, { ...context, operation, duration })
  }
}

/**
 * Wrap an async function with logging
 */
export async function withLogging<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const startTime = Date.now()
  const requestId = context?.requestId || randomUUID()
  
  try {
    await logInfo(`Starting ${operation}`, { ...context, requestId })
    const result = await fn()
    const duration = Date.now() - startTime
    await logPerformance(operation, duration, { ...context, requestId })
    return result
  } catch (error) {
    const duration = Date.now() - startTime
    await logError(
      `${operation} failed after ${duration}ms`,
      { ...context, requestId },
      error instanceof Error ? error : new Error(String(error))
    )
    throw error
  }
}

/**
 * Clean up old error logs from the database
 * 
 * @param daysToKeep - Number of days to keep logs (default: 30)
 * @returns Number of deleted log entries
 */
export async function cleanupOldErrorLogs(daysToKeep: number = 30): Promise<number> {
  try {
    const db = getTursoClient()
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60)
    
    const result = await db.execute({
      sql: `DELETE FROM error_logs WHERE created_at < ?`,
      args: [cutoffTimestamp],
    })
    
    return result.rowsAffected || 0
  } catch (error) {
    // Log cleanup errors but don't throw - this is a maintenance task
    console.error('[logger] Failed to cleanup old error logs:', error)
    return 0
  }
}

/**
 * Get error log statistics
 */
export async function getErrorLogStats(): Promise<{
  total: number
  byLevel: Record<string, number>
  last24Hours: number
  last7Days: number
}> {
  try {
    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)
    const oneDayAgo = now - (24 * 60 * 60)
    const sevenDaysAgo = now - (7 * 24 * 60 * 60)
    
    // Get total count
    const totalResult = await db.execute(`SELECT COUNT(*) as count FROM error_logs`)
    const total = (totalResult.rows[0] as any)?.count || 0
    
    // Get count by level
    const levelResult = await db.execute(`
      SELECT level, COUNT(*) as count 
      FROM error_logs 
      GROUP BY level
    `)
    const byLevel: Record<string, number> = {}
    for (const row of levelResult.rows) {
      const r = row as any
      byLevel[r.level] = r.count
    }
    
    // Get last 24 hours
    const last24Result = await db.execute({
      sql: `SELECT COUNT(*) as count FROM error_logs WHERE created_at >= ?`,
      args: [oneDayAgo],
    })
    const last24Hours = (last24Result.rows[0] as any)?.count || 0
    
    // Get last 7 days
    const last7Result = await db.execute({
      sql: `SELECT COUNT(*) as count FROM error_logs WHERE created_at >= ?`,
      args: [sevenDaysAgo],
    })
    const last7Days = (last7Result.rows[0] as any)?.count || 0
    
    return { total, byLevel, last24Hours, last7Days }
  } catch {
    return { total: 0, byLevel: {}, last24Hours: 0, last7Days: 0 }
  }
}

