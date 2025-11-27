/**
 * Action Locks SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time action lock status updates
 * 
 * GET /api/v1/admin/action-locks/stream - Stream action lock changes
 * Admin-only endpoint (requires authentication)
 * 
 * Query parameters:
 * - resourceType: Filter by resource type (booking, event, image, email, dashboard, global)
 * - resourceId: Filter by specific resource ID
 * - action: Filter by specific action
 * 
 * This endpoint streams updates whenever action locks are acquired, released, or expired.
 * Uses Redis for cross-instance communication when configured.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { requireAuthorizedDomain } from "@/lib/auth"
import { type ResourceType } from "@/lib/action-lock"
import {
  isRedisConfigured,
  publishBroadcast,
  getBroadcastMessages,
  getChannelLatestTimestamp,
  SSE_CHANNELS,
  encodeSSEMessage,
  encodeSSEHeartbeat,
} from "@/lib/redis-sse"

// Constants
const MAX_SSE_CLIENTS = 500
const STALE_CONNECTION_TIMEOUT_MS = 5 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30 * 1000
const REDIS_POLL_INTERVAL_MS = 1000

interface SSEClient {
  controller: ReadableStreamDefaultController
  filters: {
    resourceType?: ResourceType
    resourceId?: string
    action?: string
  }
  lastHeartbeat: number
  lastRedisTimestamp: number
}

const sseClients = new Set<SSEClient>()
let cleanupInterval: NodeJS.Timeout | null = null

async function cleanupStaleConnections() {
  const now = Date.now()
  const staleClients: SSEClient[] = []
  
  for (const client of sseClients) {
    if (now - client.lastHeartbeat > STALE_CONNECTION_TIMEOUT_MS) {
      staleClients.push(client)
    }
  }
  
  for (const client of staleClients) {
    try { client.controller.close() } catch {}
    sseClients.delete(client)
  }
  
  if (staleClients.length > 0) {
    try {
      const { logDebug } = await import('@/lib/logger')
      await logDebug(`Cleaned up ${staleClients.length} stale SSE connection(s)`, {
        endpoint: 'admin-action-locks-sse',
        staleCount: staleClients.length,
      })
    } catch {}
  }
}

function startCleanupInterval() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections().catch(() => {})
  }, STALE_CONNECTION_TIMEOUT_MS)
}

export function getActionLocksSSEClientCount(): number {
  return sseClients.size
}

function matchesFilters(
  event: { resourceType: ResourceType; resourceId: string; action: string },
  filters: SSEClient['filters']
): boolean {
  if (filters.resourceType && filters.resourceType !== event.resourceType) return false
  if (filters.resourceId && filters.resourceId !== event.resourceId) return false
  if (filters.action && filters.action !== event.action) return false
  return true
}

/**
 * Broadcast action lock event to all connected SSE clients
 */
export async function broadcastActionLockEvent(
  type: 'lock:acquired' | 'lock:released' | 'lock:expired' | 'lock:extended',
  resourceType: ResourceType,
  resourceId: string,
  action: string,
  data: {
    lockId: string
    adminEmail: string
    adminName?: string
    lockedAt?: number
    expiresAt?: number
  }
): Promise<{ sentCount: number; totalClients: number; redisPublished: boolean }> {
  const eventData = {
    type,
    resourceType,
    resourceId,
    action,
    ...data,
    timestamp: Date.now(),
  }
  
  // Publish to Redis
  let redisPublished = false
  if (isRedisConfigured()) {
    const messageId = await publishBroadcast(SSE_CHANNELS.ADMIN_ACTION_LOCKS, type, eventData)
    redisPublished = messageId !== null
  }
  
  const clientCount = sseClients.size
  if (clientCount === 0) {
    return { sentCount: 0, totalClients: 0, redisPublished }
  }
  
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  
  for (const client of sseClients) {
    if (!matchesFilters({ resourceType, resourceId, action }, client.filters)) continue
    
    try {
      client.controller.enqueue(encodeSSEMessage(eventData))
      client.lastHeartbeat = Date.now()
      sentCount++
    } catch {
      disconnectedClients.push(client)
    }
  }
  
  for (const client of disconnectedClients) {
    sseClients.delete(client)
  }
  
  return { sentCount, totalClients: clientCount, redisPublished }
}

async function getActiveLocks(filters?: SSEClient['filters']): Promise<Array<{
  id: string
  resourceType: ResourceType
  resourceId: string
  action: string
  adminEmail: string
  adminName?: string
  lockedAt: number
  expiresAt: number
}>> {
  try {
    const db = getTursoClient()
    const now = Math.floor(Date.now() / 1000)
    
    let sql = `SELECT * FROM action_locks WHERE expires_at > ?`
    const args: any[] = [now]
    
    if (filters?.resourceType) {
      sql += ` AND resource_type = ?`
      args.push(filters.resourceType)
    }
    if (filters?.resourceId) {
      sql += ` AND resource_id = ?`
      args.push(filters.resourceId)
    }
    if (filters?.action) {
      sql += ` AND action = ?`
      args.push(filters.action)
    }
    
    sql += ` ORDER BY locked_at DESC`
    
    const result = await db.execute({ sql, args })
    
    return result.rows.map((row: any) => ({
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      action: row.action,
      adminEmail: row.admin_email,
      adminName: row.admin_name || undefined,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    }))
  } catch {
    return []
  }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Action locks SSE connection request received')
  
  try {
    await requireAuthorizedDomain()
  } catch {
    await logger.warn('Action locks SSE connection rejected: authentication failed')
    return NextResponse.json(
      { success: false, error: { message: "Authentication required" } },
      { status: 401 }
    )
  }
  
  const { searchParams } = new URL(request.url)
  const resourceType = searchParams.get('resourceType') as ResourceType | null
  const resourceId = searchParams.get('resourceId')
  const action = searchParams.get('action')
  
  const filters: SSEClient['filters'] = {
    ...(resourceType && { resourceType }),
    ...(resourceId && { resourceId }),
    ...(action && { action }),
  }
  
  const stream = new ReadableStream({
    async start(controller) {
      if (sseClients.size >= MAX_SSE_CLIENTS) {
        await logger.warn('SSE client limit reached', {
          currentClients: sseClients.size,
          maxClients: MAX_SSE_CLIENTS,
        })
        try {
          controller.enqueue(encodeSSEMessage({
            type: 'error',
            error: 'connection_limit_reached',
            message: 'Server connection limit reached. Please try again later.',
            timestamp: Date.now(),
          }))
        } catch {}
        try { controller.close() } catch {}
        return
      }
      
      // OPTIMIZED: Get latest timestamp from Redis for initial sync (prevents missing historical messages)
      const initialTimestamp = isRedisConfigured()
        ? await getChannelLatestTimestamp(SSE_CHANNELS.ADMIN_ACTION_LOCKS)
        : Date.now()
      
      const client: SSEClient = {
        controller,
        filters,
        lastHeartbeat: Date.now(),
        lastRedisTimestamp: initialTimestamp,
      }
      sseClients.add(client)
      startCleanupInterval()
      
      let heartbeatInterval: NodeJS.Timeout | null = null
      let redisPollInterval: NodeJS.Timeout | null = null
      let abortListenerAdded = false
      
      const cleanup = () => {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null }
        if (redisPollInterval) { clearInterval(redisPollInterval); redisPollInterval = null }
        if (abortListenerAdded) {
          try { request.signal.removeEventListener('abort', abortHandler) } catch {}
          abortListenerAdded = false
        }
        sseClients.delete(client)
        try { controller.close() } catch {}
      }
      
      const abortHandler = () => {
        cleanup()
        logger.info('Action locks SSE connection closed by client').catch(() => {})
      }
      
      try {
        // Send initial state
        const activeLocks = await getActiveLocks(filters)
        controller.enqueue(encodeSSEMessage({
          type: 'locks:initial',
          locks: activeLocks,
          timestamp: Date.now(),
        }))
        
        await logger.info('Action locks SSE connection established', {
          filters,
          activeLocksCount: activeLocks.length,
          redisEnabled: isRedisConfigured(),
        })
        
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encodeSSEHeartbeat())
            client.lastHeartbeat = Date.now()
          } catch { cleanup() }
        }, HEARTBEAT_INTERVAL_MS)
        
        if (isRedisConfigured()) {
          redisPollInterval = setInterval(async () => {
            try {
              const messages = await getBroadcastMessages(
                SSE_CHANNELS.ADMIN_ACTION_LOCKS,
                client.lastRedisTimestamp
              )
              
              for (const message of messages) {
                const eventData = message.data
                if (matchesFilters(
                  { resourceType: eventData.resourceType, resourceId: eventData.resourceId, action: eventData.action },
                  client.filters
                )) {
                  try {
                    controller.enqueue(encodeSSEMessage(eventData))
                    client.lastHeartbeat = Date.now()
                  } catch { cleanup(); return }
                }
                if (message.timestamp > client.lastRedisTimestamp) {
                  client.lastRedisTimestamp = message.timestamp
                }
              }
            } catch {}
          }, REDIS_POLL_INTERVAL_MS)
        }
        
        request.signal.addEventListener('abort', abortHandler)
        abortListenerAdded = true
      } catch (error) {
        cleanup()
        try {
          await logger.error('Action locks SSE connection error', error instanceof Error ? error : new Error(String(error)))
        } catch {}
      }
    },
  })
  
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
