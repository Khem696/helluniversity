import { MetadataRoute } from 'next'
import { isProduction } from '@/lib/env'

/**
 * Get the production base URL for robots.txt
 * Robots.txt should use the production domain
 */
function getProductionBaseUrl(): string {
  // Priority 1: Explicitly set production URL
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }
  
  // Priority 2: Alternative site URL variable
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL
  }
  
  // Priority 3: Default production URL
  // Never use VERCEL_URL for robots.txt as it could be a preview URL
  if (isProduction()) {
    return 'https://www.huculturehub.com'
  }
  
  // For non-production, still return production URL
  return 'https://www.huculturehub.com'
}

const baseUrl = getProductionBaseUrl()

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
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
