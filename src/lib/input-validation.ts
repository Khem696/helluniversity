/**
 * Input Validation Utilities
 * 
 * Comprehensive validation and sanitization for user input
 * Prevents invalid data, XSS attacks, and data corruption
 */

export interface ValidationResult {
  valid: boolean
  error?: string
  sanitized?: string
}

/**
 * Validate email address format and length
 */
export function validateEmail(email: string | null | undefined): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' }
  }

  const trimmed = email.trim()
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Email cannot be empty' }
  }

  if (trimmed.length > 255) {
    return { valid: false, error: 'Email must be less than 255 characters' }
  }

  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' }
  }

  // Additional checks for common issues
  if (trimmed.includes('..')) {
    return { valid: false, error: 'Email cannot contain consecutive dots' }
  }

  if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
    return { valid: false, error: 'Email cannot start or end with a dot' }
  }

  return { valid: true, sanitized: trimmed.toLowerCase() }
}

/**
 * Validate phone number format
 */
export function validatePhone(phone: string | null | undefined): ValidationResult {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required' }
  }

  const trimmed = phone.trim()
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Phone number cannot be empty' }
  }

  // Remove non-digit characters for validation
  const digits = trimmed.replace(/\D/g, '')
  
  if (digits.length < 10) {
    return { valid: false, error: 'Phone number must contain at least 10 digits' }
  }

  if (digits.length > 15) {
    return { valid: false, error: 'Phone number must contain at most 15 digits' }
  }

  return { valid: true, sanitized: trimmed }
}

/**
 * Sanitize text input to prevent XSS and control characters
 */
export function sanitizeText(
  text: string | null | undefined,
  maxLength: number = 10000,
  allowNewlines: boolean = true
): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  // Remove null bytes
  let sanitized = text.replace(/\0/g, '')
  
  // Remove control characters (except newlines if allowed)
  if (allowNewlines) {
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
  } else {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '')
  }

  // Trim whitespace
  sanitized = sanitized.trim()
  
  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }

  return sanitized
}

/**
 * Validate date string format
 */
export function validateDate(dateString: string | null | undefined): ValidationResult {
  if (!dateString || typeof dateString !== 'string') {
    return { valid: false, error: 'Date is required' }
  }

  const trimmed = dateString.trim()
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Date cannot be empty' }
  }

  // Check ISO date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  
  if (!dateRegex.test(trimmed)) {
    return { valid: false, error: 'Date must be in YYYY-MM-DD format' }
  }

  const date = new Date(trimmed)
  
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Invalid date' }
  }

  // Check if date is reasonable (not too far in past/future)
  const now = new Date()
  const minDate = new Date(1900, 0, 1)
  const maxDate = new Date(2100, 11, 31)
  
  if (date < minDate || date > maxDate) {
    return { valid: false, error: 'Date must be between 1900 and 2100' }
  }

  return { valid: true, sanitized: trimmed }
}

/**
 * Validate date range (start and end dates)
 */
export function validateDateRange(
  startDate: string | null | undefined,
  endDate?: string | null | undefined
): ValidationResult {
  const startValidation = validateDate(startDate)
  if (!startValidation.valid) {
    return startValidation
  }

  if (endDate) {
    const endValidation = validateDate(endDate)
    if (!endValidation.valid) {
      return endValidation
    }

    const start = new Date(startValidation.sanitized!)
    const end = new Date(endValidation.sanitized!)
    
    // Check if end date is same as start date
    const startDateStr = startValidation.sanitized!
    const endDateStr = endValidation.sanitized!
    if (startDateStr === endDateStr) {
      return { valid: false, error: 'End date cannot be the same as start date' }
    }
    
    // Check if end date is before start date
    if (end < start) {
      return { valid: false, error: 'End date must be after start date' }
    }

    // Check if date range is reasonable (not more than 1 year)
    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff > 365) {
      return { valid: false, error: 'Date range cannot exceed 365 days' }
    }
  }

  return { valid: true }
}

/**
 * Validate time string format (HH:MM)
 */
export function validateTime(timeString: string | null | undefined): ValidationResult {
  if (!timeString || typeof timeString !== 'string') {
    return { valid: true } // Time is optional
  }

  const trimmed = timeString.trim()
  
  if (trimmed.length === 0) {
    return { valid: true } // Empty time is valid (optional)
  }

  // Check time format (HH:MM)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
  
  if (!timeRegex.test(trimmed)) {
    return { valid: false, error: 'Time must be in HH:MM format (24-hour)' }
  }

  return { valid: true, sanitized: trimmed }
}

/**
 * Validate time range (start and end times)
 * @param startTime - Start time in HH:MM format (24-hour)
 * @param endTime - End time in HH:MM format (24-hour)
 * @param isMultipleDay - Whether this is a multiple day booking (times are on different days)
 */
export function validateTimeRange(
  startTime: string | null | undefined,
  endTime?: string | null | undefined,
  isMultipleDay: boolean = false
): ValidationResult {
  if (startTime) {
    const startValidation = validateTime(startTime)
    if (!startValidation.valid) {
      return startValidation
    }
  }

  if (endTime) {
    const endValidation = validateTime(endTime)
    if (!endValidation.valid) {
      return endValidation
    }

    // Only validate time comparison for single-day bookings
    // For multiple-day bookings, times are on different days and can't be compared directly
    if (!isMultipleDay && startTime && endTime) {
      const [startHours, startMinutes] = startTime.split(':').map(Number)
      const [endHours, endMinutes] = endTime.split(':').map(Number)
      
      const startTotal = startHours * 60 + startMinutes
      const endTotal = endHours * 60 + endMinutes
      
      if (endTotal <= startTotal) {
        return { valid: false, error: 'End time must be after start time for single day bookings' }
      }
    }
  }

  return { valid: true }
}

/**
 * Validate name (person name)
 */
export function validateName(name: string | null | undefined): ValidationResult {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Name is required' }
  }

  const sanitized = sanitizeText(name, 255, false)
  
  if (sanitized.length === 0) {
    return { valid: false, error: 'Name cannot be empty' }
  }

  if (sanitized.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' }
  }

  if (sanitized.length > 255) {
    return { valid: false, error: 'Name must be less than 255 characters' }
  }

  return { valid: true, sanitized }
}

/**
 * Validate text field with length constraints
 */
export function validateTextField(
  text: string | null | undefined,
  fieldName: string,
  options?: {
    required?: boolean
    minLength?: number
    maxLength?: number
    allowNewlines?: boolean
  }
): ValidationResult {
  const required = options?.required ?? false
  const minLength = options?.minLength ?? 0
  const maxLength = options?.maxLength ?? 10000
  const allowNewlines = options?.allowNewlines ?? true

  if (!text && required) {
    return { valid: false, error: `${fieldName} is required` }
  }

  if (!text) {
    return { valid: true, sanitized: '' }
  }

  const sanitized = sanitizeText(text, maxLength, allowNewlines)
  
  if (required && sanitized.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` }
  }

  if (sanitized.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` }
  }

  return { valid: true, sanitized }
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string | null | undefined): ValidationResult {
  if (!uuid || typeof uuid !== 'string') {
    return { valid: false, error: 'UUID is required' }
  }

  const trimmed = uuid.trim()
  
  // UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  
  if (!uuidRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid UUID format' }
  }

  return { valid: true, sanitized: trimmed.toLowerCase() }
}

/**
 * Validate booking data comprehensively
 */
export interface BookingValidationResult {
  valid: boolean
  errors: string[]
  sanitized?: {
    name: string
    email: string
    phone: string
    participants?: string
    eventType: string
    otherEventType?: string
    startDate: string
    endDate?: string
    startTime?: string
    endTime?: string
    introduction: string
    biography?: string
    specialRequests?: string
  }
}

export function validateBookingData(data: {
  name?: string | null
  email?: string | null
  phone?: string | null
  participants?: string | null
  eventType?: string | null
  otherEventType?: string | null
  startDate?: string | null
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  introduction?: string | null
  biography?: string | null
  specialRequests?: string | null
}): BookingValidationResult {
  const errors: string[] = []
  const sanitized: any = {}

  // Validate name
  const nameValidation = validateName(data.name)
  if (!nameValidation.valid) {
    errors.push(nameValidation.error!)
  } else {
    sanitized.name = nameValidation.sanitized!
  }

  // Validate email
  const emailValidation = validateEmail(data.email)
  if (!emailValidation.valid) {
    errors.push(emailValidation.error!)
  } else {
    sanitized.email = emailValidation.sanitized!
  }

  // Validate phone
  const phoneValidation = validatePhone(data.phone)
  if (!phoneValidation.valid) {
    errors.push(phoneValidation.error!)
  } else {
    sanitized.phone = phoneValidation.sanitized!
  }

  // Validate participants (optional)
  if (data.participants) {
    const participantsValidation = validateTextField(data.participants, 'Participants', {
      maxLength: 500,
      allowNewlines: false,
    })
    if (participantsValidation.valid) {
      sanitized.participants = participantsValidation.sanitized
    } else {
      errors.push(participantsValidation.error!)
    }
  }

  // Validate event type
  if (!data.eventType || typeof data.eventType !== 'string' || data.eventType.trim().length === 0) {
    errors.push('Event type is required')
  } else {
    sanitized.eventType = sanitizeText(data.eventType, 100, false)
  }

  // Validate other event type (optional)
  if (data.otherEventType) {
    const otherEventTypeValidation = validateTextField(data.otherEventType, 'Other event type', {
      maxLength: 100,
      allowNewlines: false,
    })
    if (otherEventTypeValidation.valid) {
      sanitized.otherEventType = otherEventTypeValidation.sanitized
    } else {
      errors.push(otherEventTypeValidation.error!)
    }
  }

  // Validate dates
  const dateRangeValidation = validateDateRange(data.startDate, data.endDate)
  if (!dateRangeValidation.valid) {
    errors.push(dateRangeValidation.error!)
  } else {
    if (data.startDate) {
      sanitized.startDate = validateDate(data.startDate).sanitized!
    }
    if (data.endDate) {
      sanitized.endDate = validateDate(data.endDate).sanitized!
    }
  }

  // Validate times
  // Check if this is a multiple day booking (has endDate)
  const isMultipleDay = Boolean(data.endDate && data.endDate !== data.startDate)
  const timeRangeValidation = validateTimeRange(data.startTime, data.endTime, isMultipleDay)
  if (!timeRangeValidation.valid) {
    errors.push(timeRangeValidation.error!)
  } else {
    if (data.startTime) {
      sanitized.startTime = validateTime(data.startTime).sanitized
    }
    if (data.endTime) {
      sanitized.endTime = validateTime(data.endTime).sanitized
    }
  }

  // Validate introduction
  const introductionValidation = validateTextField(data.introduction, 'Brief Your Desire', {
    required: true,
    minLength: 1,
    maxLength: 5000,
    allowNewlines: true,
  })
  if (!introductionValidation.valid) {
    errors.push(introductionValidation.error!)
  } else {
    sanitized.introduction = introductionValidation.sanitized!
  }

  // Validate biography (optional)
  if (data.biography) {
    const biographyValidation = validateTextField(data.biography, 'Background & Interests', {
      maxLength: 2000,
      allowNewlines: true,
    })
    if (biographyValidation.valid) {
      sanitized.biography = biographyValidation.sanitized
    } else {
      errors.push(biographyValidation.error!)
    }
  }

  // Validate special requests (optional)
  if (data.specialRequests) {
    const specialRequestsValidation = validateTextField(data.specialRequests, 'Special Requirements', {
      maxLength: 1000,
      allowNewlines: true,
    })
    if (specialRequestsValidation.valid) {
      sanitized.specialRequests = specialRequestsValidation.sanitized
    } else {
      errors.push(specialRequestsValidation.error!)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined,
  }
}

