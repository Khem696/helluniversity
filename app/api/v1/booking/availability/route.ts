/**
 * Booking Availability API v1
 * 
 * Versioned endpoint for booking availability checks
 * Maintains backward compatibility with /api/booking/availability
 * 
 * GET /api/v1/booking/availability - Get unavailable dates
 */

// Re-export from main availability route
export { GET } from '../../../booking/availability/route'

