/**
 * Admin Image Management API v1
 * 
 * Versioned endpoint for individual image management
 * Maintains backward compatibility with /api/admin/images/[id]
 * 
 * GET /api/v1/admin/images/[id] - Get image details
 * PATCH /api/v1/admin/images/[id] - Update image
 * DELETE /api/v1/admin/images/[id] - Delete image
 */

export { GET, PATCH, DELETE } from '../../../../admin/images/[id]/route'

