/**
 * Health Check Endpoint for Cron Routes
 * 
 * Ultra-simple endpoint to verify routes are accessible
 * No dependencies, no wrappers, just basic logging
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()
  
  // Use console.log directly (not removed in production)
  console.log('[cron-health] Health check called at:', timestamp)
  console.error('[cron-health] ERROR level log test at:', timestamp)
  
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp,
    message: 'Cron health check endpoint is accessible',
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

