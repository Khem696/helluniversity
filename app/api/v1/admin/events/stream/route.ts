/**
 * Admin Events SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time event updates
 * 
 * GET /api/v1/admin/events/stream - Stream event updates
 * Admin-only endpoint (requires authentication)
 * 
 * This endpoint streams updates whenever events are created, updated, or deleted.
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
  lastHeartbeat: number
}

const sseClients = new Set<SSEClient>()

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getEventsSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast event update to all connected SSE clients
 */
export function broadcastEventUpdate(
  type: 'event:created' | 'event:updated' | 'event:deleted',
  event: {
    id: string
    title: string
    description?: string | null
    image_id?: string | null
    event_date?: number | null
    start_date?: number | null
    end_date?: number | null
    image_url?: string | null
    image_title?: string | null
    created_at: number
    updated_at: number
  }
) {
  const message = JSON.stringify({
    type,
    event,
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
 * Get initial events list (for initial state)
 */
async function getInitialEvents(): Promise<Array<{
  id: string
  title: string
  description?: string | null
  image_id?: string | null
  event_date?: number | null
  start_date?: number | null
  end_date?: number | null
  image_url?: string | null
  image_title?: string | null
  created_at: number
  updated_at: number
}>> {
  const db = getTursoClient()

  const result = await db.execute({
    sql: `
      SELECT 
        e.id, e.title, e.description, e.image_id, e.event_date,
        e.start_date, e.end_date, e.created_at, e.updated_at,
        i.blob_url as image_url, i.title as image_title
      FROM events e
      LEFT JOIN images i ON e.image_id = i.id
      ORDER BY COALESCE(e.end_date, e.event_date, e.start_date) ASC, e.created_at DESC
      LIMIT 50
    `,
  })

  return result.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    description: row.description || null,
    image_id: row.image_id || null,
    event_date: row.event_date || null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    image_url: row.image_url || null,
    image_title: row.image_title || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
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
        // Send initial events immediately
        const initialEvents = await getInitialEvents()
        const initialMessage = JSON.stringify({ 
          type: 'events:initial',
          events: initialEvents,
          timestamp: Date.now() 
        })
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(`data: ${initialMessage}\n\n`))
        
        await logger.info('SSE connection established', { 
          initialEventsCount: initialEvents.length
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

