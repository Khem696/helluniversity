'use client'

import { useEffect } from 'react'
import { generateImageGalleryStructuredData } from '@/lib/structured-data'

interface ImageGalleryStructuredDataProps {
  images: Array<{
    url: string
    title?: string
    description?: string
  }>
}

/**
 * Client-side component to inject ImageGallery structured data
 * when images are loaded
 */
export function ImageGalleryStructuredData({ images }: ImageGalleryStructuredDataProps) {
  useEffect(() => {
    if (images.length === 0) return

    const structuredData = generateImageGalleryStructuredData(images)
    const scriptId = 'image-gallery-structured-data'

    // Remove existing script if present
    const existingScript = document.getElementById(scriptId)
    if (existingScript) {
      existingScript.remove()
    }

    // Create and inject structured data script
    const script = document.createElement('script')
    script.id = scriptId
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(structuredData)
    document.head.appendChild(script)

    // Cleanup on unmount
    return () => {
      const scriptToRemove = document.getElementById(scriptId)
      if (scriptToRemove) {
        scriptToRemove.remove()
      }
    }
  }, [images])

  return null // This component doesn't render anything
}

