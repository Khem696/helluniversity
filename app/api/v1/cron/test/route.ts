/**
 * Test Cron Endpoint
 * 
 * Simple endpoint to verify Vercel cron jobs can reach the API routes
 * This endpoint does NOT require authentication to help diagnose routing issues
 */

// CRITICAL: Force dynamic execution to prevent caching
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const timestamp = new Date().toISOString()
  const url = new URL(request.url)
  
  // Log all headers (masked for security)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'authorization' || lowerKey === 'x-vercel-signature') {
      headers[key] = `[REDACTED] (length: ${value.length})`
    } else {
      headers[key] = value
    }
  })
  
  console.log('[cron-test] Test endpoint called:', {
    timestamp,
    method: request.method,
    url: url.pathname,
    headers,
  })
  
  return NextResponse.json({
    success: true,
    message: 'Cron test endpoint reached successfully',
    timestamp,
    method: request.method,
    path: url.pathname,
    hasAuthHeader: !!request.headers.get('authorization'),
    hasVercelSignature: !!request.headers.get('x-vercel-signature'),
    headerCount: Array.from(request.headers.keys()).length,
  })
}

export async function POST(request: Request) {
  return GET(request)
}

