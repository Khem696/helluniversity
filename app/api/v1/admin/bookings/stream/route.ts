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
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { requireAuthorizedDomain } from "@/lib/auth"

// In-memory store for SSE connections
// In production, consider using Redis or a more robust solution for multi-instance deployments
interface SSEClient {
  controller: ReadableStreamDefaultController
  filters: {
    bookingId?: string
    status?: string
    eventType?: string
  }
  lastHeartbeat: number
}

const sseClients = new Set<SSEClient>()

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getBookingsSSEClientCount(): number {
  return sseClients.size
}

/**
 * Check if an event matches client filters
 */
function matchesFilters(
  event: {
    bookingId: string
    status?: string
    eventType: string
  },
  filters: SSEClient['filters']
): boolean {
  if (filters.bookingId && filters.bookingId !== event.bookingId) {
    return false
  }
  if (filters.status && filters.status !== event.status) {
    return false
  }
  if (filters.eventType && filters.eventType !== event.eventType) {
    return false
  }
  return true
}

/**
 * Broadcast booking event to all connected SSE clients
 * Only sends to clients whose filters match the event
 */
export function broadcastBookingEvent(
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
  }
) {
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
      user_response: booking.user_response || booking.userResponse,
      response_date: booking.response_date || booking.responseDate,
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
  
  // Send to all connected clients that match filters
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  
  for (const client of sseClients) {
    // Check if event matches client filters
    if (!matchesFilters(
      {
        bookingId: booking.id,
        status: booking.status,
        eventType: eventType,
      },
      client.filters
    )) {
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

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Bookings SSE connection request received')
  
  // Check authentication (admin-only)
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
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Add client to the set
      const client: SSEClient = {
        controller,
        filters,
        lastHeartbeat: Date.now(),
      }
      sseClients.add(client)
      
      // Store heartbeat interval for cleanup
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
        logger.info('Bookings SSE connection closed by client').catch(() => {
          // Ignore logging errors on disconnect
        })
      }
      
      try {
        await logger.info('Bookings SSE connection established', { filters })
        
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
          'Bookings SSE connection error',
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

