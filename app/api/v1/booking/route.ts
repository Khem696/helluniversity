/**
 * Booking API v1
 * 
 * Versioned endpoint for booking creation
 * Maintains backward compatibility with /api/booking
 * 
 * GET /api/v1/booking - Not supported (use availability endpoint)
 * POST /api/v1/booking - Create a new booking
 */

// Re-export from main booking route to maintain consistency
// This allows us to gradually migrate while keeping the same logic
export { POST } from '../../booking/route'

