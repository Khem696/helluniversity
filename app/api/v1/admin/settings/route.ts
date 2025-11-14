/**
 * Admin Settings API v1
 * 
 * Versioned endpoint for admin settings
 * Maintains backward compatibility with /api/admin/settings
 * 
 * GET /api/v1/admin/settings - Get settings
 * PATCH /api/v1/admin/settings - Update settings
 */

export { GET, PATCH } from '../../../admin/settings/route'

