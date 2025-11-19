import { MetadataRoute } from 'next'

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
  (process.env.NODE_ENV === 'production' 
    ? 'https://khem696.github.io/helluniversity' 
    : 'http://localhost:3000')

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
