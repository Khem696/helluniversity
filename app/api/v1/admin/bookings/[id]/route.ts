/**
 * Admin Booking Management API v1
 * 
 * Versioned endpoint for individual booking management
 * Maintains backward compatibility with /api/admin/bookings/[id]
 * 
 * GET /api/v1/admin/bookings/[id] - Get booking details
 * PATCH /api/v1/admin/bookings/[id] - Update booking status
 * DELETE /api/v1/admin/bookings/[id] - Delete booking
 * 
 * NOTE: This route is inlined to prevent circular dependencies.
 * The implementation is copied from the legacy route to ensure safety.
 */

// Re-export handlers from legacy route using direct re-export (safe pattern)
export { GET, PATCH, DELETE } from '../../../../admin/bookings/[id]/route'
