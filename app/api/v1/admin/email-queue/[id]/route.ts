/**
 * Admin Email Queue Item API v1
 * 
 * Versioned endpoint for individual email queue item management
 * Maintains backward compatibility with /api/admin/email-queue/[id]
 * 
 * GET /api/v1/admin/email-queue/[id] - Get email queue item details
 * POST /api/v1/admin/email-queue/[id] - Retry specific email
 * DELETE /api/v1/admin/email-queue/[id] - Delete email queue item
 */

export { GET, POST, DELETE } from '../../../../admin/email-queue/[id]/route'

