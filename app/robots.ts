import { MetadataRoute } from 'next'
import { isProduction } from '@/lib/env'

/**
 * Get the production base URL for robots.txt
 * Robots.txt should ALWAYS use the production domain, not preview URLs
 * 
 * IMPORTANT: This function NEVER uses VERCEL_URL to avoid preview URLs
 * in robots.txt. Google Search Console only accepts URLs from verified domains.
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
  // This ensures robots.txt always uses production URLs even in preview builds
  const productionDomain = 'https://www.huculturehub.com'
  
  // Log warning if environment variable is not set (helpful for debugging)
  if (process.env.NODE_ENV !== 'development') {
    console.warn(
      '[Robots] NEXT_PUBLIC_BASE_URL not set. Using hardcoded production domain:',
      productionDomain,
      'Please set NEXT_PUBLIC_BASE_URL in Vercel environment variables.'
    )
  }
  
  return productionDomain
}

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  // Always use production URL for robots.txt, never preview URLs
  const baseUrl = getProductionBaseUrl()
  
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/booking/response/',
          '/booking/deposit/',
          '/private/',
          '/*.json$', // Exclude JSON files
        ],
        crawlDelay: 1, // 1 second delay between requests
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/booking/response/',
          '/booking/deposit/',
        ],
        crawlDelay: 0.5, // Faster for Googlebot
      },
      {
        userAgent: 'Googlebot-Image',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl.replace(/^https?:\/\//, ''), // Remove protocol for host field
  }
}
