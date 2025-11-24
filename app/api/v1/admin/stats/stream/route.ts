/**
 * Admin Stats SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time admin statistics updates
 * 
 * GET /api/v1/admin/stats/stream - Stream admin statistics updates
 * Admin-only endpoint (requires authentication)
 * 
 * This endpoint streams updates whenever admin statistics change.
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { requireAuthorizedDomain } from "@/lib/auth"
import { listBookings } from "@/lib/bookings"
import { getEmailQueueStats } from "@/lib/email-queue"

// In-memory store for SSE connections
// In production, consider using Redis or a more robust solution for multi-instance deployments
interface SSEClient {
  controller: ReadableStreamDefaultController
  lastHeartbeat: number
}

const sseClients = new Set<SSEClient>()

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getStatsSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast stats update to all connected SSE clients
 */
export function broadcastStatsUpdate(stats: {
  bookings: {
    pending: number
  }
  emailQueue: {
    pending: number
    failed: number
    total: number
  }
}) {
  const message = JSON.stringify({
    type: 'stats:updated',
    stats,
    timestamp: Date.now(),
  })
  const sseData = `data: ${message}\n\n`
  
  const clientCount = sseClients.size
  
  // If no clients connected, return early
  if (clientCount === 0) {
    return
  }
  
  // Send to all connected clients
  const disconnectedClients: SSEClient[] = []
  let sentCount = 0
  
  for (const client of sseClients) {
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

/**
 * Get initial admin stats (for initial state)
 */
async function getInitialStats(): Promise<{
  bookings: {
    pending: number
  }
  emailQueue: {
    pending: number
    failed: number
    total: number
  }
}> {
  // Get pending bookings count (non-archived bookings that need attention)
  const pendingBookingsResult = await listBookings({
    statuses: ['pending', 'pending_deposit', 'paid_deposit'],
    excludeArchived: true,
    limit: 0, // We only need the count
    offset: 0,
  })

  // Get email queue stats
  const emailQueueStats = await getEmailQueueStats()
  
  // Calculate pending email count (pending + failed)
  const pendingEmailCount = (emailQueueStats.pending || 0) + (emailQueueStats.failed || 0)

  return {
    bookings: {
      pending: pendingBookingsResult.total,
    },
    emailQueue: {
      pending: emailQueueStats.pending || 0,
      failed: emailQueueStats.failed || 0,
      total: pendingEmailCount,
    },
  }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('SSE connection request received')

  // Check authentication
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    await logger.warn('SSE connection rejected: authentication failed')
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Add client to the set
      const client: SSEClient = {
        controller,
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
          // Ignore errors on close
        }
        logger.info('SSE connection closed by client').catch(() => {
          // Ignore logging errors on disconnect
        })
      }
      
      try {
        // Send initial stats immediately
        const initialStats = await getInitialStats()
        const initialMessage = JSON.stringify({ 
          type: 'stats:updated',
          stats: initialStats,
          timestamp: Date.now() 
        })
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(`data: ${initialMessage}\n\n`))
        
        await logger.info('SSE connection established', { 
          initialStats: {
            pendingBookings: initialStats.bookings.pending,
            pendingEmails: initialStats.emailQueue.total,
          }
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
        
        await logger.error('SSE connection error', error instanceof Error ? error : new Error(String(error)))
        sseClients.delete(client)
        try {
          controller.close()
        } catch (closeError) {
          // Ignore errors on close
        }
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
})

