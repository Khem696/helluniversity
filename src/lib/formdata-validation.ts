/**
 * FormData Validation Utilities
 * 
 * Provides validation for FormData requests to prevent DoS attacks
 * and ensure proper file upload handling.
 */

/**
 * Maximum allowed FormData size (in bytes)
 * Default: 20MB (20971520 bytes) - allows for file + metadata
 * Can be overridden via MAX_FORMDATA_SIZE environment variable
 */
const MAX_FORMDATA_SIZE = parseInt(
  process.env.MAX_FORMDATA_SIZE || '20971520',
  10
)

/**
 * Validate FormData size from request
 * 
 * @param request - The Request object containing FormData
 * @param maxSize - Maximum allowed FormData size in bytes (default: MAX_FORMDATA_SIZE)
 * @returns Object with validation result
 */
export async function validateFormDataSize(
  request: Request,
  maxSize: number = MAX_FORMDATA_SIZE
): Promise<{ valid: boolean; error?: string; size?: number }> {
  // Check Content-Length header if available
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > maxSize) {
      return {
        valid: false,
        error: `Request body too large: ${size} bytes exceeds maximum of ${maxSize} bytes (${Math.round(maxSize / 1024 / 1024)}MB)`,
        size
      }
    }
  }

  // Note: We can't easily check the actual FormData size without consuming it
  // The Content-Length header check is the best we can do before parsing
  // Individual file size validation happens after parsing (in validateImageFile)
  
  return { valid: true }
}

/**
 * Validate that FormData contains required fields
 * 
 * @param formData - The FormData object
 * @param requiredFields - Array of required field names
 * @returns Object with validation result
 */
export function validateFormDataFields(
  formData: FormData,
  requiredFields: string[]
): { valid: boolean; error?: string; missingFields?: string[] } {
  const missingFields: string[] = []
  
  for (const field of requiredFields) {
    if (!formData.has(field)) {
      missingFields.push(field)
    }
  }
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
      missingFields
    }
  }
  
  return { valid: true }
}

