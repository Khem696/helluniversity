'use client'

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { generateBreadcrumbStructuredData } from '@/lib/structured-data'
import { getBaseUrl } from '@/lib/seo-utils'

export interface BreadcrumbItem {
  name: string
  url: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const baseUrl = getBaseUrl()
  
  // Always include home as first item
  const allItems = [
    { name: 'Home', url: '/' },
    ...items
  ]
  
  const structuredData = generateBreadcrumbStructuredData(
    allItems.map(item => ({
      name: item.name,
      url: item.url.startsWith('http') ? item.url : `${baseUrl}${item.url}`
    }))
  )
  
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center space-x-2 text-sm">
          {allItems.map((item, index) => {
            const isLast = index === allItems.length - 1
            
            return (
              <li key={item.url} className="flex items-center">
                {index > 0 && (
                  <ChevronRight className="w-4 h-4 mx-2 text-gray-400 dark:text-gray-500" />
                )}
                {isLast ? (
                  <span className="font-medium text-gray-900 dark:text-gray-100" aria-current="page">
                    {index === 0 ? (
                      <Home className="w-4 h-4 inline" />
                    ) : (
                      item.name
                    )}
                  </span>
                ) : (
                  <Link
                    href={item.url}
                    className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    {index === 0 ? (
                      <Home className="w-4 h-4" />
                    ) : (
                      item.name
                    )}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}

