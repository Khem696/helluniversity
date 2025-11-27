/**
 * Environment Variable Validation
 * 
 * Validates critical environment variables at application startup
 * to fail fast if configuration is invalid.
 */

import { logError, logWarn } from './logger'

interface EnvVarConfig {
  name: string
  required: boolean
  validator?: (value: string) => boolean
  errorMessage?: string
  defaultValue?: string
}

/**
 * Validate a single environment variable
 */
function validateEnvVar(config: EnvVarConfig): { valid: boolean; value: string | null; error?: string } {
  const value = process.env[config.name]
  
  // Check if required
  if (config.required && !value && !config.defaultValue) {
    return {
      valid: false,
      value: null,
      error: config.errorMessage || `${config.name} is required but not set`
    }
  }
  
  // Use default value if provided and env var is not set
  const finalValue = value || config.defaultValue || null
  
  // Run validator if provided
  if (finalValue && config.validator) {
    if (!config.validator(finalValue)) {
      return {
        valid: false,
        value: finalValue,
        error: config.errorMessage || `${config.name} has an invalid value: ${finalValue}`
      }
    }
  }
  
  return {
    valid: true,
    value: finalValue
  }
}

/**
 * Validate critical environment variables
 * 
 * This should be called at application startup to fail fast if configuration is invalid.
 * 
 * @returns Object with validation results
 */
export async function validateCriticalEnvVars(): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Critical environment variables that must be set
  const criticalVars: EnvVarConfig[] = [
    {
      name: 'TURSO_DATABASE_URL',
      required: true,
      validator: (value) => value.startsWith('file:') || value.startsWith('libsql://'),
      errorMessage: 'TURSO_DATABASE_URL must start with "file:" or "libsql://"'
    },
    {
      name: 'AUTH_SECRET',
      required: true,
      validator: (value) => value.length >= 32,
      errorMessage: 'AUTH_SECRET must be at least 32 characters long'
    },
    {
      name: 'GOOGLE_CLIENT_ID',
      required: true,
      validator: (value) => value.includes('.apps.googleusercontent.com'),
      errorMessage: 'GOOGLE_CLIENT_ID must be a valid Google OAuth client ID'
    },
    {
      name: 'GOOGLE_CLIENT_SECRET',
      required: true,
      validator: (value) => value.length > 0,
      errorMessage: 'GOOGLE_CLIENT_SECRET cannot be empty'
    },
    {
      name: 'GOOGLE_WORKSPACE_DOMAIN',
      required: true,
      validator: (value) => value.length > 0 && !value.includes(' '),
      errorMessage: 'GOOGLE_WORKSPACE_DOMAIN must be a valid domain name'
    }
  ]
  
  // Important but not critical (warnings only)
  const importantVars: EnvVarConfig[] = [
    {
      name: 'SMTP_USER',
      required: false,
      validator: (value) => value.includes('@'),
      errorMessage: 'SMTP_USER should be a valid email address'
    },
    {
      name: 'SMTP_PASS',
      required: false,
      validator: (value) => value.length > 0,
      errorMessage: 'SMTP_PASS should not be empty if SMTP_USER is set'
    },
    {
      name: 'RESERVATION_EMAIL',
      required: false,
      validator: (value) => value.includes('@'),
      errorMessage: 'RESERVATION_EMAIL should be a valid email address'
    },
    {
      name: 'RECAPTCHA_SECRET_KEY',
      required: false,
      validator: (value) => value.length > 0,
      errorMessage: 'RECAPTCHA_SECRET_KEY should not be empty if reCAPTCHA is used'
    },
    // Upstash Redis (for SSE cross-instance communication)
    {
      name: 'UPSTASH_REDIS_REST_URL',
      required: false,
      validator: (value) => value.startsWith('https://') && value.includes('upstash.io'),
      errorMessage: 'UPSTASH_REDIS_REST_URL should be a valid Upstash Redis REST URL'
    },
    {
      name: 'UPSTASH_REDIS_REST_TOKEN',
      required: false,
      validator: (value) => value.length > 20,
      errorMessage: 'UPSTASH_REDIS_REST_TOKEN should be a valid token (usually starts with "AX")'
    }
  ]
  
  // Validate critical variables
  for (const config of criticalVars) {
    const result = validateEnvVar(config)
    if (!result.valid) {
      errors.push(result.error || `${config.name} validation failed`)
    }
  }
  
  // Validate important variables (warnings only)
  for (const config of importantVars) {
    const result = validateEnvVar(config)
    if (!result.valid && result.value) {
      // Only warn if value is set but invalid
      warnings.push(result.error || `${config.name} has an invalid value`)
    } else if (config.required && !result.value) {
      // Warn if required but not set
      warnings.push(`${config.name} is recommended but not set`)
    }
  }
  
  // Log errors and warnings
  if (errors.length > 0) {
    // FIXED: Correct parameter order - logError(message, context?, error?) (TypeScript error fix)
    await logError('Critical environment variable validation failed', {
      errors,
      count: errors.length
    }, new Error(errors.join('; ')))
  }
  
  if (warnings.length > 0) {
    await logWarn('Environment variable validation warnings', {
      warnings,
      count: warnings.length
    })
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Get validated environment variable with fallback
 * 
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @param validator - Optional validator function
 * @returns The environment variable value or default
 */
export function getEnvVar(
  name: string,
  defaultValue?: string,
  validator?: (value: string) => boolean
): string {
  const value = process.env[name] || defaultValue
  
  if (!value) {
    throw new Error(`Environment variable ${name} is not set and no default value provided`)
  }
  
  if (validator && !validator(value)) {
    throw new Error(`Environment variable ${name} has an invalid value: ${value}`)
  }
  
  return value
}

/**
 * Get validated numeric environment variable
 * 
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @param min - Minimum value (optional)
 * @param max - Maximum value (optional)
 * @returns The numeric value
 */
export function getNumericEnvVar(
  name: string,
  defaultValue?: number,
  min?: number,
  max?: number
): number {
  const value = process.env[name]
  
  if (!value && defaultValue !== undefined) {
    return defaultValue
  }
  
  if (!value) {
    throw new Error(`Environment variable ${name} is not set and no default value provided`)
  }
  
  const numValue = parseInt(value, 10)
  
  if (isNaN(numValue)) {
    throw new Error(`Environment variable ${name} must be a valid number, got: ${value}`)
  }
  
  if (min !== undefined && numValue < min) {
    throw new Error(`Environment variable ${name} must be at least ${min}, got: ${numValue}`)
  }
  
  if (max !== undefined && numValue > max) {
    throw new Error(`Environment variable ${name} must be at most ${max}, got: ${numValue}`)
  }
  
  return numValue
}

/**
 * Get validated boolean environment variable
 * 
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The boolean value
 */
export function getBooleanEnvVar(name: string, defaultValue?: boolean): boolean {
  const value = process.env[name]
  
  if (!value && defaultValue !== undefined) {
    return defaultValue
  }
  
  if (!value) {
    throw new Error(`Environment variable ${name} is not set and no default value provided`)
  }
  
  const lowerValue = value.toLowerCase().trim()
  
  if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
    return true
  }
  
  if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
    return false
  }
  
  throw new Error(`Environment variable ${name} must be a valid boolean (true/false, 1/0, yes/no), got: ${value}`)
}

