/**
 * Daily Digest Cron Job API v1
 * 
 * Versioned endpoint for daily digest cron job
 * Maintains backward compatibility with /api/cron/daily-digest
 * 
 * GET /api/v1/cron/daily-digest - Send daily digest (cron)
 * POST /api/v1/cron/daily-digest - Send daily digest (cron)
 */

export { GET, POST } from '../../../cron/daily-digest/route'

