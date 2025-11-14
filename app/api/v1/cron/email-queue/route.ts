/**
 * Email Queue Cron Job API v1
 * 
 * Versioned endpoint for email queue processing cron job
 * Maintains backward compatibility with /api/cron/email-queue
 * 
 * GET /api/v1/cron/email-queue - Process email queue (cron)
 * POST /api/v1/cron/email-queue - Process email queue (cron)
 */

export { GET, POST } from '../../../cron/email-queue/route'

