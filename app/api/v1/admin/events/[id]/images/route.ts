/**
 * Admin Event Images API v1
 * 
 * Versioned endpoint for event image management
 * Maintains backward compatibility with /api/admin/events/[id]/images
 * 
 * GET /api/v1/admin/events/[id]/images - Get event images
 * POST /api/v1/admin/events/[id]/images - Add image to event
 */

export { GET, POST } from '../../../../../admin/events/[id]/images/route'

