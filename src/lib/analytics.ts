import { Analytics } from '@vercel/analytics/react'

// Google Analytics configuration
export const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_ID || ''

// Track page views
export const pageview = (url: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('config', GA_TRACKING_ID, {
      page_path: url,
    })
  }
}

// Track custom events
export const event = ({
  action,
  category,
  label,
  value,
}: {
  action: string
  category: string
  label?: string
  value?: number
}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    })
  }
}

// Track form submissions
export const trackFormSubmission = (formName: string) => {
  event({
    action: 'form_submit',
    category: 'engagement',
    label: formName,
  })
}

// Track button clicks
export const trackButtonClick = (buttonName: string, location: string) => {
  event({
    action: 'click',
    category: 'engagement',
    label: `${buttonName}_${location}`,
  })
}

// Track AI generator usage
export const trackAIGeneration = (promptLength: number) => {
  event({
    action: 'ai_generate',
    category: 'feature_usage',
    label: 'ai_space_generator',
    value: promptLength,
  })
}

// Track scroll depth
export const trackScrollDepth = (depth: number) => {
  event({
    action: 'scroll',
    category: 'engagement',
    label: 'scroll_depth',
    value: depth,
  })
}

// Track time on page
export const trackTimeOnPage = (timeInSeconds: number) => {
  event({
    action: 'time_on_page',
    category: 'engagement',
    label: 'page_duration',
    value: timeInSeconds,
  })
}

// SEO-Specific Event Tracking Functions

// Track event page views
export const trackEventPageView = (eventId: string, eventTitle: string) => {
  event({
    action: 'view_event_page',
    category: 'seo',
    label: eventTitle,
    value: undefined,
  })
  // Also track as content view
  event({
    action: 'content_view',
    category: 'engagement',
    label: `event_${eventId}`,
  })
}

// Track event modal opens
export const trackEventModalOpen = (eventId: string, eventTitle: string) => {
  event({
    action: 'open_event_modal',
    category: 'engagement',
    label: eventTitle,
  })
}

// Track "View All Event Photos" clicks
export const trackViewAllEventPhotos = (eventId: string, eventTitle: string) => {
  event({
    action: 'click_view_all_photos',
    category: 'seo',
    label: eventTitle,
  })
}

// Track related event clicks
export const trackRelatedEventClick = (eventId: string, eventTitle: string) => {
  event({
    action: 'click_related_event',
    category: 'seo',
    label: eventTitle,
  })
}

// Track internal link clicks
export const trackInternalLinkClick = (linkText: string, destination: string, source: string) => {
  event({
    action: 'click_internal_link',
    category: 'seo',
    label: `${linkText} -> ${destination}`,
  })
  // Track for internal linking analysis
  event({
    action: 'internal_navigation',
    category: 'engagement',
    label: `${source} -> ${destination}`,
  })
}

// Track booking form interactions
export const trackBookingFormStart = () => {
  event({
    action: 'start_booking',
    category: 'conversion',
    label: 'booking_form_opened',
  })
}

export const trackBookingFormSubmit = (eventType: string) => {
  event({
    action: 'submit_booking',
    category: 'conversion',
    label: eventType,
    value: 1,
  })
}

export const trackBookingFormError = (errorType: string) => {
  event({
    action: 'booking_error',
    category: 'conversion',
    label: errorType,
  })
}

// Track image gallery interactions
export const trackImageGalleryView = (galleryType: string, imageCount: number) => {
  event({
    action: 'view_image_gallery',
    category: 'engagement',
    label: galleryType,
    value: imageCount,
  })
}

export const trackImageClick = (imageType: string, location: string) => {
  event({
    action: 'click_image',
    category: 'engagement',
    label: `${imageType}_${location}`,
  })
}

// Track search-related events
export const trackSearchQuery = (query: string, resultsCount: number) => {
  event({
    action: 'search',
    category: 'engagement',
    label: query,
    value: resultsCount,
  })
}

// Track Core Web Vitals (if needed)
export const trackCoreWebVital = (metric: string, value: number, id: string) => {
  event({
    action: metric,
    category: 'performance',
    label: id,
    value: Math.round(value),
  })
}

// Declare gtag function for TypeScript
declare global {
  interface Window {
    gtag: (
      command: 'config' | 'event' | 'js' | 'set',
      targetId: string,
      config?: Record<string, any>
    ) => void
  }
}
