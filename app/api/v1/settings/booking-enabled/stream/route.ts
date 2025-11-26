/**
 * Booking Settings SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time booking enabled status updates
 * 
 * GET /api/v1/settings/booking-enabled/stream - Stream booking enabled status changes
 * Public endpoint (no authentication required)
 * 
 * Uses Redis for cross-instance communication when configured.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
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
const MAX_SSE_CLIENTS = 1000
const STALE_CONNECTION_TIMEOUT_MS = 5 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30 * 1000
const REDIS_POLL_INTERVAL_MS = 5000 // Less frequent for status checks

interface SSEClient {
  controller: ReadableStreamDefaultController
  lastSent: boolean | null
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
        endpoint: 'booking-enabled-sse',
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

export function getSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast booking enabled status to all connected SSE clients
 */
export async function broadcastBookingEnabledStatus(
  enabled: boolean
): Promise<{ sentCount: number; totalClients: number; redisPublished: boolean }> {
  const eventData = {
    enabled,
    timestamp: Date.now(),
  }
  
  let redisPublished = false
  if (isRedisConfigured()) {
    const messageId = await publishBroadcast(
      SSE_CHANNELS.BOOKING_ENABLED, 
      'status:changed', 
      eventData
    )
    redisPublished = messageId !== null
  }
  
  const clientCount = sseClients.size
  if (clientCount === 0) {
    return { sentCount: 0, totalClients: 0, redisPublished }
  }
  
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  
  for (const client of sseClients) {
    try {
      client.controller.enqueue(encodeSSEMessage(eventData))
      client.lastSent = enabled
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

async function getBookingEnabledStatus(): Promise<boolean> {
  try {
    const db = getTursoClient()
    
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length > 0) {
      const result = await db.execute({
        sql: `SELECT value FROM settings WHERE key = 'bookings_enabled'`,
        args: [],
      })

      if (result.rows.length > 0) {
        const setting = result.rows[0] as any
        return setting.value === '1' || setting.value === 1 || setting.value === true
      }
    }
    
    return true
  } catch {
    return true
  }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Booking enabled SSE connection request received')

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
        ? await getChannelLatestTimestamp(SSE_CHANNELS.BOOKING_ENABLED)
        : Date.now()
      
      const client: SSEClient = {
        controller,
        lastSent: null,
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
        logger.info('Booking enabled SSE connection closed by client').catch(() => {})
      }
      
      try {
        const initialStatus = await getBookingEnabledStatus()
        client.lastSent = initialStatus
        controller.enqueue(encodeSSEMessage({ enabled: initialStatus, timestamp: Date.now() }))
        
        await logger.info('Booking enabled SSE connection established', { 
          enabled: initialStatus,
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
                SSE_CHANNELS.BOOKING_ENABLED,
                client.lastRedisTimestamp
              )
              
              for (const message of messages) {
                try {
                  // Send the status update directly
                  const statusData = message.data
                  controller.enqueue(encodeSSEMessage({
                    enabled: statusData.enabled,
                    timestamp: statusData.timestamp,
                  }))
                  client.lastSent = statusData.enabled
                  client.lastHeartbeat = Date.now()
                } catch { cleanup(); return }
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
          await logger.error('Booking enabled SSE connection error', error instanceof Error ? error : new Error(String(error)))
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
