/**
 * Health Check Endpoint for Cron Routes
 * 
 * Simple endpoint to verify cron routes are accessible and working
 * Protected with CRON_SECRET authentication
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-utils'

export async function GET(request: Request) {
  const timestamp = new Date().toISOString()
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const url = new URL(request.url)
  
  // Verify Vercel cron secret
  try {
    verifyCronSecret(request)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
    console.error('[cron-health] Authentication failed:', errorMessage)
    return NextResponse.json(
      {
        status: 'error',
        message: errorMessage,
        timestamp,
      },
      { status: 401 }
    )
  }
  
  // Log successful health check - Vercel cron jobs use user-agent "vercel-cron/1.0"
  console.log('[cron-health] Health check successful:', {
    timestamp,
    method: request.method,
    path: url.pathname,
    userAgent,
    isVercelCron: userAgent === 'vercel-cron/1.0',
  })
  
  return NextResponse.json({
    status: 'ok',
    timestamp,
    message: 'Cron health check endpoint is accessible',
    userAgent,
    isVercelCron: userAgent === 'vercel-cron/1.0',
    path: url.pathname,
  })
}

export async function POST(request: Request) {
  return GET(request)
}

