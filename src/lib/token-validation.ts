/**
 * Token Validation Utilities
 * 
 * Provides functions to validate token expiration with grace period
 * Used to prevent token expiration during long-running operations
 */

import { getBangkokTime } from "./timezone"

/**
 * Token expiration grace period (5 minutes in seconds)
 * This allows users who are mid-operation to complete their action
 */
export const TOKEN_GRACE_PERIOD = 5 * 60 // 5 minutes in seconds

/**
 * Extended grace period for long-running operations like deposit uploads (15 minutes)
 * This provides additional time for image processing and upload operations
 */
export const TOKEN_EXTENDED_GRACE_PERIOD = 15 * 60 // 15 minutes in seconds

/**
 * Validate if a token is still valid (not expired)
 * 
 * @param tokenExpiresAt - Token expiration timestamp (Unix seconds) or null
 * @param useExtendedGracePeriod - If true, use extended grace period (15 min) instead of standard (5 min)
 * @returns Object with `valid` boolean and optional `reason` string
 */
export function validateTokenExpiration(
  tokenExpiresAt: number | null,
  useExtendedGracePeriod: boolean = false
): { valid: boolean; reason?: string } {
  if (!tokenExpiresAt) {
    // Token has no expiration (shouldn't happen, but handle gracefully)
    return { valid: true }
  }

  const now = getBangkokTime()
  const gracePeriod = useExtendedGracePeriod ? TOKEN_EXTENDED_GRACE_PERIOD : TOKEN_GRACE_PERIOD
  const effectiveExpirationTime = tokenExpiresAt + gracePeriod

  if (now > effectiveExpirationTime) {
    return {
      valid: false,
      reason: `Token expired at ${new Date(tokenExpiresAt * 1000).toISOString()} (grace period: ${gracePeriod / 60} minutes)`
    }
  }

  return { valid: true }
}

/**
 * Re-validate token before critical database operations
 * This prevents token expiration during long-running operations
 * 
 * @param booking - Booking object with tokenExpiresAt
 * @param operation - Operation name for logging (e.g., "deposit_upload", "user_response")
 * @param useExtendedGracePeriod - If true, use extended grace period for long operations
 * @throws Error if token is expired
 */
export function revalidateTokenBeforeOperation(
  booking: { tokenExpiresAt?: number | null; id: string; responseToken?: string | null },
  operation: string,
  useExtendedGracePeriod: boolean = false
): void {
  // Convert undefined to null for consistency
  const tokenExpiresAt = booking.tokenExpiresAt ?? null
  const validation = validateTokenExpiration(tokenExpiresAt, useExtendedGracePeriod)
  
  if (!validation.valid) {
    const gracePeriod = useExtendedGracePeriod ? TOKEN_EXTENDED_GRACE_PERIOD : TOKEN_GRACE_PERIOD
    throw new Error(
      `Token expired during ${operation} operation. ` +
      `Token expired at ${tokenExpiresAt ? new Date(tokenExpiresAt * 1000).toISOString() : 'unknown'}, ` +
      `grace period (${gracePeriod / 60} minutes) has been exceeded. ` +
      `Please refresh and try again, or contact support for a new token.`
    )
  }
}

