/**
 * Admin Email Queue API v1
 * 
 * Versioned endpoint for email queue management
 * Maintains backward compatibility with /api/admin/email-queue
 * 
 * GET /api/v1/admin/email-queue - List email queue
 * POST /api/v1/admin/email-queue - Retry failed emails
 */

export { GET, POST } from '../../../admin/email-queue/route'

