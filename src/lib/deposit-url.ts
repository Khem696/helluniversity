/**
 * Deposit URL Utilities
 * 
 * Helper functions for generating secure proxy URLs for deposit evidence images.
 * This ensures deposit images are only accessible through authenticated endpoints.
 */

import { API_PATHS } from './api-config'

/**
 * Generate proxy URL for user access (requires booking token)
 * @param blobUrl - Original blob storage URL
 * @param token - Booking response token
 * @returns Proxy URL for secure access
 */
export function getDepositProxyUrl(blobUrl: string | null | undefined, token: string): string | null {
  if (!blobUrl || !token) {
    return null
  }
  return API_PATHS.depositImage(token)
}

/**
 * Generate proxy URL for admin access (requires admin authentication)
 * @param blobUrl - Original blob storage URL
 * @param bookingId - Booking ID
 * @returns Proxy URL for secure admin access
 */
export function getAdminDepositProxyUrl(blobUrl: string | null | undefined, bookingId: string): string | null {
  if (!blobUrl || !bookingId) {
    return null
  }
  return API_PATHS.adminDepositImage(bookingId)
}

