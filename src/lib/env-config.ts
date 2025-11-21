/**
 * Environment-Specific Configuration
 * 
 * This module provides environment-specific configurations for APIs,
 * services, and feature flags. Use this to configure different
 * endpoints, timeouts, and behaviors per environment.
 */

import { 
  getEnvironment, 
  isProduction, 
  isPreview, 
  isDevelopment,
  getEnvConfig 
} from './env'

/**
 * API Configuration
 */
export const apiConfig = {
  /**
   * API timeout in milliseconds
   */
  timeout: getEnvConfig({
    production: 30000,  // 30 seconds - production should be responsive
    preview: 30000,     // 30 seconds - same as production for testing
    development: 60000, // 60 seconds - more lenient for debugging
  }),

  /**
   * Retry configuration
   */
  retry: {
    maxAttempts: getEnvConfig({
      production: 3,
      preview: 3,
      development: 1, // No retries in dev for faster error feedback
    }),
    delay: getEnvConfig({
      production: 1000,  // 1 second
      preview: 1000,
      development: 0,    // No delay in dev
    }),
  },
}

/**
 * Database Configuration
 */
export const databaseConfig = {
  /**
   * Connection timeout
   */
  timeout: getEnvConfig({
    production: 10000,  // 10 seconds
    preview: 10000,
    development: 30000, // 30 seconds - more lenient for local
  }),

  /**
   * Enable query logging
   */
  logQueries: getEnvConfig({
    production: false,
    preview: false,
    development: true, // Log queries in development
  }),
}

/**
 * Email Configuration
 */
export const emailConfig = {
  /**
   * Enable email sending
   * Set to false to disable emails in development
   */
  enabled: getEnvConfig({
    production: true,
    preview: true,
    development: true, // Set to false if you don't want emails in dev
  }),

  /**
   * Email rate limit (emails per minute)
   */
  rateLimit: getEnvConfig({
    production: 30,  // 30 emails per minute
    preview: 30,
    development: 10, // Lower limit for development
  }),

  /**
   * Use test mode (don't send real emails, just log)
   */
  testMode: getEnvConfig({
    production: false,
    preview: false,
    development: false, // Set to true to prevent sending emails in dev
  }),
}

/**
 * Rate Limiting Configuration
 */
export const rateLimitConfig = {
  /**
   * Requests per window
   */
  limit: getEnvConfig({
    production: 5,
    preview: 5,
    development: 100, // Much higher limit for development
  }),

  /**
   * Window size in seconds
   */
  window: getEnvConfig({
    production: 600,  // 10 minutes
    preview: 600,
    development: 60,  // 1 minute for faster testing
  }),

  /**
   * Fail closed (strict) or fail open (permissive)
   */
  failClosed: getEnvConfig({
    production: true,
    preview: true,
    development: false, // Fail open in dev for easier debugging
  }),
}

/**
 * Image Processing Configuration
 */
export const imageConfig = {
  /**
   * Maximum file size (bytes)
   */
  maxFileSize: getEnvConfig({
    production: 20971520,  // 20MB
    preview: 20971520,
    development: 52428800, // 50MB - larger for testing
  }),

  /**
   * Maximum processed size (bytes)
   */
  maxProcessedSize: getEnvConfig({
    production: 5242880,   // 5MB
    preview: 5242880,
    development: 10485760, // 10MB
  }),

  /**
   * Enable image optimization
   */
  optimize: getEnvConfig({
    production: true,
    preview: true,
    development: false, // Skip optimization in dev for speed
  }),
}

/**
 * Logging Configuration
 */
export const loggingConfig = {
  /**
   * Log level
   */
  level: getEnvConfig({
    production: 'error' as const,  // Only errors in production
    preview: 'warn' as const,      // Warnings and errors in preview
    development: 'debug' as const, // All logs in development
  }),

  /**
   * Enable console logging
   */
  console: getEnvConfig({
    production: false,
    preview: true,
    development: true,
  }),

  /**
   * Log to database
   */
  database: getEnvConfig({
    production: true,
    preview: true,
    development: false, // Don't log to DB in dev
  }),
}

/**
 * Feature Flags
 * 
 * Use these to enable/disable features per environment
 */
export const features = {
  /**
   * Enable analytics
   */
  analytics: getEnvConfig({
    production: true,
    preview: false, // Disable in preview to avoid polluting analytics
    development: false,
  }),

  /**
   * Enable error tracking (e.g., Sentry)
   */
  errorTracking: getEnvConfig({
    production: true,
    preview: true,
    development: false,
  }),

  /**
   * Enable performance monitoring
   */
  performanceMonitoring: getEnvConfig({
    production: true,
    preview: false,
    development: false,
  }),

  /**
   * Enable debug mode
   */
  debug: getEnvConfig({
    production: false,
    preview: true,  // Enable in preview for testing
    development: true,
  }),
}

/**
 * Get all configuration for current environment
 */
export function getConfig() {
  return {
    environment: getEnvironment(),
    api: apiConfig,
    database: databaseConfig,
    email: emailConfig,
    rateLimit: rateLimitConfig,
    image: imageConfig,
    logging: loggingConfig,
    features,
  }
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof features): boolean {
  return features[feature]
}

/**
 * Get configuration summary for debugging
 */
export function getConfigSummary() {
  const env = getEnvironment()
  
  return {
    environment: env,
    isProduction: isProduction(),
    isPreview: isPreview(),
    isDevelopment: isDevelopment(),
    api: {
      timeout: apiConfig.timeout,
      retryAttempts: apiConfig.retry.maxAttempts,
    },
    database: {
      timeout: databaseConfig.timeout,
      logQueries: databaseConfig.logQueries,
    },
    email: {
      enabled: emailConfig.enabled,
      testMode: emailConfig.testMode,
    },
    rateLimit: {
      limit: rateLimitConfig.limit,
      window: rateLimitConfig.window,
      failClosed: rateLimitConfig.failClosed,
    },
    features: {
      analytics: features.analytics,
      errorTracking: features.errorTracking,
      debug: features.debug,
    },
  }
}


