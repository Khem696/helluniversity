/**
 * Admin Event Management API v1
 * 
 * Versioned endpoint for individual event management
 * Maintains backward compatibility with /api/admin/events/[id]
 * 
 * GET /api/v1/admin/events/[id] - Get event details
 * PATCH /api/v1/admin/events/[id] - Update event
 * DELETE /api/v1/admin/events/[id] - Delete event
 */

export { GET, PATCH, DELETE } from '../../../../admin/events/[id]/route'

