/**
 * Health Check Endpoint v1
 * 
 * GET /api/v1/health
 * - Checks system health including database, email, and blob storage
 * - Public endpoint (no authentication required)
 */

import { NextResponse } from 'next/server'
import { getTursoClient } from '@/lib/turso'
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response'
import { createRequestLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/api-response'
import { getRequestPath } from '@/lib/api-versioning'
import { withVersioning } from '@/lib/api-version-wrapper'

interface HealthCheck {
  service: string
  healthy: boolean
  latency?: number
  error?: string
}

/**
 * Check database health
 */
async function checkDatabaseHealth(): Promise<HealthCheck> {
  try {
    const startTime = Date.now()
    const db = getTursoClient()
    
    // Simple query to test connection
    await db.execute('SELECT 1')
    
    const latency = Date.now() - startTime
    
    return {
      service: 'database',
      healthy: true,
      latency,
    }
  } catch (error) {
    return {
      service: 'database',
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check email service health
 */
async function checkEmailHealth(): Promise<HealthCheck> {
  try {
    const startTime = Date.now()
    
    // Check if email configuration exists
    const requiredEnvVars = [
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASS',
      'RESERVATION_EMAIL',
    ]
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      return {
        service: 'email',
        healthy: false,
        error: `Missing environment variables: ${missingVars.join(', ')}`,
      }
    }
    
    // Try to create transporter (doesn't actually send email)
    const { getTransporter } = await import('@/lib/email')
    const transporter = getTransporter()
    
    // Verify configuration
    if (!transporter) {
      return {
        service: 'email',
        healthy: false,
        error: 'Failed to create email transporter',
      }
    }
    
    const latency = Date.now() - startTime
    
    return {
      service: 'email',
      healthy: true,
      latency,
    }
  } catch (error) {
    return {
      service: 'email',
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check blob storage health
 */
async function checkBlobStorageHealth(): Promise<HealthCheck> {
  try {
    const startTime = Date.now()
    
    // Check if blob storage is configured
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        service: 'blob_storage',
        healthy: false,
        error: 'BLOB_READ_WRITE_TOKEN not configured',
      }
    }
    
    // Note: We don't actually test blob storage connection here to avoid
    // unnecessary API calls. In production, you might want to do a simple
    // list operation to verify connectivity.
    
    const latency = Date.now() - startTime
    
    return {
      service: 'blob_storage',
      healthy: true,
      latency,
    }
  } catch (error) {
    return {
      service: 'blob_storage',
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * GET /api/v1/health
 */
export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Health check request received')
    
    // Run all health checks in parallel
    const [database, email, blobStorage] = await Promise.all([
      checkDatabaseHealth(),
      checkEmailHealth(),
      checkBlobStorageHealth(),
    ])

    const checks = {
      database,
      email,
      blobStorage,
    }

    // Determine overall health
    const allHealthy = Object.values(checks).every(check => check.healthy)
    const status = allHealthy ? 'healthy' : 'degraded'
    
    await logger.info('Health check completed', {
      status,
      database: database.healthy,
      email: email.healthy,
      blobStorage: blobStorage.healthy
    })

    // Return health status
    return successResponse(
      {
        status,
        checks,
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

