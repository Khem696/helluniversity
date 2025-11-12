/**
 * API Client Helper
 * 
 * Standardized API response format helper
 * All API endpoints use the standardized format:
 * {
 *   success: boolean,
 *   data?: T,
 *   error?: { code: string, message: string, details?: any },
 *   meta?: { requestId: string, timestamp: string }
 * }
 */

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  meta?: {
    requestId: string
    timestamp: string
    [key: string]: any
  }
}

/**
 * Extract error message from API response
 */
export function getErrorMessage(response: ApiResponse): string | null {
  if (!response.error) return null
  return response.error.message || null
}

/**
 * Type-safe API fetch helper
 * Automatically handles the standardized response structure
 */
export async function fetchApi<T = any>(
  url: string,
  options?: RequestInit
): Promise<{
  response: Response
  data: ApiResponse<T>
}> {
  const response = await fetch(url, options)
  const data = await response.json() as ApiResponse<T>
  
  return {
    response,
    data,
  }
}

/**
 * Extract data from API response
 * Handles both { success: true, data: {...} } and legacy { success: true, ... } formats
 * 
 * @param apiResponse - The API response object
 * @param fallbackKey - Optional key to check if data.data doesn't exist (for backward compatibility)
 * @returns The data object or null
 */
export function extractApiData<T = any>(
  apiResponse: ApiResponse<T>,
  fallbackKey?: string
): T | null {
  if (!apiResponse.success) {
    return null
  }

  // Standard format: { success: true, data: {...} }
  if (apiResponse.data !== undefined) {
    return apiResponse.data as T
  }

  // Legacy format: { success: true, ... } - extract all properties except success, error, meta
  if (fallbackKey && (apiResponse as any)[fallbackKey] !== undefined) {
    return (apiResponse as any)[fallbackKey] as T
  }

  // If no data and no fallback, return null
  return null
}

/**
 * Extract array data from API response
 * Handles both { success: true, data: { items: [...] } } and { success: true, data: [...] } formats
 * 
 * @param apiResponse - The API response object
 * @param arrayKey - The key containing the array (e.g., 'events', 'images', 'bookings')
 * @returns The array or empty array
 */
export function extractApiArray<T = any>(
  apiResponse: ApiResponse<any>,
  arrayKey: string
): T[] {
  if (!apiResponse.success) {
    return []
  }

  // Standard format: { success: true, data: { [arrayKey]: [...] } }
  if (apiResponse.data && typeof apiResponse.data === 'object' && arrayKey in apiResponse.data) {
    const array = (apiResponse.data as any)[arrayKey]
    return Array.isArray(array) ? array : []
  }

  // Legacy format: { success: true, [arrayKey]: [...] }
  if ((apiResponse as any)[arrayKey]) {
    const array = (apiResponse as any)[arrayKey]
    return Array.isArray(array) ? array : []
  }

  // If data is directly an array (rare case)
  if (Array.isArray(apiResponse.data)) {
    return apiResponse.data as T[]
  }

  return []
}
