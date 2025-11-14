/**
 * Job Queue Cron Job API v1
 * 
 * Versioned endpoint for job queue processing cron job
 * Maintains backward compatibility with /api/cron/job-queue
 * 
 * GET /api/v1/cron/job-queue - Process job queue (cron)
 * POST /api/v1/cron/job-queue - Process job queue (cron)
 */

export { GET, POST } from '../../../cron/job-queue/route'

