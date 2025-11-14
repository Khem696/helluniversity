/**
 * API Versioning Utilities
 * 
 * Provides version detection and routing utilities for API versioning
 * Supports both URL-based (/api/v1/...) and header-based (X-API-Version) versioning
 */

import { NextResponse } from 'next/server'

export type ApiVersion = 'v1' | 'latest'

export const DEFAULT_API_VERSION: ApiVersion = 'v1'
export const LATEST_API_VERSION: ApiVersion = 'v1'

/**
 * Extract API version from request
 * Supports:
 * 1. URL path: /api/v1/booking
 * 2. Header: X-API-Version: v1
 * 3. Query param: ?version=v1
 * 
 * Defaults to DEFAULT_API_VERSION if not specified
 */
export function getApiVersion(request: Request): ApiVersion {
  const url = new URL(request.url)
  
  // 1. Check URL path for version (e.g., /api/v1/booking)
  const pathMatch = url.pathname.match(/^\/api\/(v\d+)\//)
  if (pathMatch) {
    const version = pathMatch[1] as ApiVersion
    if (isValidVersion(version)) {
      return version
    }
  }
  
  // 2. Check X-API-Version header
  const headerVersion = request.headers.get('X-API-Version')
  if (headerVersion && isValidVersion(headerVersion as ApiVersion)) {
    return headerVersion as ApiVersion
  }
  
  // 3. Check query parameter
  const queryVersion = url.searchParams.get('version')
  if (queryVersion && isValidVersion(queryVersion as ApiVersion)) {
    return queryVersion as ApiVersion
  }
  
  // 4. Default to latest version
  return DEFAULT_API_VERSION
}

/**
 * Check if version string is valid
 */
function isValidVersion(version: string): version is ApiVersion {
  return version === 'v1' || version === 'latest'
}

/**
 * Normalize version (convert 'latest' to actual latest version)
 */
export function normalizeVersion(version: ApiVersion): ApiVersion {
  return version === 'latest' ? LATEST_API_VERSION : version
}

/**
 * Get versioned API path
 * Example: getVersionedPath('/api/booking', 'v1') => '/api/v1/booking'
 */
export function getVersionedPath(basePath: string, version: ApiVersion = DEFAULT_API_VERSION): string {
  // Remove leading /api if present
  const cleanPath = basePath.startsWith('/api/') 
    ? basePath.replace('/api/', '') 
    : basePath.replace(/^\/api/, '')
  
  return `/api/${version}/${cleanPath}`
}

/**
 * Get base path from versioned path
 * Example: getBasePath('/api/v1/booking') => '/api/booking'
 */
export function getBasePath(versionedPath: string): string {
  return versionedPath.replace(/^\/api\/v\d+\//, '/api/')
}

/**
 * Check if path is versioned
 */
export function isVersionedPath(path: string): boolean {
  return /^\/api\/v\d+\//.test(path)
}

/**
 * API Version Information
 */
export interface ApiVersionInfo {
  version: ApiVersion
  isLatest: boolean
  deprecated: boolean
  deprecationDate?: string
  sunsetDate?: string
}

/**
 * Get version information
 */
export function getVersionInfo(version: ApiVersion): ApiVersionInfo {
  const normalized = normalizeVersion(version)
  
  return {
    version: normalized,
    isLatest: normalized === LATEST_API_VERSION,
    deprecated: false, // v1 is current, not deprecated
    // Add deprecation dates when v2 is released
  }
}

/**
 * Add version headers to response
 */
export function addVersionHeaders(response: NextResponse, version: ApiVersion): NextResponse {
  const versionInfo = getVersionInfo(version)
  
  response.headers.set('X-API-Version', version)
  response.headers.set('X-API-Latest-Version', LATEST_API_VERSION)
  
  if (versionInfo.deprecated) {
    response.headers.set('X-API-Deprecated', 'true')
    if (versionInfo.deprecationDate) {
      response.headers.set('X-API-Deprecation-Date', versionInfo.deprecationDate)
    }
    if (versionInfo.sunsetDate) {
      response.headers.set('X-API-Sunset-Date', versionInfo.sunsetDate)
    }
  }
  
  return response
}

/**
 * Get the actual request path from a Request object
 * This extracts the pathname from the request URL, preserving versioning
 * Example: Request to /api/v1/admin/bookings returns '/api/v1/admin/bookings'
 */
export function getRequestPath(request: Request): string {
  const url = new URL(request.url)
  return url.pathname
}

