/**
 * Admin Emails SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time email queue updates
 * 
 * GET /api/v1/admin/emails/stream - Stream email queue updates
 * Admin-only endpoint (requires authentication)
 * 
 * Uses Redis for cross-instance communication when configured.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { requireAuthorizedDomain } from "@/lib/auth"
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
        endpoint: 'admin-emails-sse',
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

export function getEmailsSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast email queue event to all connected SSE clients
 */
export async function broadcastEmailQueueEvent(
  type: 'email:queued' | 'email:processing' | 'email:sent' | 'email:failed' | 'email:updated' | 'email:deleted',
  email: {
    id: string
    emailType: string
    recipientEmail: string
    subject: string
    status: string
    retryCount?: number
    errorMessage?: string | null
    scheduledAt?: number
    nextRetryAt?: number | null
    sentAt?: number | null
    createdAt: number
    updatedAt: number
  }
): Promise<{ sentCount: number; totalClients: number; redisPublished: boolean }> {
  const eventData = {
    type,
    email,
    timestamp: Date.now(),
  }
  
  let redisPublished = false
  if (isRedisConfigured()) {
    const messageId = await publishBroadcast(SSE_CHANNELS.ADMIN_EMAILS, type, eventData)
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

async function getInitialEmailQueueStats(): Promise<{
  pending: number
  processing: number
  failed: number
  sent: number
  total: number
}> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: `SELECT status, COUNT(*) as count FROM email_queue GROUP BY status`,
  })

  const stats = { pending: 0, processing: 0, failed: 0, sent: 0, total: 0 }

  for (const row of result.rows) {
    const item = row as any
    const status = item.status
    const count = item.count as number
    
    stats.total += count
    if (status === "pending") stats.pending = count
    else if (status === "processing") stats.processing = count
    else if (status === "failed") stats.failed = count
    else if (status === "sent") stats.sent = count
  }

  return stats
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Emails SSE connection request received')

  try {
    await requireAuthorizedDomain()
  } catch {
    await logger.warn('Emails SSE connection rejected: authentication failed')
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
        ? await getChannelLatestTimestamp(SSE_CHANNELS.ADMIN_EMAILS)
        : Date.now()
      
      const client: SSEClient = {
        controller,
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
        logger.info('Emails SSE connection closed by client').catch(() => {})
      }
      
      try {
        const initialStats = await getInitialEmailQueueStats()
        controller.enqueue(encodeSSEMessage({ 
          type: 'email:stats',
          stats: initialStats,
          timestamp: Date.now() 
        }))
        
        await logger.info('Emails SSE connection established', { 
          initialStats,
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
                SSE_CHANNELS.ADMIN_EMAILS,
                client.lastRedisTimestamp
              )
              
              for (const message of messages) {
                try {
                  controller.enqueue(encodeSSEMessage(message.data))
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
          await logger.error('Emails SSE connection error', error instanceof Error ? error : new Error(String(error)))
        } catch {}
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
