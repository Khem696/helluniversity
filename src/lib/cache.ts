/**
 * Caching Layer
 * 
 * Provides in-memory caching with TTL for frequently accessed data
 * Reduces database load and improves response times
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

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

    return entry.value as T
  }

  /**
   * Set value in cache
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTTL) * 1000
    
    this.cache.set(key, {
      value,
      expiresAt,
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

// Clean expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cache.clean()
  }, 5 * 60 * 1000)
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
export function setCached<T>(key: string, value: T, ttl?: number): void {
  cache.set(key, value, ttl)
}

/**
 * Delete cached value
 */
export function deleteCached(key: string): void {
  cache.delete(key)
}

/**
 * Invalidate cache entries matching pattern
 */
export function invalidateCache(pattern: string): void {
  cache.invalidate(pattern)
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

