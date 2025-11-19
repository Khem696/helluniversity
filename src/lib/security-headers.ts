/**
 * Security Headers Middleware
 * 
 * Provides consistent security headers across all API endpoints
 * Prevents XSS, clickjacking, and other common web vulnerabilities
 */

import { NextResponse } from 'next/server'

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  frameOptions?: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM'
  contentTypeOptions?: boolean
  xssProtection?: boolean
  referrerPolicy?: 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url'
  contentSecurityPolicy?: string
  permissionsPolicy?: string
}

/**
 * Default security headers configuration
 */
const DEFAULT_CONFIG: SecurityHeadersConfig = {
  frameOptions: 'DENY',
  contentTypeOptions: true,
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  contentSecurityPolicy: "default-src 'self'",
  permissionsPolicy: 'geolocation=(), microphone=(), camera=()',
}

/**
 * Add security headers to a NextResponse
 */
export function addSecurityHeaders(
  response: NextResponse,
  config: SecurityHeadersConfig = {}
): NextResponse {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  // X-Frame-Options: Prevent clickjacking
  if (finalConfig.frameOptions) {
    response.headers.set('X-Frame-Options', finalConfig.frameOptions)
  }

  // X-Content-Type-Options: Prevent MIME type sniffing
  if (finalConfig.contentTypeOptions) {
    response.headers.set('X-Content-Type-Options', 'nosniff')
  }

  // X-XSS-Protection: Enable XSS filter (legacy, but still useful)
  if (finalConfig.xssProtection) {
    response.headers.set('X-XSS-Protection', '1; mode=block')
  }

  // Referrer-Policy: Control referrer information
  if (finalConfig.referrerPolicy) {
    response.headers.set('Referrer-Policy', finalConfig.referrerPolicy)
  }

  // Content-Security-Policy: Prevent XSS and injection attacks
  if (finalConfig.contentSecurityPolicy) {
    response.headers.set('Content-Security-Policy', finalConfig.contentSecurityPolicy)
  }

  // Permissions-Policy: Control browser features
  if (finalConfig.permissionsPolicy) {
    response.headers.set('Permissions-Policy', finalConfig.permissionsPolicy)
  }

  return response
}

/**
 * Wrapper for API response functions to automatically add security headers
 */
export function withSecurityHeaders<T>(
  response: NextResponse<T>,
  config?: SecurityHeadersConfig
): NextResponse<T> {
  return addSecurityHeaders(response, config) as NextResponse<T>
}

