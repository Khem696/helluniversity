/**
 * Booking Deposit API v1
 * 
 * Versioned endpoint for deposit uploads
 * Maintains backward compatibility with /api/booking/deposit
 * 
 * POST /api/v1/booking/deposit - Upload deposit evidence
 */

// Re-export from main deposit route
export { POST } from '../../../booking/deposit/route'

