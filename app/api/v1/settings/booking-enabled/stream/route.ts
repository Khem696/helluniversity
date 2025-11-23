/**
 * Booking Settings SSE Stream API v1
 * 
 * Server-Sent Events endpoint for real-time booking enabled status updates
 * 
 * GET /api/v1/settings/booking-enabled/stream - Stream booking enabled status changes
 * Public endpoint (no authentication required)
 * 
 * This endpoint streams updates whenever the booking enabled status changes.
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

// In-memory store for SSE connections
// In production, consider using Redis or a more robust solution for multi-instance deployments
interface SSEClient {
  controller: ReadableStreamDefaultController
  lastSent: boolean | null
}

const sseClients = new Set<SSEClient>()

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getSSEClientCount(): number {
  return sseClients.size
}

/**
 * Broadcast booking enabled status to all connected SSE clients
 */
export function broadcastBookingEnabledStatus(enabled: boolean) {
  const message = JSON.stringify({ enabled, timestamp: Date.now() })
  const sseData = `data: ${message}\n\n`
  
  const clientCount = sseClients.size
  
  // If no clients connected, return early
  if (clientCount === 0) {
    return
  }
  
  // Send to all connected clients
  const disconnectedClients: SSEClient[] = []
  
  for (const client of sseClients) {
    try {
      // Always send the update (don't check lastSent here - let client handle deduplication)
      // This ensures all clients get the latest status even if they missed previous updates
      const encoder = new TextEncoder()
      const encodedData = encoder.encode(sseData)
      client.controller.enqueue(encodedData)
      client.lastSent = enabled
    } catch (error) {
      // Client disconnected, mark for removal
      disconnectedClients.push(client)
    }
  }
  
  // Remove disconnected clients
  for (const client of disconnectedClients) {
    sseClients.delete(client)
  }
}

/**
 * Get current booking enabled status from database
 */
async function getBookingEnabledStatus(): Promise<boolean> {
  try {
    const db = getTursoClient()
    
    // Check if settings table exists
    const tableCheck = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`,
      args: [],
    })

    if (tableCheck.rows.length > 0) {
      // Table exists, try to get the setting
      const result = await db.execute({
        sql: `SELECT value FROM settings WHERE key = 'bookings_enabled'`,
        args: [],
      })

      if (result.rows.length > 0) {
        const setting = result.rows[0] as any
        return setting.value === '1' || setting.value === 1 || setting.value === true
      }
    }
    
    // Default to enabled if table doesn't exist or setting doesn't exist
    return true
  } catch (error) {
    // If there's any error, default to enabled
    return true
  }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('SSE connection request received')

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Add client to the set
      const client: SSEClient = {
        controller,
        lastSent: null,
      }
      sseClients.add(client)

      try {
        // Send initial status immediately
        const initialStatus = await getBookingEnabledStatus()
        client.lastSent = initialStatus
        const initialMessage = JSON.stringify({ enabled: initialStatus, timestamp: Date.now() })
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(`data: ${initialMessage}\n\n`))
        
        await logger.info('SSE connection established', { enabled: initialStatus })

        // Send periodic heartbeat to keep connection alive (every 30 seconds)
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`))
          } catch (error) {
            // Client disconnected
            clearInterval(heartbeatInterval)
            sseClients.delete(client)
          }
        }, 30000)

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeatInterval)
          sseClients.delete(client)
          try {
            controller.close()
          } catch (error) {
            // Already closed
          }
          // Note: logger.info is async but we can't await in event listener
          logger.info('SSE connection closed by client').catch(() => {
            // Ignore logging errors on disconnect
          })
        })
      } catch (error) {
        await logger.error('SSE connection error', error instanceof Error ? error : new Error(String(error)))
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

