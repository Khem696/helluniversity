/**
 * Health Check Endpoint for Cron Routes
 * 
 * Comprehensive health check that verifies:
 * - Cron route accessibility
 * - Database connectivity
 * - SMTP connectivity (optional)
 * 
 * Protected with CRON_SECRET authentication
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-utils'
import { checkDatabaseHealth } from '@/lib/turso'
import { logInfo, logError, logWarn } from '@/lib/logger'

interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  message: string
  userAgent: string
  isVercelCron: boolean
  path: string
  checks: {
    database: {
      healthy: boolean
      latency?: number
      error?: string
    }
    smtp: {
      healthy: boolean
      configured: boolean
      error?: string
    }
  }
}

async function checkSmtpHealth(): Promise<{ healthy: boolean; configured: boolean; error?: string }> {
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASSWORD
  
  if (!smtpUser || !smtpPass) {
    return { healthy: false, configured: false, error: 'SMTP not configured' }
  }
  
  try {
    // Dynamic import to avoid bundling nodemailer when not needed
    const { getTransporter } = await import('@/lib/email')
    const transporter = await getTransporter()
    await transporter.verify()
    return { healthy: true, configured: true }
  } catch (error) {
    return { 
      healthy: false, 
      configured: true, 
      error: error instanceof Error ? error.message : 'SMTP verification failed'
    }
  }
}

export async function GET(request: Request) {
  const timestamp = new Date().toISOString()
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const url = new URL(request.url)
  
  // Verify Vercel cron secret
  try {
    verifyCronSecret(request)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
    await logWarn('[cron-health] Authentication failed', { errorMessage })
    return NextResponse.json(
      {
        status: 'error',
        message: errorMessage,
        timestamp,
      },
      { status: 401 }
    )
  }
  
  // Run health checks in parallel
  const [dbHealth, smtpHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkSmtpHealth(),
  ])
  
  // Determine overall status
  let status: 'ok' | 'degraded' | 'error' = 'ok'
  let message = 'All systems operational'
  
  if (!dbHealth.healthy) {
    status = 'error'
    message = 'Database connection failed'
  } else if (!smtpHealth.healthy && smtpHealth.configured) {
    status = 'degraded'
    message = 'SMTP connection failed - emails may be delayed'
  } else if (!smtpHealth.configured) {
    status = 'degraded'
    message = 'SMTP not configured - email functionality disabled'
  }
  
  const result: HealthCheckResult = {
    status,
    timestamp,
    message,
    userAgent,
    isVercelCron: userAgent === 'vercel-cron/1.0',
    path: url.pathname,
    checks: {
      database: {
        healthy: dbHealth.healthy,
        latency: dbHealth.latency,
        error: dbHealth.error,
      },
      smtp: smtpHealth,
    },
  }
  
  // Log health check result
  if (status === 'error') {
    await logError('[cron-health] Health check failed', result, new Error(message))
  } else if (status === 'degraded') {
    await logWarn('[cron-health] Health check degraded', result)
  } else {
    await logInfo('[cron-health] Health check passed', { 
      dbLatency: dbHealth.latency,
      smtpConfigured: smtpHealth.configured,
    })
  }
  
  return NextResponse.json(result, { 
    status: status === 'error' ? 503 : 200 
  })
}

export async function POST(request: Request) {
  return GET(request)
}

