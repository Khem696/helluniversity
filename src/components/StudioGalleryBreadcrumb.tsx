'use client'

import { useEffect, useState } from 'react'
import { Breadcrumbs } from './Breadcrumbs'

/**
 * Breadcrumb component for Studio Gallery page
 * Automatically hides when image viewer dialog is open
 */
export function StudioGalleryBreadcrumb() {
  const [isViewerOpen, setIsViewerOpen] = useState(false)

  // Listen for dialog state changes via custom event
  useEffect(() => {
    const handleViewerStateChange = (e: CustomEvent<boolean>) => {
      setIsViewerOpen(e.detail)
    }

    window.addEventListener('studio-gallery-viewer-change', handleViewerStateChange as EventListener)
    
    return () => {
      window.removeEventListener('studio-gallery-viewer-change', handleViewerStateChange as EventListener)
    }
  }, [])

  return (
    <div 
      className={`fixed top-[calc(var(--header-h)+1rem)] left-0 right-0 z-[100] pointer-events-none transition-opacity duration-200 ${
        isViewerOpen ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto">
          <Breadcrumbs items={[{ name: 'Studio & Gallery', url: '/studio-gallery' }]} />
        </div>
      </div>
    </div>
  )
}

