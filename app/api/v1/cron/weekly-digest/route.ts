/**
 * Weekly Digest Cron Job API v1
 * 
 * Versioned endpoint for weekly digest cron job
 * Maintains backward compatibility with /api/cron/weekly-digest
 * 
 * GET /api/v1/cron/weekly-digest - Send weekly digest (cron)
 * POST /api/v1/cron/weekly-digest - Send weekly digest (cron)
 */

export { GET, POST } from '../../../cron/weekly-digest/route'

