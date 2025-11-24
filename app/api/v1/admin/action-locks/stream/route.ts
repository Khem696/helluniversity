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
 * Clients should use EventSource API to connect to this endpoint.
 */

import { NextResponse } from "next/server"
import { getTursoClient } from "@/lib/turso"
import { createRequestLogger } from "@/lib/logger"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { requireAuthorizedDomain } from "@/lib/auth"
import { type ResourceType } from "@/lib/action-lock"

// In-memory store for SSE connections
// In production, consider using Redis or a more robust solution for multi-instance deployments
interface SSEClient {
  controller: ReadableStreamDefaultController
  filters: {
    resourceType?: ResourceType
    resourceId?: string
    action?: string
  }
  lastHeartbeat: number
}

const sseClients = new Set<SSEClient>()

/**
 * Get the number of connected SSE clients (for debugging)
 */
export function getActionLocksSSEClientCount(): number {
  return sseClients.size
}

/**
 * Check if an event matches client filters
 */
function matchesFilters(
  event: {
    resourceType: ResourceType
    resourceId: string
    action: string
  },
  filters: SSEClient['filters']
): boolean {
  if (filters.resourceType && filters.resourceType !== event.resourceType) {
    return false
  }
  if (filters.resourceId && filters.resourceId !== event.resourceId) {
    return false
  }
  if (filters.action && filters.action !== event.action) {
    return false
  }
  return true
}

/**
 * Broadcast action lock event to all connected SSE clients
 * Only sends to clients whose filters match the event
 */
export function broadcastActionLockEvent(
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
) {
  const message = JSON.stringify({
    type,
    resourceType,
    resourceId,
    action,
    ...data,
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
    if (!matchesFilters({ resourceType, resourceId, action }, client.filters)) {
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

/**
 * Get all active locks from database (for initial state)
 */
async function getActiveLocks(
  filters?: {
    resourceType?: ResourceType
    resourceId?: string
    action?: string
  }
): Promise<Array<{
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
    
    let sql = `
      SELECT * FROM action_locks 
      WHERE expires_at > ?
    `
    const args: any[] = [now]
    
    // Apply filters
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
  } catch (error) {
    // If there's any error, return empty array
    return []
  }
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  await logger.info('Action locks SSE connection request received')
  
  // Check authentication (admin-only)
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    await logger.warn('Action locks SSE connection rejected: authentication failed')
    return NextResponse.json(
      { success: false, error: { message: "Authentication required" } },
      { status: 401 }
    )
  }
  
  // Parse query parameters for filtering
  const { searchParams } = new URL(request.url)
  const resourceType = searchParams.get('resourceType') as ResourceType | null
  const resourceId = searchParams.get('resourceId')
  const action = searchParams.get('action')
  
  const filters: SSEClient['filters'] = {
    ...(resourceType && { resourceType }),
    ...(resourceId && { resourceId }),
    ...(action && { action }),
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
        logger.info('Action locks SSE connection closed by client').catch(() => {
          // Ignore logging errors on disconnect
        })
      }
      
      try {
        // Send initial state (all active locks matching filters)
        const activeLocks = await getActiveLocks(filters)
        const encoder = new TextEncoder()
        
        // Send initial state as a single event
        const initialMessage = JSON.stringify({
          type: 'locks:initial',
          locks: activeLocks,
          timestamp: Date.now(),
        })
        controller.enqueue(encoder.encode(`data: ${initialMessage}\n\n`))
        
        await logger.info('Action locks SSE connection established', {
          filters,
          activeLocksCount: activeLocks.length,
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
          'Action locks SSE connection error',
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

