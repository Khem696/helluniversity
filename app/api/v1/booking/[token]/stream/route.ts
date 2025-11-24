/**
 * User Booking SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time booking updates (user-facing)
 * 
 * GET /api/v1/booking/[token]/stream - Stream booking updates for a specific booking
 * Public endpoint (authenticated by token)
 * 
 * This endpoint streams updates for the booking associated with the provided token.
 * Users can subscribe to real-time updates for their booking status.
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { getBookingByToken } from "@/lib/bookings"

// In-memory store for SSE connections
// In production, consider using Redis or a more robust solution for multi-instance deployments
interface SSEClient {
  controller: ReadableStreamDefaultController
  bookingId: string
  token: string
  lastHeartbeat: number
}

const sseClients = new Set<SSEClient>()

// Periodic cleanup interval for stale connections (every 5 minutes)
const STALE_CONNECTION_TIMEOUT = 5 * 60 * 1000 // 5 minutes in milliseconds
let cleanupInterval: NodeJS.Timeout | null = null

/**
 * Clean up stale SSE connections that haven't sent a heartbeat recently
 */
async function cleanupStaleConnections() {
  const now = Date.now()
  const staleClients: SSEClient[] = []
  
  for (const client of sseClients) {
    // If last heartbeat was more than timeout ago, consider it stale
    if (now - client.lastHeartbeat > STALE_CONNECTION_TIMEOUT) {
      staleClients.push(client)
    }
  }
  
  // Remove stale clients
  for (const client of staleClients) {
    try {
      client.controller.close()
    } catch (error) {
      // Already closed or error closing
    }
    sseClients.delete(client)
  }
  
  // Log cleanup if any clients were removed
  if (staleClients.length > 0) {
    try {
      const { logDebug } = await import('@/lib/logger')
      await logDebug(`Cleaned up ${staleClients.length} stale SSE connection(s)`, {
        endpoint: 'user-booking-sse',
        staleCount: staleClients.length,
      })
    } catch (logError) {
      // Fallback: if logger fails, silently continue (avoid infinite loops)
    }
  }
}

/**
 * Start periodic cleanup of stale connections
 */
function startCleanupInterval() {
  if (cleanupInterval) {
    return // Already started
  }
  
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections().catch(() => {
      // Ignore errors in cleanup to prevent interval from stopping
    })
  }, STALE_CONNECTION_TIMEOUT)
}

/**
 * Stop periodic cleanup (for testing or shutdown)
 */
function stopCleanupInterval() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getUserBookingSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast booking event to all connected SSE clients for a specific booking
 * Only sends to clients whose token matches the booking
 */
export function broadcastUserBookingEvent(
  eventType: 'booking:status_changed' | 'booking:deposit_verified' | 'booking:updated',
  booking: {
    id: string
    status: string
    responseToken?: string | null
    [key: string]: any
  },
  metadata?: {
    previousStatus?: string
  }
) {
  // Only broadcast if booking has a token (user-facing bookings)
  if (!booking.responseToken) {
    return
  }

  const message = JSON.stringify({
    type: eventType,
    bookingId: booking.id,
    status: booking.status,
    booking: {
      // Send only essential fields to reduce payload size
      id: booking.id,
      status: booking.status,
      name: booking.name,
      email: booking.email,
      event_type: booking.event_type || booking.eventType,
      start_date: booking.start_date || booking.startDate,
      end_date: booking.end_date || booking.endDate,
      start_time: booking.start_time || booking.startTime,
      end_time: booking.end_time || booking.endTime,
      updated_at: booking.updated_at || booking.updatedAt,
      // Include fields that might have changed
      deposit_evidence_url: booking.deposit_evidence_url || booking.depositEvidenceUrl,
      deposit_verified_at: booking.deposit_verified_at || booking.depositVerifiedAt,
      proposed_date: booking.proposed_date || booking.proposedDate,
      proposed_end_date: booking.proposed_end_date || booking.proposedEndDate,
    },
    metadata: metadata || {},
    timestamp: Date.now(),
  })
  const sseData = `data: ${message}\n\n`
  
  const clientCount = sseClients.size
  
  // If no clients connected, return early
  if (clientCount === 0) {
    return
  }
  
  // Send to all connected clients for this booking
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  
  for (const client of sseClients) {
    // Only send to clients watching this specific booking
    if (client.bookingId !== booking.id) {
      continue
    }
    
    try {
      const encoder = new TextEncoder()
      const encodedData = encoder.encode(sseData)
      client.controller.enqueue(encodedData)
      client.lastHeartbeat = Date.now()
      sentCount++
    } catch (error) {
      // Client disconnected, mark for removal
      disconnectedClients.push(client)
    }
  }
  
  // Remove disconnected clients
  for (const client of disconnectedClients) {
    sseClients.delete(client)
  }
  
  // Return count for logging/debugging
  return { sentCount, totalClients: clientCount }
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
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Add client to the set
      const client: SSEClient = {
        controller,
        bookingId: booking.id,
        token: token,
        lastHeartbeat: Date.now(),
      }
      sseClients.add(client)
      
      // Start cleanup interval if not already started
      startCleanupInterval()
      
      // Store heartbeat interval in client for cleanup
      let heartbeatInterval: NodeJS.Timeout | null = null
      
      // Handle client disconnect - defined outside try block so we can always remove it
      const abortHandler = () => {
        // Remove the event listener to prevent memory leak
        request.signal.removeEventListener('abort', abortHandler)
        
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        sseClients.delete(client)
        try {
          controller.close()
        } catch (error) {
          // Already closed
        }
        // Note: logger.info is async but we can't await in event listener
        logger.info('User booking SSE connection closed by client').catch(() => {
          // Ignore logging errors on disconnect
        })
      }
      
      try {
        // Send initial booking state immediately
        const encoder = new TextEncoder()
        const initialMessage = JSON.stringify({
          type: 'booking:initial',
          bookingId: booking.id,
          status: booking.status,
          booking: {
            id: booking.id,
            status: booking.status,
            name: booking.name,
            email: booking.email,
            event_type: booking.eventType,
            start_date: booking.startDate,
            end_date: booking.endDate,
            start_time: booking.startTime,
            end_time: booking.endTime,
            updated_at: booking.updatedAt,
            deposit_evidence_url: booking.depositEvidenceUrl,
            deposit_verified_at: booking.depositVerifiedAt,
            proposed_date: booking.proposedDate,
            proposed_end_date: booking.proposedEndDate,
          },
          timestamp: Date.now(),
        })
        controller.enqueue(encoder.encode(`data: ${initialMessage}\n\n`))
        
        await logger.info('User booking SSE connection established', {
          bookingId: booking.id,
          status: booking.status,
        })
        
        // Send periodic heartbeat to keep connection alive (every 30 seconds)
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`))
            client.lastHeartbeat = Date.now()
          } catch (error) {
            // Client disconnected - clean up everything
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval)
              heartbeatInterval = null
            }
            // Remove abort event listener to prevent memory leak
            request.signal.removeEventListener('abort', abortHandler)
            sseClients.delete(client)
            // Close controller to ensure stream is properly cleaned up
            try {
              controller.close()
            } catch (closeError) {
              // Already closed
            }
          }
        }, 30000)
        
        // Add abort event listener
        request.signal.addEventListener('abort', abortHandler)
      } catch (error) {
        // Clean up heartbeat interval if it was created
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        
        // Remove abort event listener to prevent memory leak (safe to call even if not added)
        request.signal.removeEventListener('abort', abortHandler)
        
        await logger.error(
          'User booking SSE connection error',
          error instanceof Error ? error : new Error(String(error))
        )
        sseClients.delete(client)
        try {
          controller.close()
        } catch (closeError) {
          // Already closed
        }
      }
    },
  })
  
  // Return SSE response with proper headers
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
})

