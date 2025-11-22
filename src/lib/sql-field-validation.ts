/**
 * SQL Field Name Validation
 * 
 * Prevents SQL injection by validating field names used in dynamic SQL queries.
 * Only whitelisted field names are allowed.
 */

/**
 * Whitelist of allowed field names for bookings table
 */
export const ALLOWED_BOOKING_FIELDS = new Set([
  'status',
  'updated_at',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'date_range',
  'token_expires_at',
  'deposit_evidence_url',
  'deposit_verified_at',
  'deposit_verified_by',
  'deposit_verified_from_other_channel',
  'user_response',
  'response_date',
  'response_token',
  'name',
  'email',
  'phone',
  'participants',
  'event_type',
  'other_event_type',
  'introduction',
  'biography',
  'special_requests',
  'organization_type',
  'admin_notes',
  'fee_amount',
  'fee_amount_original',
  'fee_currency',
  'fee_conversion_rate',
  'fee_rate_date',
  'fee_recorded_at',
  'fee_recorded_by',
  'fee_notes',
  'created_at',
] as const)

/**
 * Whitelist of allowed field names for images table
 */
export const ALLOWED_IMAGE_FIELDS = new Set([
  'title',
  'category',
  'display_order',
  'ai_selected',
  'ai_order',
  'format',
  'width',
  'height',
  'blob_url',
  'updated_at',
  'created_at',
] as const)

/**
 * Whitelist of allowed field names for events table
 */
export const ALLOWED_EVENT_FIELDS = new Set([
  'title',
  'description',
  'image_id',
  'event_date',
  'start_date',
  'end_date',
  'updated_at',
  'created_at',
] as const)

/**
 * Extract field name from SQL assignment (e.g., "field_name = ?" -> "field_name")
 */
function extractFieldName(fieldAssignment: string): string {
  // Handle patterns like:
  // - "field_name = ?"
  // - "field_name = NULL"
  // - "field_name = 0"
  const match = fieldAssignment.match(/^([a-z_]+)\s*=/i)
  return match ? match[1].toLowerCase() : ''
}

/**
 * Validate a single field name against whitelist
 */
export function validateFieldName(
  fieldAssignment: string,
  allowedFields: Set<string>
): { valid: boolean; fieldName?: string; error?: string } {
  const fieldName = extractFieldName(fieldAssignment)
  
  if (!fieldName) {
    return {
      valid: false,
      error: `Invalid field assignment format: "${fieldAssignment}". Expected format: "field_name = ?" or "field_name = value"`
    }
  }
  
  if (!allowedFields.has(fieldName)) {
    return {
      valid: false,
      fieldName,
      error: `Field name "${fieldName}" is not allowed. Allowed fields: ${Array.from(allowedFields).join(', ')}`
    }
  }
  
  return { valid: true, fieldName }
}

/**
 * Validate multiple field assignments
 */
export function validateFieldNames(
  fieldAssignments: string[],
  allowedFields: Set<string>
): { valid: boolean; errors?: string[] } {
  const errors: string[] = []
  
  for (const fieldAssignment of fieldAssignments) {
    const validation = validateFieldName(fieldAssignment, allowedFields)
    if (!validation.valid) {
      errors.push(validation.error || `Invalid field: ${fieldAssignment}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  }
}

/**
 * Validate and build SQL UPDATE statement safely
 */
export function buildSafeUpdateSQL(
  tableName: 'bookings' | 'images' | 'events',
  fieldAssignments: string[],
  whereClause: string = 'WHERE id = ?'
): { sql: string; valid: boolean; error?: string } {
  let allowedFields: Set<string>
  
  switch (tableName) {
    case 'bookings':
      allowedFields = ALLOWED_BOOKING_FIELDS
      break
    case 'images':
      allowedFields = ALLOWED_IMAGE_FIELDS
      break
    case 'events':
      allowedFields = ALLOWED_EVENT_FIELDS
      break
    default:
      return {
        sql: '',
        valid: false,
        error: `Unknown table: ${tableName}`
      }
  }
  
  const validation = validateFieldNames(fieldAssignments, allowedFields)
  
  if (!validation.valid) {
    return {
      sql: '',
      valid: false,
      error: validation.errors?.join('; ') || 'Field validation failed'
    }
  }
  
  const sql = `UPDATE ${tableName} SET ${fieldAssignments.join(', ')} ${whereClause}`
  
  return { sql, valid: true }
}

