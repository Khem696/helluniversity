/**
 * Auto-Update Bookings Cron Job API v1
 * 
 * Versioned endpoint for auto-update bookings cron job
 * Maintains backward compatibility with /api/cron/auto-update-bookings
 * 
 * GET /api/v1/cron/auto-update-bookings - Trigger auto-update (cron)
 * POST /api/v1/cron/auto-update-bookings - Trigger auto-update (cron)
 */

export { GET, POST } from '../../../cron/auto-update-bookings/route'

