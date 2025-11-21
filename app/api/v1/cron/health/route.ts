/**
 * Health Check Endpoint for Cron Routes
 * 
 * Ultra-simple endpoint to verify routes are accessible
 * No dependencies, no wrappers, just basic logging
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const timestamp = new Date().toISOString()
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const url = new URL(request.url)
  
  // Log everything - Vercel cron jobs use user-agent "vercel-cron/1.0"
  console.log('[cron-health] Health check called:', {
    timestamp,
    method: request.method,
    path: url.pathname,
    userAgent,
    isVercelCron: userAgent === 'vercel-cron/1.0',
    headers: Object.fromEntries(request.headers.entries()),
  })
  console.error('[cron-health] ERROR level log test at:', timestamp)
  
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp,
    message: 'Cron health check endpoint is accessible',
    userAgent,
    isVercelCron: userAgent === 'vercel-cron/1.0',
    path: url.pathname,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export async function POST() {
  return GET()
}

