import { MetadataRoute } from 'next'
import { getTursoClient } from '@/lib/turso'
import { isProduction } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // Revalidate every hour

/**
 * Get the production base URL for sitemap
 * Sitemaps should ALWAYS use the production domain, not preview URLs
 * 
 * IMPORTANT: This function NEVER uses VERCEL_URL to avoid preview URLs
 * in sitemaps. Google Search Console only accepts URLs from verified domains.
 */
function getProductionBaseUrl(): string {
  // Priority 1: Explicitly set production URL (required in Vercel)
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    const url = process.env.NEXT_PUBLIC_BASE_URL.trim()
    // Ensure it's not a Vercel preview URL
    if (!url.includes('.vercel.app')) {
      return url
    }
  }
  
  // Priority 2: Alternative site URL variable
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const url = process.env.NEXT_PUBLIC_SITE_URL.trim()
    // Ensure it's not a Vercel preview URL
    if (!url.includes('.vercel.app')) {
      return url
    }
  }
  
  // Priority 3: Hardcoded production domain (fallback)
  // NEVER use VERCEL_URL here - it could be a preview URL
  // This ensures sitemaps always use production URLs even in preview builds
  const productionDomain = 'https://www.huculturehub.com'
  
  // Log warning if environment variable is not set (helpful for debugging)
  if (process.env.NODE_ENV !== 'development') {
    console.warn(
      '[Sitemap] NEXT_PUBLIC_BASE_URL not set. Using hardcoded production domain:',
      productionDomain,
      'Please set NEXT_PUBLIC_BASE_URL in Vercel environment variables.'
    )
  }
  
  return productionDomain
}

async function getPublishedEvents() {
  try {
    const db = getTursoClient()
    
    // Get all events (past and current) for sitemap
    const result = await db.execute({
      sql: `
        SELECT 
          e.id, 
          e.title, 
          e.updated_at,
          e.start_date,
          e.end_date,
          e.event_date
        FROM events e
        ORDER BY COALESCE(e.start_date, e.event_date, e.end_date) DESC
      `,
      args: [],
    })
    
    return result.rows
  } catch (error) {
    console.error('Error fetching events for sitemap:', error)
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Always use production URL for sitemap, never preview URLs
  const baseUrl = getProductionBaseUrl()
  
  // Debug: Log the base URL being used (only in non-production to avoid log spam)
  if (!isProduction()) {
    console.log('[Sitemap] Using base URL:', baseUrl)
    console.log('[Sitemap] NEXT_PUBLIC_BASE_URL:', process.env.NEXT_PUBLIC_BASE_URL)
    console.log('[Sitemap] NEXT_PUBLIC_SITE_URL:', process.env.NEXT_PUBLIC_SITE_URL)
    console.log('[Sitemap] VERCEL_URL:', process.env.VERCEL_URL)
  }
  
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/studio-gallery`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ]
  
  // Dynamic event pages
  let eventPages: MetadataRoute.Sitemap = []
  try {
    const events = await getPublishedEvents()
    eventPages = events.map((event: any) => {
      const eventDate = event.start_date || event.event_date || event.end_date
      const now = Math.floor(Date.now() / 1000)
      const daysUntilEvent = eventDate 
        ? (eventDate - now) / 86400
        : 999
      
      let changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never' = 'monthly'
      if (daysUntilEvent < 7) {
        changeFrequency = 'daily'
      } else if (daysUntilEvent < 30) {
        changeFrequency = 'weekly'
      }
      
      return {
        url: `${baseUrl}/events/${event.id}`,
        lastModified: new Date((event.updated_at as number) * 1000),
        changeFrequency,
        priority: daysUntilEvent < 30 ? 0.9 : 0.7,
      }
    })
  } catch (error) {
    console.error('Error generating event pages for sitemap:', error)
    // Continue with static pages only if events fail
  }
  
  return [...staticPages, ...eventPages]
}
