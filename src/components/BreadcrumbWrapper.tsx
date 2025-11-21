'use client'

import { useEffect, useState } from 'react'
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs'

interface BreadcrumbWrapperProps {
  items: BreadcrumbItem[]
}

/**
 * Global breadcrumb wrapper that automatically hides when any dialog/modal is open
 * Uses MutationObserver to detect when Radix UI Dialog overlays are added/removed
 * Mobile-responsive: Adjusts positioning to avoid burger menu overlap
 */
export function BreadcrumbWrapper({ items }: BreadcrumbWrapperProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

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

    // Function to check if mobile menu is open
    const checkMobileMenuState = () => {
      // Check for mobile menu overlay - look for fixed overlay with z-40
      // The mobile menu has: className="lg:hidden fixed inset-0 z-40"
      const mobileMenuOverlay = Array.from(document.querySelectorAll('.fixed.inset-0')).find(
        (el) => {
          const zIndex = window.getComputedStyle(el).zIndex
          return zIndex === '40' && el.classList.contains('lg:hidden')
        }
      )
      setIsMobileMenuOpen(!!mobileMenuOverlay)
    }

    // Initial checks
    checkDialogState()
    checkMobileMenuState()

    // Watch for DOM changes (when dialogs open/close)
    const observer = new MutationObserver(() => {
      checkDialogState()
      checkMobileMenuState()
    })

    // Observe the entire document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-radix-dialog-overlay', 'role', 'class'],
    })

    // Also listen for custom events from components that manage dialogs
    const handleDialogChange = (e: CustomEvent<boolean>) => {
      setIsDialogOpen(e.detail)
    }

    // Listen for mobile menu state changes
    const handleMobileMenuChange = (e: CustomEvent<boolean>) => {
      setIsMobileMenuOpen(e.detail)
    }

    window.addEventListener('dialog-state-change', handleDialogChange as EventListener)
    window.addEventListener('mobile-menu-state-change', handleMobileMenuChange as EventListener)

    return () => {
      observer.disconnect()
      window.removeEventListener('dialog-state-change', handleDialogChange as EventListener)
      window.removeEventListener('mobile-menu-state-change', handleMobileMenuChange as EventListener)
    }
  }, [])

  const shouldHide = isDialogOpen || isMobileMenuOpen

  return (
    <div
      className={`hidden lg:block fixed left-0 right-0 z-[100] pointer-events-none transition-opacity duration-200 ${
        shouldHide ? 'opacity-0' : 'opacity-100'
      } ${
        // Desktop only: Standard spacing (breadcrumbs hidden on mobile/tablet)
        'top-[calc(var(--header-h)+1rem)]'
      }`}
    >
      {/* On mobile, use less horizontal padding and ensure breadcrumb stays on left side */}
      <div className="container mx-auto px-3 sm:px-4 md:px-6 lg:px-8 max-w-full">
        {/* On mobile, constrain width to avoid burger menu area (right side ~80px for buttons) */}
        <div className="pointer-events-auto pr-16 sm:pr-20 md:pr-0">
          <Breadcrumbs items={items} />
        </div>
      </div>
    </div>
  )
}

