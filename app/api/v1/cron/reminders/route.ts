/**
 * Reminders Cron Job API v1
 * 
 * Versioned endpoint for reminders cron job
 * Maintains backward compatibility with /api/cron/reminders
 * 
 * GET /api/v1/cron/reminders - Send reminders (cron)
 * POST /api/v1/cron/reminders - Send reminders (cron)
 */

export { GET, POST } from '../../../cron/reminders/route'

