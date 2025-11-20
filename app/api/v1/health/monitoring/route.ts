/**
 * Monitoring Health Endpoint v1
 * 
 * GET /api/v1/health/monitoring
 * 
 * Returns system monitoring metrics and health status
 * Useful for dashboards, alerting, and system health checks
 */

import { NextResponse } from 'next/server'
import { checkSystemHealth } from '@/lib/monitoring'
import { getRequestPath } from '@/lib/api-versioning'
import { withVersioning } from '@/lib/api-version-wrapper'
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Monitoring health check request received')
    
    try {
      const health = await checkSystemHealth()
      
      await logger.info('Monitoring health check completed', {
        healthy: health.healthy,
        alertsCount: health.alerts.length
      })
      
      return successResponse(
        {
          healthy: health.healthy,
          timestamp: new Date().toISOString(),
          metrics: health.metrics,
          alerts: health.alerts,
        },
        { requestId }
      )
    } catch (error) {
      await logger.error('Failed to get monitoring health', error instanceof Error ? error : new Error(String(error)))
      throw error // Let withErrorHandling handle the error response
    }
  })
})

