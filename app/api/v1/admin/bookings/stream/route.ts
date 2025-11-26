/**
 * Admin Bookings SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time booking updates
 * 
 * GET /api/v1/admin/bookings/stream - Stream booking updates
 * Admin-only endpoint (requires authentication)
 * 
 * Query parameters:
 * - bookingId: Filter by specific booking ID
 * - status: Filter by booking status
 * - eventType: Filter by event type (status_change, user_response, deposit_upload, update, created, deleted)
 * 
 * This endpoint streams updates whenever bookings are created, updated, or deleted.
 * Uses Redis for cross-instance communication when configured.
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
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
const MAX_SSE_CLIENTS = 1000
const STALE_CONNECTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds
const REDIS_POLL_INTERVAL_MS = 1000 // 1 second

// In-memory store for local SSE connections (fallback + local delivery)
interface SSEClient {
  controller: ReadableStreamDefaultController
  filters: {
    bookingId?: string
    status?: string
    eventType?: string
  }
  lastHeartbeat: number
  lastRedisTimestamp: number
}

const sseClients = new Set<SSEClient>()

let cleanupInterval: NodeJS.Timeout | null = null

/**
 * Clean up stale SSE connections
 */
async function cleanupStaleConnections() {
  const now = Date.now()
  const staleClients: SSEClient[] = []
  
  for (const client of sseClients) {
    if (now - client.lastHeartbeat > STALE_CONNECTION_TIMEOUT_MS) {
      staleClients.push(client)
    }
  }
  
  for (const client of staleClients) {
    try {
      client.controller.close()
    } catch (error) {
      // Already closed
    }
    sseClients.delete(client)
  }
  
  if (staleClients.length > 0) {
    try {
      const { logDebug } = await import('@/lib/logger')
      await logDebug(`Cleaned up ${staleClients.length} stale SSE connection(s)`, {
        endpoint: 'admin-bookings-sse',
        staleCount: staleClients.length,
      })
    } catch {
      // Ignore logging errors
    }
  }
}

function startCleanupInterval() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections().catch(() => {})
  }, STALE_CONNECTION_TIMEOUT_MS)
}

/**
 * Get the number of connected SSE clients
 */
export function getBookingsSSEClientCount(): number {
  return sseClients.size
}

/**
 * Check if an event matches client filters
 */
function matchesFilters(
  event: { bookingId: string; status?: string; eventType: string },
  filters: SSEClient['filters']
): boolean {
  if (filters.bookingId && filters.bookingId !== event.bookingId) return false
  if (filters.status && filters.status !== event.status) return false
  if (filters.eventType && filters.eventType !== event.eventType) return false
  return true
}

/**
 * Broadcast booking event to all connected SSE clients
 * Publishes to Redis for cross-instance communication
 * Also delivers locally to in-memory clients
 */
export async function broadcastBookingEvent(
  eventType: 'booking:status_changed' | 'booking:user_response' | 'booking:deposit_uploaded' | 'booking:updated' | 'booking:created' | 'booking:deleted',
  booking: {
    id: string
    status: string
    [key: string]: any
  },
  metadata?: {
    previousStatus?: string
    changedBy?: string
    changeReason?: string
    hasNewUserResponse?: boolean
    hasNewDeposit?: boolean
    depositWasVerified?: boolean
  }
): Promise<{ sentCount: number; totalClients: number; errors: number; redisPublished: boolean }> {
  const eventData = {
    type: eventType,
    bookingId: booking.id,
    status: booking.status,
    booking: {
      id: booking.id,
      reference_number: booking.reference_number ?? booking.referenceNumber ?? null,
      name: booking.name || '',
      email: booking.email || '',
      phone: booking.phone ?? null,
      participants: booking.participants ?? null,
      event_type: booking.event_type || booking.eventType || '',
      other_event_type: booking.other_event_type ?? booking.otherEventType ?? null,
      date_range: booking.date_range ?? booking.dateRange ?? 0,
      start_date: booking.start_date || booking.startDate || Math.floor(Date.now() / 1000),
      end_date: booking.end_date || booking.endDate,
      start_time: booking.start_time || booking.startTime,
      end_time: booking.end_time || booking.endTime,
      organization_type: booking.organization_type ?? booking.organizationType ?? null,
      organized_person: booking.organized_person ?? booking.organizedPerson ?? null,
      introduction: booking.introduction ?? null,
      biography: booking.biography ?? null,
      special_requests: booking.special_requests ?? booking.specialRequests ?? null,
      status: booking.status,
      admin_notes: booking.admin_notes ?? booking.adminNotes ?? null,
      response_token: booking.response_token ?? booking.responseToken ?? null,
      token_expires_at: booking.token_expires_at ?? booking.tokenExpiresAt ?? null,
      proposed_date: booking.proposed_date || booking.proposedDate,
      proposed_end_date: booking.proposed_end_date || booking.proposedEndDate,
      user_response: booking.user_response || booking.userResponse,
      response_date: booking.response_date || booking.responseDate,
      deposit_evidence_url: booking.deposit_evidence_url || booking.depositEvidenceUrl,
      deposit_verified_at: booking.deposit_verified_at || booking.depositVerifiedAt,
      deposit_verified_by: booking.deposit_verified_by ?? booking.depositVerifiedBy ?? null,
      deposit_verified_from_other_channel: booking.deposit_verified_from_other_channel ?? booking.depositVerifiedFromOtherChannel ?? false,
      fee_amount: booking.fee_amount ?? booking.feeAmount ?? null,
      fee_amount_original: booking.fee_amount_original ?? booking.feeAmountOriginal ?? null,
      fee_currency: booking.fee_currency ?? booking.feeCurrency ?? null,
      fee_conversion_rate: booking.fee_conversion_rate ?? booking.feeConversionRate ?? null,
      fee_rate_date: booking.fee_rate_date ?? booking.feeRateDate ?? null,
      fee_recorded_at: booking.fee_recorded_at ?? booking.feeRecordedAt ?? null,
      fee_recorded_by: booking.fee_recorded_by ?? booking.feeRecordedBy ?? null,
      fee_notes: booking.fee_notes ?? booking.feeNotes ?? null,
      created_at: booking.created_at || booking.createdAt || booking.updated_at || booking.updatedAt || Math.floor(Date.now() / 1000),
      updated_at: booking.updated_at || booking.updatedAt || Math.floor(Date.now() / 1000),
    },
    metadata: metadata || {},
    timestamp: Date.now(),
  }
  
  // Publish to Redis for cross-instance delivery
  let redisPublished = false
  if (isRedisConfigured()) {
    const messageId = await publishBroadcast(
      SSE_CHANNELS.ADMIN_BOOKINGS,
      eventType,
      eventData
    )
    redisPublished = messageId !== null
  }
  
  // Also deliver locally to in-memory clients (for same-instance delivery)
  const clientCount = sseClients.size
  if (clientCount === 0) {
    return { sentCount: 0, totalClients: 0, errors: 0, redisPublished }
  }
  
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  let errorCount = 0
  
  for (const client of sseClients) {
    if (!matchesFilters(
      { bookingId: booking.id, status: booking.status, eventType },
      client.filters
    )) {
      continue
    }
    
    try {
      client.controller.enqueue(encodeSSEMessage(eventData))
      client.lastHeartbeat = Date.now()
      sentCount++
    } catch (error) {
      errorCount++
      disconnectedClients.push(client)
    }
  }
  
  for (const client of disconnectedClients) {
    sseClients.delete(client)
  }
  
  return { sentCount, totalClients: clientCount, errors: errorCount, redisPublished }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Bookings SSE connection request received')
  
  // Check authentication
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    await logger.warn('Bookings SSE connection rejected: authentication failed')
    return NextResponse.json(
      { success: false, error: { message: "Authentication required" } },
      { status: 401 }
    )
  }
  
  // Parse query parameters for filtering
  const { searchParams } = new URL(request.url)
  const bookingId = searchParams.get('bookingId')
  const status = searchParams.get('status')
  const eventType = searchParams.get('eventType')
  
  const filters: SSEClient['filters'] = {
    ...(bookingId && { bookingId }),
    ...(status && { status }),
    ...(eventType && { eventType }),
  }
  
  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      // Check client limit
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
        try {
          controller.close()
        } catch {}
        return
      }
      
      // Add client
      // OPTIMIZED: Get latest timestamp from Redis for initial sync (prevents missing historical messages)
      const initialTimestamp = isRedisConfigured()
        ? await getChannelLatestTimestamp(SSE_CHANNELS.ADMIN_BOOKINGS)
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
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        if (redisPollInterval) {
          clearInterval(redisPollInterval)
          redisPollInterval = null
        }
        if (abortListenerAdded) {
          try {
            request.signal.removeEventListener('abort', abortHandler)
          } catch {}
          abortListenerAdded = false
        }
        sseClients.delete(client)
        try {
          controller.close()
        } catch {}
      }
      
      const abortHandler = () => {
        cleanup()
        logger.info('Bookings SSE connection closed by client').catch(() => {})
      }
      
      try {
        await logger.info('Bookings SSE connection established', { 
          filters,
          redisEnabled: isRedisConfigured(),
        })
        
        // Heartbeat interval
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encodeSSEHeartbeat())
            client.lastHeartbeat = Date.now()
          } catch (error) {
            cleanup()
          }
        }, HEARTBEAT_INTERVAL_MS)
        
        // Redis polling interval (for cross-instance messages)
        if (isRedisConfigured()) {
          redisPollInterval = setInterval(async () => {
            try {
              const messages = await getBroadcastMessages(
                SSE_CHANNELS.ADMIN_BOOKINGS,
                client.lastRedisTimestamp
              )
              
              for (const message of messages) {
                // Check filters
                const eventData = message.data
                if (matchesFilters(
                  { 
                    bookingId: eventData.bookingId, 
                    status: eventData.status, 
                    eventType: message.type 
                  },
                  client.filters
                )) {
                  try {
                    // Send the original event data, not wrapped
                    controller.enqueue(encodeSSEMessage(eventData))
                    client.lastHeartbeat = Date.now()
                  } catch {
                    cleanup()
                    return
                  }
                }
                
                if (message.timestamp > client.lastRedisTimestamp) {
                  client.lastRedisTimestamp = message.timestamp
                }
              }
            } catch (error) {
              // Log but don't cleanup on Redis errors
              console.error('[Redis Poll] Error:', error)
            }
          }, REDIS_POLL_INTERVAL_MS)
        }
        
        request.signal.addEventListener('abort', abortHandler)
        abortListenerAdded = true
      } catch (error) {
        cleanup()
        try {
          await logger.error(
            'Bookings SSE connection error',
            error instanceof Error ? error : new Error(String(error))
          )
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

