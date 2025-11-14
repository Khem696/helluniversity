/**
 * Admin Bookings API v1
 * 
 * Versioned endpoint for admin booking management
 * Maintains backward compatibility with /api/admin/bookings
 * 
 * GET /api/v1/admin/bookings - List all bookings
 */

// Re-export from main admin bookings route
export { GET } from '../../../admin/bookings/route'

