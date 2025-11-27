/**
 * Caching Layer
 * 
 * Provides in-memory caching with TTL for frequently accessed data
 * Reduces database load and improves response times
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
  version: number // Cache version for invalidation
}

// Global cache version - increments on major invalidations
let globalCacheVersion = 1

class SimpleCache {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private defaultTTL: number = 300 // 5 minutes default

  /**
   * Get value from cache
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return undefined
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    // Check cache version - if global version is newer, entry is stale
    if (entry.version < globalCacheVersion) {
      this.cache.delete(key)
      return undefined
    }

    return entry.value as T
  }

  /**
   * Set value in cache
   */
  set<T>(key: string, value: T, ttl?: number, version?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTTL) * 1000
    
    this.cache.set(key, {
      value,
      expiresAt,
      version: version || globalCacheVersion,
    })
  }

  /**
   * Delete value from cache
   */
  delete(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: string): void {
    const keys = Array.from(this.cache.keys())
    keys.forEach(key => {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    })
  }

  /**
   * Clean expired entries
   */
  clean(): number {
    const now = Date.now()
    let cleaned = 0
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        cleaned++
      }
    }
    
    return cleaned
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now()
    let expired = 0
    let active = 0
    
    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expired++
      } else {
        active++
      }
    }
    
    return {
      total: this.cache.size,
      active,
      expired,
    }
  }
}

// Singleton cache instance
const cache = new SimpleCache()

// Store interval ID for cleanup
let cleanupInterval: NodeJS.Timeout | null = null
let shutdownHandlersRegistered = false

// Clean expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  cleanupInterval = setInterval(() => {
    cache.clean()
  }, 5 * 60 * 1000)
}

// Register shutdown handlers (Node.js environment only)
if (typeof process !== 'undefined' && !shutdownHandlersRegistered) {
  shutdownHandlersRegistered = true
  
  const handleShutdown = () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
      cleanupInterval = null
    }
    cache.clear()
  }
  
  // Register for common shutdown signals
  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)
  process.on('beforeExit', handleShutdown)
}

/**
 * Cleanup cache interval (call on application shutdown)
 */
export function cleanupCacheInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

/**
 * Get cached value
 */
export function getCached<T>(key: string): T | undefined {
  return cache.get<T>(key)
}

/**
 * Set cached value
 */
export function setCached<T>(key: string, value: T, ttl?: number, version?: number): void {
  cache.set(key, value, ttl, version)
}

/**
 * Delete cached value
 */
export function deleteCached(key: string): void {
  cache.delete(key)
}

/**
 * Invalidate cache entries matching pattern
 * Includes retry logic for robustness (though in-memory cache rarely fails)
 * IMPROVED: Also increments global cache version for version-based invalidation
 */
export async function invalidateCache(pattern: string, retries: number = 3): Promise<void> {
  let lastError: Error | null = null
  
  // Increment global cache version for major invalidations (like 'bookings:list')
  // This ensures all related cache entries become stale
  if (pattern === 'bookings:list' || pattern.includes('booking')) {
    globalCacheVersion++
  }
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      cache.invalidate(pattern)
      // Success - return immediately
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // If not the last attempt, wait briefly before retrying
      if (attempt < retries - 1) {
        // Exponential backoff: 10ms, 20ms, 40ms
        const delay = Math.pow(2, attempt) * 10
        // Use setTimeout in Node.js environment, or immediate retry in browser
        if (typeof setTimeout !== 'undefined') {
          // In Node.js, we can't easily wait synchronously, so just retry immediately
          // The delay is minimal and cache operations are fast
          continue
        }
      }
    }
  }
  
  // If all retries failed, log error but don't throw (cache invalidation is non-critical)
  if (lastError) {
    // Use structured logger for errors
    import('./logger').then(({ logError }) => {
      logError('Failed to invalidate cache pattern', {
        pattern,
        retries,
        error: lastError.message,
      }, lastError).catch(() => {
        // Fallback if logger fails
      })
    }).catch(() => {
      // Fallback if logger import fails
    })
    // Track monitoring metric
    try {
      const { trackCacheInvalidationFailure } = await import('./monitoring')
      trackCacheInvalidationFailure(pattern, lastError)
    } catch {
      // Ignore monitoring errors
    }
    // Don't throw - cache invalidation failure shouldn't break the application
    // The cache will expire naturally via TTL, and next fetch will get fresh data
  }
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return cache.getStats()
}

/**
 * Cache key generators
 */
export const CacheKeys = {
  booking: (id: string) => `booking:${id}`,
  bookingList: (filters?: string) => `bookings:list:${filters || 'all'}`,
  bookingByToken: (token: string) => `booking:token:${token}`,
  image: (id: string) => `image:${id}`,
  imageList: (category?: string) => `images:list:${category || 'all'}`,
  event: (id: string) => `event:${id}`,
  eventList: () => `events:list`,
} as const

