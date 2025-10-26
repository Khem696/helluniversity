import { MetadataRoute } from 'next'
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://khem696.github.io/helluniversity'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/private/', '/admin/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
