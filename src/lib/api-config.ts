/**
 * API Configuration
 * 
 * Centralized configuration for API endpoints and versioning.
 * This allows easy management of API versions from a single point.
 * 
 * To change API version globally, update API_VERSION below.
 */

/**
 * Current API version
 * Change this to update all API calls across the application
 */
export const API_VERSION = 'v1'

/**
 * API base path
 */
const API_BASE = '/api'

/**
 * Get versioned API path
 * @param path - API path without /api prefix (e.g., 'booking' or 'admin/bookings')
 * @returns Full versioned API path (e.g., '/api/v1/booking')
 * 
 * @example
 * getApiPath('booking') => '/api/v1/booking'
 * getApiPath('admin/bookings') => '/api/v1/admin/bookings'
 */
export function getApiPath(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  // Remove /api prefix if present (for convenience)
  const withoutApiPrefix = cleanPath.startsWith('api/') ? cleanPath.slice(4) : cleanPath
  
  return `${API_BASE}/${API_VERSION}/${withoutApiPrefix}`
}

/**
 * Pre-configured API paths for common endpoints
 * Use these constants for consistency across the application
 */
export const API_PATHS = {
  // Booking APIs
  booking: getApiPath('booking'),
  bookingAvailability: getApiPath('booking/availability'),
  bookingDeposit: getApiPath('booking/deposit'),
  bookingResponse: (token: string) => getApiPath(`booking/response/${token}`),
  
  // Admin Booking APIs
  adminBookings: getApiPath('admin/bookings'),
  adminBooking: (id: string) => getApiPath(`admin/bookings/${id}`),
  adminBookingValidate: (id: string) => getApiPath(`admin/bookings/${id}/validate`),
  adminBookingReminders: getApiPath('admin/bookings/reminders'),
  adminBookingDigest: getApiPath('admin/bookings/digest'),
  adminBookingAutoUpdate: getApiPath('admin/bookings/auto-update'),
  adminBookingFee: (id: string) => getApiPath(`admin/bookings/${id}/fee`),
  adminBookingFeeHistory: (id: string) => getApiPath(`admin/bookings/${id}/fee/history`),
  adminBookingExport: getApiPath('admin/bookings/export'),
  
  // Admin Deposit APIs
  adminDepositImage: (bookingId: string) => getApiPath(`admin/deposit/${bookingId}/image`),
  depositImage: (token: string) => getApiPath(`deposit/${token}/image`),
  
  // Admin Event APIs
  adminEvents: getApiPath('admin/events'),
  adminEvent: (id: string) => getApiPath(`admin/events/${id}`),
  adminEventImages: (id: string) => getApiPath(`admin/events/${id}/images`),
  adminEventImage: (eventId: string, imageId: string) => 
    getApiPath(`admin/events/${eventId}/images/${imageId}`),
  
  // Admin Image APIs
  adminImages: getApiPath('admin/images'),
  adminImage: (id: string) => getApiPath(`admin/images/${id}`),
  adminImageToggleAISelection: getApiPath('admin/images/toggle-ai-selection'),
  
  // Admin Settings APIs
  adminSettings: getApiPath('admin/settings'),
  
  // Admin Email Queue APIs
  adminEmailQueue: getApiPath('admin/email-queue'),
  adminEmailQueueItem: (id: string) => getApiPath(`admin/email-queue/${id}`),
  
  // Admin Stats API
  adminStats: getApiPath('admin/stats'),
  
  // Admin Utility APIs
  adminInitDb: getApiPath('admin/init-db'),
  adminMigrateImages: getApiPath('admin/migrate-images'),
  adminCleanupOrphanedImages: getApiPath('admin/cleanup-orphaned-images'),
  adminCleanupOrphanedDeposits: getApiPath('admin/cleanup-orphaned-deposits'),
  adminJobQueueRetry: (id: string) => getApiPath(`admin/job-queue/${id}/retry`),
  
  // Public APIs
  events: getApiPath('events'),
  event: (id: string) => getApiPath(`events/${id}`),
  images: getApiPath('images'),
  imagesProxy: getApiPath('images/proxy'),
  imagesOptimize: getApiPath('images/optimize'),
  settingsBookingEnabled: getApiPath('settings/booking-enabled'),
  
  // AI Space APIs
  aiSpace: getApiPath('ai-space'),
  aiSpaceImages: getApiPath('ai-space/images'),
  
  // Verification APIs
  verifyRecaptcha: getApiPath('verify-recaptcha'),
  
  // Cron APIs (for reference, typically called by Vercel)
  cronAutoUpdateBookings: getApiPath('cron/auto-update-bookings'),
  cronEmailQueue: getApiPath('cron/email-queue'),
  cronJobQueue: getApiPath('cron/job-queue'),
  cronReminders: getApiPath('cron/reminders'),
  cronDailyDigest: getApiPath('cron/daily-digest'),
  cronWeeklyDigest: getApiPath('cron/weekly-digest'),
  cronCleanupOrphanedDeposits: getApiPath('cron/cleanup-orphaned-deposits'),
} as const

/**
 * Type for API paths object keys
 */
export type ApiPathKey = keyof typeof API_PATHS

/**
 * Helper to build query string for API calls
 * @param basePath - Base API path
 * @param params - Query parameters object
 * @returns Full URL with query string
 * 
 * @example
 * buildApiUrl(API_PATHS.adminBookings, { status: 'pending', limit: 10 })
 * => '/api/v1/admin/bookings?status=pending&limit=10'
 */
export function buildApiUrl(
  basePath: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!params || Object.keys(params).length === 0) {
    return basePath
  }
  
  const searchParams = new URLSearchParams()
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      searchParams.append(key, String(value))
    }
  }
  
  const queryString = searchParams.toString()
  return queryString ? `${basePath}?${queryString}` : basePath
}

