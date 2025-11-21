'use client'

import { useEffect, useState } from 'react'
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs'

interface BreadcrumbWrapperProps {
  items: BreadcrumbItem[]
}

/**
 * Global breadcrumb wrapper that automatically hides when any dialog/modal is open
 * Uses MutationObserver to detect when Radix UI Dialog overlays are added/removed
 */
export function BreadcrumbWrapper({ items }: BreadcrumbWrapperProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  useEffect(() => {
    // Function to check if any dialog overlay exists
    const checkDialogState = () => {
      // Check for Radix UI Dialog overlay
      const dialogOverlay = document.querySelector('[data-radix-dialog-overlay]')
      // Also check for any element with dialog-related attributes
      const hasDialog = !!(
        dialogOverlay ||
        document.querySelector('[data-state="open"][data-radix-dialog-content]') ||
        document.querySelector('[role="dialog"]')
      )
      setIsDialogOpen(hasDialog)
    }

    // Initial check
    checkDialogState()

    // Watch for DOM changes (when dialogs open/close)
    const observer = new MutationObserver(() => {
      checkDialogState()
    })

    // Observe the entire document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-radix-dialog-overlay', 'role'],
    })

    // Also listen for custom events from components that manage dialogs
    const handleDialogChange = (e: CustomEvent<boolean>) => {
      setIsDialogOpen(e.detail)
    }

    window.addEventListener('dialog-state-change', handleDialogChange as EventListener)

    return () => {
      observer.disconnect()
      window.removeEventListener('dialog-state-change', handleDialogChange as EventListener)
    }
  }, [])

  return (
    <div
      className={`fixed top-[calc(var(--header-h)+1rem)] left-0 right-0 z-[100] pointer-events-none transition-opacity duration-200 ${
        isDialogOpen ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto">
          <Breadcrumbs items={items} />
        </div>
      </div>
    </div>
  )
}

