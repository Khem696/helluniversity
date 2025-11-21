/**
 * Environment Detection and Configuration
 * 
 * This module provides utilities to detect and configure the application
 * based on the deployment environment (production, preview, development).
 * 
 * Vercel automatically sets:
 * - VERCEL_ENV: "production" | "preview" | "development"
 * - VERCEL_URL: The deployment URL (for preview/production)
 * - VERCEL: "1" when running on Vercel
 */

/**
 * Environment types
 */
export type Environment = 'production' | 'preview' | 'development'

/**
 * Get the current environment
 * 
 * Priority:
 * 1. VERCEL_ENV (set by Vercel)
 * 2. NODE_ENV (fallback for local development)
 * 
 * @returns The current environment
 */
export function getEnvironment(): Environment {
  // Vercel sets VERCEL_ENV automatically
  const vercelEnv = process.env.VERCEL_ENV
  
  if (vercelEnv === 'production' || vercelEnv === 'preview' || vercelEnv === 'development') {
    return vercelEnv
  }
  
  // Fallback for local development
  if (process.env.NODE_ENV === 'production') {
    // If NODE_ENV is production but not on Vercel, assume local production build
    return 'development'
  }
  
  return 'development'
}

/**
 * Check if running on Vercel
 */
export function isVercel(): boolean {
  return process.env.VERCEL === '1'
}

/**
 * Check if in production environment
 */
export function isProduction(): boolean {
  return getEnvironment() === 'production'
}

/**
 * Check if in preview environment (PR/branch deployments)
 */
export function isPreview(): boolean {
  return getEnvironment() === 'preview'
}

/**
 * Check if in development environment (local)
 */
export function isDevelopment(): boolean {
  return getEnvironment() === 'development'
}

/**
 * Get the base URL for the current environment
 * 
 * Priority:
 * 1. NEXT_PUBLIC_SITE_URL (explicitly set)
 * 2. VERCEL_URL (for preview/production on Vercel)
 * 3. Default localhost for development
 * 
 * @returns The base URL with protocol
 */
export function getBaseUrl(): string {
  // Explicit site URL takes precedence
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL
  }
  
  // On Vercel, use VERCEL_URL
  if (isVercel() && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  
  // Default to localhost for development
  return 'http://localhost:3000'
}

/**
 * Get environment-specific configuration
 * 
 * Use this to get different values based on the environment.
 * Useful for API endpoints, feature flags, etc.
 */
export function getEnvConfig<T>(config: {
  production: T
  preview: T
  development: T
}): T {
  const env = getEnvironment()
  return config[env]
}

/**
 * Get environment name for logging/debugging
 */
export function getEnvironmentName(): string {
  return getEnvironment()
}

/**
 * Get environment-specific database URL
 * 
 * In development, uses local file database
 * In preview/production, uses Turso remote database
 */
export function getDatabaseUrl(): string {
  const env = getEnvironment()
  
  if (env === 'development') {
    // Local development uses file-based database
    return process.env.TURSO_DATABASE_URL || 'file:./local.db'
  }
  
  // Preview and production use Turso remote database
  return process.env.TURSO_DATABASE_URL || ''
}

/**
 * Check if rate limiting should fail closed
 * 
 * Production: Always fail closed (strict)
 * Preview: Fail closed (strict, like production)
 * Development: Fail open (permissive for debugging)
 */
export function shouldRateLimitFailClosed(): boolean {
  const explicit = process.env.RATE_LIMIT_FAIL_CLOSED
  
  if (explicit === 'true') return true
  if (explicit === 'false') return false
  
  // Default: fail closed in production/preview, fail open in development
  return isProduction() || isPreview()
}

/**
 * Get environment-specific email configuration
 * 
 * Useful for using different email addresses or SMTP settings
 * per environment
 */
export function getEmailConfig() {
  const env = getEnvironment()
  
  return {
    from: process.env.SMTP_USER || '',
    to: process.env.RESERVATION_EMAIL || process.env.SMTP_USER || '',
    // In development, you might want to use a test email
    // Override RESERVATION_EMAIL in .env.local for development
    isTestMode: env === 'development',
  }
}

/**
 * Get environment info for debugging
 */
export function getEnvironmentInfo() {
  return {
    environment: getEnvironment(),
    isVercel: isVercel(),
    baseUrl: getBaseUrl(),
    vercelUrl: process.env.VERCEL_URL,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  }
}


