/**
 * Redis-based SSE Implementation for Vercel
 * 
 * This module provides scalable SSE across multiple Vercel instances using
 * Upstash Redis (HTTP-based, compatible with both Node.js and Edge Runtime).
 * 
 * Architecture:
 * - Publishers: Push events to Redis (sorted sets with timestamp as score)
 * - Subscribers: Poll Redis for new messages since last check
 * - TTL-based cleanup: Old messages are automatically removed
 * 
 * Two patterns are supported:
 * 1. Broadcast Pattern (Sorted Set) - For 1-to-many events (admin dashboards)
 * 2. Queue Pattern (List with BLPOP) - For 1-to-1 events (user-specific)
 * 
 * @see https://upstash.com/docs/redis/overall/getstarted
 */

import { Redis } from '@upstash/redis'

// ============================================================================
// REDIS CLIENT SINGLETON
// ============================================================================

let redis: Redis | null = null
let redisInitError: Error | null = null

/**
 * Get the Redis client instance
 * Throws if Redis is not configured
 */
export function getRedisClient(): Redis {
  if (redis) return redis
  
  if (redisInitError) {
    throw redisInitError
  }
  
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  
  if (!url || !token) {
    redisInitError = new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set for Redis SSE'
    )
    throw redisInitError
  }
  
  try {
    redis = new Redis({ url, token })
    return redis
  } catch (error) {
    redisInitError = error instanceof Error ? error : new Error(String(error))
    throw redisInitError
  }
}

/**
 * Check if Redis is properly configured
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  if (!isRedisConfigured()) {
    return { ok: false, error: 'Redis not configured' }
  }
  
  try {
    const start = Date.now()
    const client = getRedisClient()
    await client.ping()
    const latencyMs = Date.now() - start
    return { ok: true, latencyMs }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ============================================================================
// SSE CHANNEL KEYS
// ============================================================================

export const SSE_CHANNELS = {
  // Admin broadcast channels
  ADMIN_BOOKINGS: 'sse:admin:bookings',
  ADMIN_ACTION_LOCKS: 'sse:admin:action-locks',
  ADMIN_STATS: 'sse:admin:stats',
  ADMIN_EMAILS: 'sse:admin:emails',
  ADMIN_EVENTS: 'sse:admin:events',
  
  // Public broadcast channels
  BOOKING_ENABLED: 'sse:public:booking-enabled',
  
  // User-specific queue (append booking token)
  userBooking: (bookingId: string) => `sse:user:booking:${bookingId}`,
} as const

// ============================================================================
// BROADCAST PATTERN (1-to-Many) - Using Sorted Sets
// ============================================================================

export interface SSEMessage {
  id: string
  type: string
  data: any
  timestamp: number
}

/**
 * Default TTL for broadcast messages (5 minutes)
 * Messages older than this are automatically removed
 */
const DEFAULT_BROADCAST_TTL_SECONDS = 300

/**
 * Default TTL for queue messages (1 hour)
 */
const DEFAULT_QUEUE_TTL_SECONDS = 3600

/**
 * Publish a broadcast message to a channel
 * Uses Redis Sorted Set with timestamp as score for efficient range queries
 * 
 * @param channel - Channel name (e.g., 'sse:admin:bookings')
 * @param type - Event type (e.g., 'booking:updated')
 * @param data - Event data (will be JSON serialized)
 * @param ttlSeconds - Time-to-live for messages (default: 5 minutes)
 * @returns Message ID or null if failed
 */
export async function publishBroadcast(
  channel: string,
  type: string,
  data: any,
  ttlSeconds: number = DEFAULT_BROADCAST_TTL_SECONDS
): Promise<string | null> {
  if (!isRedisConfigured()) {
    // Silently skip if Redis not configured (fallback to in-memory)
    return null
  }
  
  try {
    const client = getRedisClient()
    const timestamp = Date.now()
    const messageId = `${timestamp}-${Math.random().toString(36).substring(2, 11)}`
    
    const message: SSEMessage = {
      id: messageId,
      type,
      data,
      timestamp,
    }
    
    // Add to sorted set with timestamp as score
    await client.zadd(channel, {
      score: timestamp,
      member: JSON.stringify(message),
    })
    
    // Clean up old messages (older than TTL) - do this async, don't wait
    const cutoff = timestamp - (ttlSeconds * 1000)
    client.zremrangebyscore(channel, 0, cutoff).catch(() => {
      // Ignore cleanup errors
    })
    
    return messageId
  } catch (error) {
    // Log error but don't throw - allow fallback to in-memory
    console.error('[Redis SSE] Publish broadcast failed:', error)
    return null
  }
}

/**
 * Get broadcast messages since a timestamp
 * 
 * @param channel - Channel name
 * @param sinceTimestamp - Get messages after this timestamp (exclusive)
 * @param limit - Maximum number of messages to return (default: 100)
 * @returns Array of messages sorted by timestamp
 */
export async function getBroadcastMessages(
  channel: string,
  sinceTimestamp: number,
  limit: number = 100
): Promise<SSEMessage[]> {
  if (!isRedisConfigured()) {
    return []
  }
  
  try {
    const client = getRedisClient()
    
    // OPTIMIZED: Since sorted sets are ordered by score (timestamp), iterate from newest to oldest
    // This allows early termination when we've found enough messages or hit older messages
    // Get all messages (sorted by score ascending - oldest first)
    const allMessages = await client.zrange(channel, 0, -1, { withScores: true })
    
    // OPTIMIZED: Iterate from the end (newest messages) backwards for better performance
    // This allows early termination when we've found enough messages or hit older messages
    const filteredMessages: string[] = []
    for (let i = allMessages.length - 2; i >= 0; i -= 2) {
      const member = allMessages[i] as string
      const score = allMessages[i + 1] as number
      
      // Since we're iterating newest first (backwards), if we hit a message older than sinceTimestamp,
      // all remaining messages will also be older (sorted set is ordered ascending)
      if (score <= sinceTimestamp) {
        break // Early termination - all remaining messages are older
      }
      
      filteredMessages.push(member)
      if (filteredMessages.length >= limit) {
        break // Early termination - we have enough messages
      }
    }
    
    // Reverse to return oldest first (chronological order)
    return filteredMessages.reverse().map((msg: string): SSEMessage | null => {
      try {
        return JSON.parse(msg) as SSEMessage
      } catch {
        return null
      }
    }).filter((msg: SSEMessage | null): msg is SSEMessage => msg !== null)
  } catch (error) {
    console.error('[Redis SSE] Get broadcast messages failed:', error)
    return []
  }
}

/**
 * Get the latest timestamp from a channel (for initial sync)
 */
export async function getChannelLatestTimestamp(channel: string): Promise<number> {
  if (!isRedisConfigured()) {
    return Date.now()
  }
  
  try {
    const client = getRedisClient()
    const latest = await client.zrange(channel, -1, -1, { withScores: true })
    
    if (latest && latest.length >= 2) {
      // Format is [member, score]
      return Number(latest[1]) || Date.now()
    }
    return Date.now()
  } catch (error) {
    return Date.now()
  }
}

// ============================================================================
// QUEUE PATTERN (1-to-1) - Using Lists
// ============================================================================

/**
 * Push a message to a user-specific queue
 * 
 * @param queueKey - Queue key (e.g., 'sse:user:booking:abc123')
 * @param type - Event type
 * @param data - Event data
 * @param ttlSeconds - Queue expiry time (default: 1 hour)
 * @returns True if successful
 */
export async function pushToQueue(
  queueKey: string,
  type: string,
  data: any,
  ttlSeconds: number = DEFAULT_QUEUE_TTL_SECONDS
): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false
  }
  
  try {
    const client = getRedisClient()
    
    const message = JSON.stringify({
      type,
      data,
      timestamp: Date.now(),
    })
    
    // Push to list
    await client.lpush(queueKey, message)
    // Set expiry
    await client.expire(queueKey, ttlSeconds)
    
    return true
  } catch (error) {
    console.error('[Redis SSE] Push to queue failed:', error)
    return false
  }
}

/**
 * Pop a message from queue (non-blocking)
 * For Edge Runtime, use this with polling instead of BLPOP
 * 
 * @param queueKey - Queue key
 * @returns Message or null if queue is empty
 */
export async function popFromQueue(
  queueKey: string
): Promise<{ type: string; data: any; timestamp: number } | null> {
  if (!isRedisConfigured()) {
    return null
  }
  
  try {
    const client = getRedisClient()
    const messageStr = await client.rpop(queueKey)
    
    if (!messageStr) {
      return null
    }
    
    return JSON.parse(messageStr as string)
  } catch (error) {
    console.error('[Redis SSE] Pop from queue failed:', error)
    return null
  }
}

/**
 * Get all pending messages from a queue without removing them
 * Useful for getting initial state
 * 
 * @param queueKey - Queue key
 * @param limit - Maximum number of messages
 * @returns Array of messages (oldest first)
 */
export async function peekQueue(
  queueKey: string,
  limit: number = 50
): Promise<Array<{ type: string; data: any; timestamp: number }>> {
  if (!isRedisConfigured()) {
    return []
  }
  
  try {
    const client = getRedisClient()
    const messages = await client.lrange(queueKey, -limit, -1)
    
    return messages
      .map((msg) => {
        try {
          return JSON.parse(msg as string)
        } catch {
          return null
        }
      })
      .filter((msg): msg is { type: string; data: any; timestamp: number } => msg !== null)
      .reverse() // Return oldest first
  } catch (error) {
    console.error('[Redis SSE] Peek queue failed:', error)
    return []
  }
}

// ============================================================================
// SSE RESPONSE HELPERS
// ============================================================================

/**
 * Standard SSE response headers
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable nginx buffering
} as const

/**
 * Encode an SSE message
 */
export function encodeSSEMessage(data: any): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * Encode an SSE heartbeat comment
 */
export function encodeSSEHeartbeat(): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`: heartbeat\n\n`)
}

// ============================================================================
// HYBRID SSE CLIENT (Polls Redis, falls back to in-memory)
// ============================================================================

export interface HybridSSEClient {
  controller: ReadableStreamDefaultController
  lastTimestamp: number
  channel: string
  lastHeartbeat: number
}

/**
 * Create a polling loop for broadcast channels
 * This can be used in both Node.js and Edge runtime
 * 
 * @param client - SSE client object
 * @param pollIntervalMs - How often to poll Redis (default: 1000ms)
 * @param signal - AbortSignal for cancellation
 */
export async function startBroadcastPolling(
  client: HybridSSEClient,
  pollIntervalMs: number = 1000,
  signal?: AbortSignal
): Promise<void> {
  const encoder = new TextEncoder()
  
  while (!signal?.aborted) {
    try {
      // Get new messages from Redis
      const messages = await getBroadcastMessages(client.channel, client.lastTimestamp)
      
      for (const message of messages) {
        try {
          client.controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
          if (message.timestamp > client.lastTimestamp) {
            client.lastTimestamp = message.timestamp
          }
          client.lastHeartbeat = Date.now()
        } catch (error) {
          // Controller closed, exit loop
          return
        }
      }
      
      // Wait before next poll
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, pollIntervalMs)
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new Error('Aborted'))
        }, { once: true })
      })
    } catch (error) {
      if (signal?.aborted) return
      // On error, wait a bit longer before retry
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs * 2))
    }
  }
}

// ============================================================================
// CHANNEL-SPECIFIC PUBLISH HELPERS
// ============================================================================

/**
 * Publish a booking event to admin channel
 */
export async function publishBookingEvent(
  eventType: string,
  booking: any,
  metadata?: any
): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.ADMIN_BOOKINGS, eventType, {
    bookingId: booking.id,
    status: booking.status,
    booking,
    metadata: metadata || {},
  })
}

/**
 * Publish an action lock event
 */
export async function publishActionLockEvent(
  eventType: 'lock:acquired' | 'lock:released' | 'lock:expired' | 'lock:extended',
  resourceType: string,
  resourceId: string,
  action: string,
  data: {
    lockId: string
    adminEmail: string
    adminName?: string
    lockedAt?: number
    expiresAt?: number
  }
): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.ADMIN_ACTION_LOCKS, eventType, {
    resourceType,
    resourceId,
    action,
    ...data,
  })
}

/**
 * Publish stats update
 */
export async function publishStatsUpdate(stats: {
  bookings: { pending: number }
  emailQueue: { pending: number; failed: number; total: number }
}): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.ADMIN_STATS, 'stats:updated', stats)
}

/**
 * Publish email queue event
 */
export async function publishEmailQueueEvent(
  eventType: string,
  email: any
): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.ADMIN_EMAILS, eventType, email)
}

/**
 * Publish event update
 */
export async function publishEventUpdate(
  eventType: 'event:created' | 'event:updated' | 'event:deleted',
  event: any
): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.ADMIN_EVENTS, eventType, event)
}

/**
 * Publish booking enabled status
 */
export async function publishBookingEnabledStatus(enabled: boolean): Promise<string | null> {
  return publishBroadcast(SSE_CHANNELS.BOOKING_ENABLED, 'status:changed', { enabled })
}

/**
 * Publish user booking event (1-to-1 queue)
 */
export async function publishUserBookingEvent(
  bookingId: string,
  eventType: string,
  booking: any,
  metadata?: any
): Promise<boolean> {
  return pushToQueue(SSE_CHANNELS.userBooking(bookingId), eventType, {
    bookingId: booking.id,
    status: booking.status,
    booking,
    metadata: metadata || {},
  })
}
