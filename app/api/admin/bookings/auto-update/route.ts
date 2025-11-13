/**
 * Admin Manual Trigger for Auto-Update Bookings
 * 
 * POST /api/admin/bookings/auto-update - Manually trigger auto-update bookings
 * - Requires Google Workspace authentication
 * - Allows admins to manually trigger the auto-update function for testing
 */

import { NextResponse } from 'next/server'
import { autoUpdateFinishedBookings } from '@/lib/bookings'
import { checkAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes, ApiResponse } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'

export async function POST(request: Request) {
  return withErrorHandling(async (): Promise<NextResponse<ApiResponse<any>>> => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/admin/bookings/auto-update')
    
    // Check authentication
    const authResult = await checkAdminAuth(requestId, logger, '/api/admin/bookings/auto-update')
    if (!authResult.success) {
      return authResult.response
    }
    
    await logger.info('Manual auto-update trigger request received', {
      userId: authResult.user.id,
      email: authResult.user.email
    })
    
    try {
      // Run auto-update
      const result = await autoUpdateFinishedBookings()
      
      await logger.info('Manual auto-update completed', {
        finished: result.finished,
        cancelled: result.cancelled,
        updatedCount: result.updatedBookings.length
      })
      
      return successResponse(
        {
          message: 'Bookings auto-updated successfully',
          finished: result.finished,
          cancelled: result.cancelled,
          updatedBookings: result.updatedBookings.map(b => ({
            id: b.booking.id,
            oldStatus: b.oldStatus,
            newStatus: b.newStatus,
            reason: b.reason
          }))
        },
        { requestId }
      )
    } catch (error) {
      await logger.error(
        'Manual auto-update failed',
        error instanceof Error ? error : new Error(String(error))
      )
      
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to auto-update bookings',
        error instanceof Error ? error.message : undefined,
        500,
        { requestId }
      )
    }
  }, { endpoint: '/api/admin/bookings/auto-update' })
}

