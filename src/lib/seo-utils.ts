import { Metadata } from 'next'
import { withBasePath } from './utils'

export interface SEOConfig {
  title: string
  description: string
  keywords?: string[]
  image?: string
  url?: string
  type?: 'website' | 'article'
  publishedTime?: string
  modifiedTime?: string
  author?: string
  noindex?: boolean
}

/**
 * Generate comprehensive metadata for SEO
 * Ensures consistent formatting across all pages
 */
export function generateMetadata(config: SEOConfig): Metadata {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://khem696.github.io/helluniversity' 
      : 'http://localhost:3000')
  
  const fullTitle = config.title.includes('Hell University') 
    ? config.title 
    : `${config.title} | Hell University`
  
  const imageUrl = config.image || withBasePath('/og-image.jpg')
  const pageUrl = config.url || baseUrl
  
  // Ensure description is optimal length (150-160 chars)
  const optimizedDescription = truncateDescription(config.description, 160)
  
  return {
    title: fullTitle,
    description: optimizedDescription,
    keywords: config.keywords,
    openGraph: {
      title: fullTitle,
      description: optimizedDescription,
      url: pageUrl,
      siteName: 'Hell University',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: config.title,
        },
      ],
      type: config.type || 'website',
      locale: 'en_US',
      ...(config.publishedTime && { publishedTime: config.publishedTime }),
      ...(config.modifiedTime && { modifiedTime: config.modifiedTime }),
      ...(config.author && { authors: [{ name: config.author }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: optimizedDescription,
      images: [imageUrl],
      creator: '@huculturehub',
    },
    alternates: {
      canonical: pageUrl,
    },
    robots: {
      index: !config.noindex,
      follow: !config.noindex,
      googleBot: {
        index: !config.noindex,
        follow: !config.noindex,
        'max-image-preview': 'large',
        'max-video-preview': -1,
        'max-snippet': -1,
      },
    },
  }
}

/**
 * Truncate description to optimal length for SEO
 * Truncates at word boundary to avoid cutting words
 */
export function truncateDescription(description: string, maxLength: number = 160): string {
  if (description.length <= maxLength) {
    return description
  }
  
  // Truncate at word boundary
  const truncated = description.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  
  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '...'
  }
  
  return truncated + '...'
}

/**
 * Get base URL for canonical URLs and metadata
 */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://khem696.github.io/helluniversity' 
      : 'http://localhost:3000')
}

