import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Base path helpers for GitHub Pages (or any Next.js basePath)
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function withBasePath(path: string): string {
  if (!path) return BASE_PATH
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!BASE_PATH) return normalizedPath
  // Avoid double slashes when concatenating
  return `${BASE_PATH}${normalizedPath}`.replace(/\/+/, '/').replace(/\/+/, '/')
}

// Performance utilities
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

import { API_PATHS } from './api-config'

// Image optimization utilities
export function getOptimizedImageUrl(
  src: string,
  width?: number,
  height?: number,
  quality: number = 75
): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src
  }
  
  const params = new URLSearchParams()
  if (width) params.set('w', width.toString())
  if (height) params.set('h', height.toString())
  params.set('q', quality.toString())
  params.set('f', 'webp')
  
  return `${src}?${params.toString()}`
}

// Cache for thumbnail manifest (loaded once)
let thumbnailManifestCache: { 
  thumbnails: Record<string, string>
  generatedAt?: string
} | null = null

/**
 * Load thumbnail manifest (for static mode)
 */
async function loadThumbnailManifest(): Promise<{ thumbnails: Record<string, string> } | null> {
  if (thumbnailManifestCache) {
    return thumbnailManifestCache
  }

  try {
    const response = await fetch(withBasePath('/aispaces/studio-thumbnails.json'), {
      cache: 'force-cache'
    })
    if (response.ok) {
      const data = await response.json()
      thumbnailManifestCache = data
      return data
    }
  } catch (error) {
    console.warn('Failed to load thumbnail manifest:', error)
  }
  return null
}

/**
 * Get optimized thumbnail URL for carousel images
 * Uses API route for optimization in server mode, uses build-time thumbnails in static mode
 */
export async function getThumbnailUrlAsync(
  originalPath: string,
  width: number = 280,
  height: number = 280,
  quality: number = 80
): Promise<string> {
  // Check if we're in static export mode (API routes unavailable)
  const isStaticMode = process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'
  
  // For external URLs, return original
  if (originalPath.startsWith('http://') || originalPath.startsWith('https://')) {
    return originalPath
  }
  
  // For static mode, use build-time thumbnails
  if (isStaticMode) {
    const manifest = await loadThumbnailManifest()
    if (manifest && manifest.thumbnails[originalPath]) {
      return withBasePath(manifest.thumbnails[originalPath])
    }
    // Fallback to original if thumbnail not found
    return withBasePath(originalPath)
  }
  
  // For server mode, use optimization API
  const params = new URLSearchParams()
  params.set('path', originalPath)
  params.set('w', width.toString())
  params.set('h', height.toString())
  params.set('q', quality.toString())
  params.set('format', 'webp')
  // Add cache buster to ensure fresh image (especially important after regeneration)
  params.set('_t', Date.now().toString())
  
  return `${API_PATHS.imagesOptimize}?${params.toString()}`
}

/**
 * Get optimized thumbnail URL (synchronous version for immediate use)
 * In static mode, will return original path initially, then update when manifest loads
 */
export function getThumbnailUrl(
  originalPath: string,
  width: number = 280,
  height: number = 280,
  quality: number = 80
): string {
  // Check if we're in static export mode (API routes unavailable)
  const isStaticMode = process.env.NEXT_PUBLIC_USE_STATIC_IMAGES === '1'
  
  // For external URLs, return original
  if (originalPath.startsWith('http://') || originalPath.startsWith('https://')) {
    return originalPath
  }
  
  // For static mode, try to use cached manifest
  if (isStaticMode) {
    if (thumbnailManifestCache && thumbnailManifestCache.thumbnails[originalPath]) {
      // Add cache-busting query parameter based on manifest generation time
      const thumbnailPath = thumbnailManifestCache.thumbnails[originalPath]
      const manifestTime = thumbnailManifestCache.generatedAt
      // Use timestamp to bust cache - more aggressive than before
      const timestamp = manifestTime ? new Date(manifestTime).getTime() : Date.now()
      const cacheBuster = `?v=${timestamp}`
      return withBasePath(thumbnailPath + cacheBuster)
    }
    // In static mode, always try to use thumbnail even if manifest not loaded yet
    // Extract filename and construct thumbnail path
    const filename = originalPath.split('/').pop() || ''
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'))
    const thumbnailPath = `/aispaces/studio/thumbnails/${nameWithoutExt}.webp`
    // Add cache buster to force reload
    return withBasePath(thumbnailPath + `?v=${Date.now()}`)
  }
  
  // For server mode, use optimization API
  const params = new URLSearchParams()
  params.set('path', originalPath)
  params.set('w', width.toString())
  params.set('h', height.toString())
  params.set('q', quality.toString())
  params.set('format', 'webp')
  // Add cache buster to ensure fresh image (especially important after regeneration)
  params.set('_t', Date.now().toString())
  
  return `${API_PATHS.imagesOptimize}?${params.toString()}`
}

// Export the async loader for components that need it
export { loadThumbnailManifest }

// Lazy loading utilities
export function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  )
}

// Form validation utilities
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validatePhone(phone: string): boolean {
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/
  return phoneRegex.test(phone.replace(/\s/g, ''))
}

// Local storage utilities
export function getFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue
  
  try {
    const item = window.localStorage.getItem(key)
    return item ? JSON.parse(item) : defaultValue
  } catch {
    return defaultValue
  }
}

export function setToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Handle storage errors silently
  }
}

// Performance monitoring
export function measurePerformance(name: string, fn: () => void): void {
  if (typeof window === 'undefined') {
    fn()
    return
  }
  
  const start = performance.now()
  fn()
  const end = performance.now()
  
  console.log(`${name} took ${end - start} milliseconds`)
}

// Error handling utilities
export function handleError(error: unknown, context?: string): void {
  console.error(`Error${context ? ` in ${context}` : ''}:`, error)
  
  // In production, you might want to send this to an error tracking service
  if (process.env.NODE_ENV === 'production') {
    // Example: Sentry.captureException(error)
  }
}

/**
 * Image aspect ratio and display utilities for gallery grid
 */

export interface ImageDisplayParams {
  backgroundSize: string
  backgroundPosition: string
}

/**
 * Calculate optimal background-size and position for displaying an image
 * in a 16:9 aspect ratio grid tile based on the image's aspect ratio.
 * 
 * @param aspectRatio - Image aspect ratio (width / height)
 * @param colPct - Column position percentage (0, 50, or 100)
 * @param rowPct - Row position percentage (0, 50, or 100)
 * @returns Object with backgroundSize and backgroundPosition CSS values
 */
export function calculateImageDisplayParams(
  aspectRatio: number,
  colPct: number = 50,
  rowPct: number = 50
): ImageDisplayParams {
  // Target aspect ratio for grid tiles (16:9 = 1.777...)
  const targetAspectRatio = 16 / 9

  // Simple approach: use larger scale for portrait images, original for others
  // All tiles must use the SAME scale factor for the same image to maintain jigsaw alignment
  const scaleFactor = aspectRatio < targetAspectRatio ? 400 : 290

  // Always scale both dimensions equally to maintain jigsaw effect
  return {
    backgroundSize: `${scaleFactor}% ${scaleFactor}%`,
    backgroundPosition: `${colPct}% ${rowPct}%`
  }
}

/**
 * Detect image aspect ratio by loading the image
 * Returns a promise that resolves with the aspect ratio (width / height)
 */
export function detectImageAspectRatio(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const aspectRatio = img.width / img.height
      resolve(aspectRatio)
    }
    img.onerror = () => {
      // Default to 16:9 if detection fails
      console.warn(`Failed to detect aspect ratio for ${src}, using default 16:9`)
      resolve(16 / 9)
    }
    img.src = src
  })
}

/**
 * Cache for image aspect ratios to avoid repeated detection
 */
const aspectRatioCache = new Map<string, number>()

/**
 * Get image aspect ratio with caching
 */
export async function getImageAspectRatio(src: string): Promise<number> {
  if (aspectRatioCache.has(src)) {
    return aspectRatioCache.get(src)!
  }
  
  const aspectRatio = await detectImageAspectRatio(src)
  aspectRatioCache.set(src, aspectRatio)
  return aspectRatio
}