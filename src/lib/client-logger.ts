/**
 * Client-Side Logger Utility
 * 
 * Provides structured logging for client-side React components.
 * Uses standard timestamps (UTC) for logs and behind-the-scenes operations.
 * Business logic should use Bangkok timezone via timezone-client utilities.
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogContext {
  [key: string]: any
}

export interface LogEntry {
  timestamp: string // ISO 8601 UTC timestamp
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
 * Log a message with optional context and error (client-side only)
 * Uses standard UTC timestamps for logs
 */
export function log(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): void {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(), // Standard UTC timestamp for logs
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

  // Note: Client-side logger does not send to database or Sentry
  // Those features are handled by the server-side logger
}

/**
 * Convenience methods for each log level
 */
export function logDebug(message: string, context?: LogContext): void {
  log(LogLevel.DEBUG, message, context)
}

export function logInfo(message: string, context?: LogContext): void {
  log(LogLevel.INFO, message, context)
}

export function logWarn(message: string, context?: LogContext): void {
  log(LogLevel.WARN, message, context)
}

export function logError(
  message: string,
  context?: LogContext,
  error?: Error
): void {
  log(LogLevel.ERROR, message, context, error)
}

