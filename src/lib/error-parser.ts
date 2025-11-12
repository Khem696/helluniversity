/**
 * Error Parser Utility
 * 
 * Parses backend error messages and converts them to user-friendly,
 * actionable error objects for frontend display.
 */

export interface ParsedError {
  type: 'validation' | 'conflict' | 'transition' | 'overlap' | 'token' | 'network' | 'unknown'
  message: string
  userMessage: string // User-friendly message
  details?: {
    field?: string
    attemptedValue?: string
    validOptions?: string[]
    overlappingBookings?: Array<{ id: string; name: string }>
    currentStatus?: string
    targetStatus?: string
    validTransitions?: string[]
  }
  actionable: boolean
  retryable: boolean
  actionLabel?: string // Label for action button (e.g., "Retry", "Refresh")
}

/**
 * Parse backend error message into structured error object
 */
export function parseBackendError(error: string | Error | unknown, response?: Response): ParsedError {
  // Safely convert error to string
  let errorMessage: string
  if (error instanceof Error) {
    errorMessage = error.message
  } else if (typeof error === 'string') {
    errorMessage = error
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String(error.message)
  } else {
    errorMessage = String(error || 'Unknown error')
  }
  
  const statusCode = response?.status

  // Network errors
  if (!response || statusCode === 0 || errorMessage.includes('fetch')) {
    return {
      type: 'network',
      message: errorMessage,
      userMessage: 'Network error. Please check your internet connection and try again.',
      actionable: true,
      retryable: true,
      actionLabel: 'Retry',
    }
  }

  // HTTP status code based parsing
  if (statusCode === 409) {
    return parseConflictError(errorMessage)
  }

  if (statusCode === 400) {
    return parseValidationError(errorMessage)
  }

  if (statusCode === 404) {
    return parseNotFoundError(errorMessage)
  }

  if (statusCode === 403) {
    return parseForbiddenError(errorMessage)
  }

  // Content-based parsing
  if (errorMessage.includes('Invalid status transition')) {
    return parseTransitionError(errorMessage)
  }

  if (errorMessage.includes('overlaps with') || errorMessage.includes('overlapping')) {
    return parseOverlapError(errorMessage)
  }

  if (errorMessage.includes('Invalid proposed date') || errorMessage.includes('Proposed date')) {
    return parseProposedDateError(errorMessage)
  }

  if (errorMessage.includes('modified by another process')) {
    return parseConflictError(errorMessage)
  }

  if (errorMessage.includes('expired') || errorMessage.includes('Invalid or expired token')) {
    return parseTokenError(errorMessage)
  }

  // Generic error
  return {
    type: 'unknown',
    message: errorMessage,
    userMessage: errorMessage || 'An unexpected error occurred. Please try again.',
    actionable: false,
    retryable: statusCode && statusCode >= 500,
    actionLabel: statusCode && statusCode >= 500 ? 'Retry' : undefined,
  }
}

/**
 * Parse conflict errors (409, optimistic locking)
 */
function parseConflictError(errorMessage: string): ParsedError {
  if (errorMessage.includes('modified by another process')) {
    return {
      type: 'conflict',
      message: errorMessage,
      userMessage: 'This booking was modified by another admin or process. The page will refresh to show the latest information.',
      actionable: true,
      retryable: true,
      actionLabel: 'Refresh',
    }
  }

  return {
    type: 'conflict',
    message: errorMessage,
    userMessage: 'A conflict occurred. Please refresh and try again.',
    actionable: true,
    retryable: true,
    actionLabel: 'Refresh',
  }
}

/**
 * Parse validation errors (400)
 */
function parseValidationError(errorMessage: string): ParsedError {
  // Proposed date validation
  if (errorMessage.includes('Proposed date must be in the future')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: 'The proposed date must be in the future (GMT+7 Bangkok time). Please select a future date.',
      details: {
        field: 'proposedDate',
      },
      actionable: true,
      retryable: false,
    }
  }

  if (errorMessage.includes('Proposed date should be after the original start date')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: 'The proposed date should be after the original booking start date. Please select a later date.',
      details: {
        field: 'proposedDate',
      },
      actionable: true,
      retryable: false,
    }
  }

  if (errorMessage.includes('Proposed end date must be after proposed start date')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: 'The end date must be after the start date. Please select a valid date range.',
      details: {
        field: 'proposedEndDate',
      },
      actionable: true,
      retryable: false,
    }
  }

  if (errorMessage.includes('Invalid proposed date')) {
    // Extract reason if available
    const reasonMatch = errorMessage.match(/Invalid proposed date[:\s]+(.+)/i)
    const reason = reasonMatch ? reasonMatch[1] : 'Please check the date and try again.'
    
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: `Invalid date: ${reason} All dates use GMT+7 (Bangkok time).`,
      details: {
        field: 'proposedDate',
      },
      actionable: true,
      retryable: false,
    }
  }

  // Time validation errors
  if (errorMessage.includes('End time must be after start time')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: errorMessage.includes('single day') 
        ? errorMessage 
        : 'End time must be after start time for single day bookings. For multiple day bookings, times are on different days.',
      details: {
        field: 'endTime',
      },
      actionable: true,
      retryable: false,
    }
  }

  if (errorMessage.includes('Time must be in HH:MM format')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: 'Time must be in 24-hour format (HH:MM). For example: 09:00, 13:30, 17:45.',
      details: {
        field: 'time',
      },
      actionable: true,
      retryable: false,
    }
  }

  // Generic validation error
  return {
    type: 'validation',
    message: errorMessage,
    userMessage: errorMessage || 'Please check your input and try again.',
    actionable: true,
    retryable: false,
  }
}

/**
 * Parse status transition errors
 */
function parseTransitionError(errorMessage: string): ParsedError {
  // Extract current and target status
  const transitionMatch = errorMessage.match(/from "([^"]+)" to "([^"]+)"/i)
  const currentStatus = transitionMatch ? transitionMatch[1] : undefined
  const targetStatus = transitionMatch ? transitionMatch[2] : undefined

  return {
    type: 'transition',
    message: errorMessage,
    userMessage: `Cannot change status from "${currentStatus || 'current'}" to "${targetStatus || 'selected'}". This transition is not allowed.`,
    details: {
      currentStatus,
      targetStatus,
    },
    actionable: true,
    retryable: false,
  }
}

/**
 * Parse overlap errors
 */
function parseOverlapError(errorMessage: string): ParsedError {
  // Extract overlapping booking names
  const overlapMatch = errorMessage.match(/overlaps with.*?\(([^)]+)\)/i)
  const overlappingNames = overlapMatch ? overlapMatch[1] : 'existing booking'

  return {
    type: 'overlap',
    message: errorMessage,
    userMessage: `This booking overlaps with an existing checked-in booking: ${overlappingNames}. Please choose a different date or time.`,
    details: {
      overlappingBookings: overlappingNames.split(', ').map(name => ({ id: '', name: name.trim() })),
    },
    actionable: true,
    retryable: false,
  }
}

/**
 * Parse proposed date errors
 */
function parseProposedDateError(errorMessage: string): ParsedError {
  if (errorMessage.includes('must be in the future')) {
    return {
      type: 'validation',
      message: errorMessage,
      userMessage: 'The proposed date must be in the future (GMT+7 Bangkok time). Please select a future date.',
      details: {
        field: 'proposedDate',
      },
      actionable: true,
      retryable: false,
    }
  }

  return {
    type: 'validation',
    message: errorMessage,
    userMessage: errorMessage + ' All dates use GMT+7 (Bangkok time).',
    details: {
      field: 'proposedDate',
    },
    actionable: true,
    retryable: false,
  }
}

/**
 * Parse token errors
 */
function parseTokenError(errorMessage: string): ParsedError {
  return {
    type: 'token',
    message: errorMessage,
    userMessage: 'This link has expired or is invalid. Please request a new link from the admin or check your email for the latest booking information.',
    actionable: false,
    retryable: false,
  }
}

/**
 * Parse 404 errors
 */
function parseNotFoundError(errorMessage: string): ParsedError {
  return {
    type: 'unknown',
    message: errorMessage,
    userMessage: 'The requested resource was not found. It may have been deleted or the link is invalid.',
    actionable: false,
    retryable: false,
  }
}

/**
 * Parse 403 errors
 */
function parseForbiddenError(errorMessage: string): ParsedError {
  return {
    type: 'unknown',
    message: errorMessage,
    userMessage: 'You do not have permission to perform this action.',
    actionable: false,
    retryable: false,
  }
}

/**
 * Get user-friendly error message with action guidance
 */
export function getErrorMessageWithGuidance(parsedError: ParsedError): string {
  let message = parsedError.userMessage

  // Add timezone note for date validation errors
  if (parsedError.type === 'validation' && parsedError.details?.field?.includes('date')) {
    message += ' (All dates use GMT+7 Bangkok time)'
  }
  
  // Improve time validation error messages
  if (message.includes('End time must be after start time')) {
    if (message.includes('single day')) {
      // Already has context
      return message
    }
    // Add context for multiple day bookings if needed
    message = message.replace(
      'End time must be after start time',
      'End time must be after start time for single day bookings'
    )
  }

  // Add valid transitions for transition errors
  if (parsedError.type === 'transition' && parsedError.details?.validTransitions) {
    message += ` Valid transitions: ${parsedError.details.validTransitions.join(', ')}`
  }

  return message
}

