/**
 * GET /api/health/monitoring
 * 
 * Returns system monitoring metrics and health status
 * Useful for dashboards, alerting, and system health checks
 */

import { NextResponse } from 'next/server'
import { checkSystemHealth } from '@/lib/monitoring'

export async function GET() {
  try {
    const health = await checkSystemHealth()
    
    return NextResponse.json({
      success: true,
      data: {
        healthy: health.healthy,
        timestamp: new Date().toISOString(),
        metrics: health.metrics,
        alerts: health.alerts,
      },
    })
  } catch (error) {
    console.error('Failed to get monitoring health:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve monitoring data',
      },
      { status: 500 }
    )
  }
}

