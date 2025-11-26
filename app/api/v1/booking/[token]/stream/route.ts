/**
 * User Booking SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time booking updates (user-facing)
 * 
 * GET /api/v1/booking/[token]/stream - Stream booking updates for a specific booking
 * Public endpoint (authenticated by token)
 * 
 * Uses Redis Queue pattern (1-to-1) for cross-instance communication when configured.
 */

import { NextResponse } from "next/server"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { getBookingByToken } from "@/lib/bookings"
import {
  isRedisConfigured,
  pushToQueue,
  popFromQueue,
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
  bookingId: string
  token: string
  lastHeartbeat: number
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
        endpoint: 'user-booking-sse',
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

export function getUserBookingSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast booking event to user's SSE connection
 * Uses Redis Queue pattern (1-to-1) for cross-instance delivery
 */
export async function broadcastUserBookingEvent(
  eventType: 'booking:status_changed' | 'booking:deposit_verified' | 'booking:updated',
  booking: {
    id: string
    status: string
    responseToken?: string | null
    [key: string]: any
  },
  metadata?: {
    previousStatus?: string
    depositWasVerified?: boolean
  }
): Promise<{ sentCount: number; totalClients: number; errors: number; redisPublished: boolean }> {
  if (!booking.responseToken) {
    return { sentCount: 0, totalClients: 0, errors: 0, redisPublished: false }
  }

  const eventData = {
    type: eventType,
    bookingId: booking.id,
    status: booking.status,
    booking: {
      id: booking.id,
      status: booking.status,
      name: booking.name || '',
      email: booking.email || '',
      event_type: booking.event_type || booking.eventType || '',
      start_date: booking.start_date || booking.startDate || Math.floor(Date.now() / 1000),
      end_date: booking.end_date || booking.endDate,
      start_time: booking.start_time || booking.startTime,
      end_time: booking.end_time || booking.endTime,
      updated_at: booking.updated_at || booking.updatedAt || Math.floor(Date.now() / 1000),
      deposit_evidence_url: booking.deposit_evidence_url || booking.depositEvidenceUrl,
      deposit_verified_at: booking.deposit_verified_at || booking.depositVerifiedAt,
      proposed_date: booking.proposed_date || booking.proposedDate,
      proposed_end_date: booking.proposed_end_date || booking.proposedEndDate,
    },
    metadata: metadata || {},
    timestamp: Date.now(),
  }
  
  // Publish to Redis Queue for cross-instance delivery
  let redisPublished = false
  if (isRedisConfigured()) {
    redisPublished = await pushToQueue(
      SSE_CHANNELS.userBooking(booking.id),
      eventType,
      eventData
    )
  }
  
  // Also deliver locally to in-memory clients
  const clientCount = sseClients.size
  if (clientCount === 0) {
    return { sentCount: 0, totalClients: 0, errors: 0, redisPublished }
  }
  
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  let errorCount = 0
  
  for (const client of sseClients) {
    if (client.bookingId !== booking.id) continue
    
    try {
      client.controller.enqueue(encodeSSEMessage(eventData))
      client.lastHeartbeat = Date.now()
      sentCount++
    } catch {
      errorCount++
      disconnectedClients.push(client)
    }
  }
  
  for (const client of disconnectedClients) {
    sseClients.delete(client)
  }
  
  return { sentCount, totalClients: clientCount, errors: errorCount, redisPublished }
}

export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  const { token } = await params
  
  await logger.info('User booking SSE connection request received', { 
    tokenPrefix: token.substring(0, 8) + '...' 
  })
  
  // Validate token and get booking
  let booking
  try {
    booking = await getBookingByToken(token)
    
    if (!booking) {
      await logger.warn('User booking SSE connection rejected: invalid or expired token', {
        tokenPrefix: token.substring(0, 8) + '...'
      })
      return NextResponse.json(
        { success: false, error: { message: "Invalid or expired token" } },
        { status: 401 }
      )
    }
  } catch (error) {
    await logger.error(
      'User booking SSE connection error: failed to validate token',
      error instanceof Error ? error : new Error(String(error))
    )
    return NextResponse.json(
      { success: false, error: { message: "Failed to validate token" } },
      { status: 500 }
    )
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
      
      const client: SSEClient = {
        controller,
        bookingId: booking.id,
        token: token,
        lastHeartbeat: Date.now(),
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
        logger.info('User booking SSE connection closed by client').catch(() => {})
      }
      
      try {
        // Send initial booking state
        controller.enqueue(encodeSSEMessage({
          type: 'booking:initial',
          bookingId: booking.id || '',
          status: booking.status || '',
          booking: {
            id: booking.id || '',
            status: booking.status || '',
            name: booking.name || '',
            email: booking.email || '',
            event_type: booking.eventType || '',
            start_date: booking.startDate || Math.floor(Date.now() / 1000),
            end_date: booking.endDate || null,
            start_time: booking.startTime || null,
            end_time: booking.endTime || null,
            updated_at: booking.updatedAt || Math.floor(Date.now() / 1000),
            deposit_evidence_url: booking.depositEvidenceUrl || null,
            deposit_verified_at: booking.depositVerifiedAt || null,
            proposed_date: booking.proposedDate || null,
            proposed_end_date: booking.proposedEndDate || null,
          },
          timestamp: Date.now(),
        }))
        
        await logger.info('User booking SSE connection established', {
          bookingId: booking.id,
          status: booking.status,
          redisEnabled: isRedisConfigured(),
        })
        
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encodeSSEHeartbeat())
            client.lastHeartbeat = Date.now()
          } catch { cleanup() }
        }, HEARTBEAT_INTERVAL_MS)
        
        // Redis Queue polling (for cross-instance messages)
        if (isRedisConfigured()) {
          redisPollInterval = setInterval(async () => {
            try {
              const message = await popFromQueue(SSE_CHANNELS.userBooking(booking.id))
              if (message) {
                try {
                  controller.enqueue(encodeSSEMessage(message.data))
                  client.lastHeartbeat = Date.now()
                } catch { cleanup(); return }
              }
            } catch {}
          }, REDIS_POLL_INTERVAL_MS)
        }
        
        request.signal.addEventListener('abort', abortHandler)
        abortListenerAdded = true
      } catch (error) {
        cleanup()
        try {
          await logger.error('User booking SSE connection error', error instanceof Error ? error : new Error(String(error)))
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
