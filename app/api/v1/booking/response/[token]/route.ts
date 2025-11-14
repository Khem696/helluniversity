/**
 * Booking Response API v1
 * 
 * Versioned endpoint for user booking responses
 * Maintains backward compatibility with /api/booking/response/[token]
 * 
 * GET /api/v1/booking/response/[token] - Get booking details by token
 * POST /api/v1/booking/response/[token] - Submit user response
 * 
 * NOTE: This route uses direct re-export which is the standard Next.js pattern.
 * Direct re-export is safe and does not cause circular dependencies.
 */

// Re-export handlers from legacy route using direct re-export (safe pattern)
export { GET, POST } from '../../../booking/response/[token]/route'
