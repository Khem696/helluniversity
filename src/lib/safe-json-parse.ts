/**
 * Safe JSON Parsing with Size Limits
 * 
 * Prevents DoS attacks by limiting request body size and providing
 * proper error handling for JSON parsing failures.
 */

/**
 * Maximum allowed request body size (in bytes)
 * Default: 1MB (1048576 bytes)
 * Can be overridden via MAX_REQUEST_BODY_SIZE environment variable
 */
const MAX_REQUEST_BODY_SIZE = parseInt(
  process.env.MAX_REQUEST_BODY_SIZE || '1048576',
  10
)

/**
 * Safely parse JSON from a Request object with size limits
 * 
 * @param request - The Request object to parse
 * @param maxSize - Maximum allowed body size in bytes (default: MAX_REQUEST_BODY_SIZE)
 * @returns Parsed JSON object
 * @throws Error if body is too large or JSON parsing fails
 */
export async function safeParseJSON(
  request: Request,
  maxSize: number = MAX_REQUEST_BODY_SIZE
): Promise<any> {
  // Check Content-Length header if available
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > maxSize) {
      throw new Error(
        `Request body too large: ${size} bytes exceeds maximum of ${maxSize} bytes`
      )
    }
  }

  // Clone the request to read the body without consuming it
  // Note: In Next.js, we can't actually clone and read the body multiple times
  // So we'll read it once and check the size
  const body = await request.text()
  
  // Check actual body size
  const bodySize = new Blob([body]).size
  if (bodySize > maxSize) {
    throw new Error(
      `Request body too large: ${bodySize} bytes exceeds maximum of ${maxSize} bytes`
    )
  }

  // Parse JSON with error handling
  try {
    return JSON.parse(body)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON: ${errorMessage}`)
  }
}

/**
 * Safely parse JSON string with size limits
 * 
 * @param jsonString - The JSON string to parse
 * @param maxSize - Maximum allowed string size in bytes (default: MAX_REQUEST_BODY_SIZE)
 * @returns Parsed JSON object
 * @throws Error if string is too large or JSON parsing fails
 */
export function safeParseJSONString(
  jsonString: string,
  maxSize: number = MAX_REQUEST_BODY_SIZE
): any {
  // Check string size (approximate byte size)
  const stringSize = new Blob([jsonString]).size
  if (stringSize > maxSize) {
    throw new Error(
      `JSON string too large: ${stringSize} bytes exceeds maximum of ${maxSize} bytes`
    )
  }

  // Parse JSON with error handling
  try {
    return JSON.parse(jsonString)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON: ${errorMessage}`)
  }
}

