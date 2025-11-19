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

// Track event page views with custom dimensions
export const trackEventPageView = (eventId: string, eventTitle: string, eventType?: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    // Track with custom parameters (these will be mapped to custom dimensions in GA4)
    window.gtag('event', 'view_event_page', {
      event_category: 'seo',
      event_label: eventTitle,
      // Custom parameters that will be mapped to custom dimensions in GA4
      event_type: eventType || 'unknown',
      content_type: 'event_page',
      user_journey: 'content_discovery',
      event_id: eventId,
      event_title: eventTitle,
    })
    
    // Track as engagement goal
    window.gtag('event', 'engagement', {
      engagement_time_msec: 1000, // Estimated initial engagement
      event_category: 'engagement',
      event_label: `event_${eventId}`,
    })
  }
  
  // Also track as standard events
  event({
    action: 'view_event_page',
    category: 'seo',
    label: eventTitle,
    value: undefined,
  })
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

// Track internal link clicks with user journey
export const trackInternalLinkClick = (linkText: string, destination: string, source: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    // Track user journey
    window.gtag('event', 'internal_navigation', {
      event_category: 'engagement',
      event_label: `${source} -> ${destination}`,
      custom_parameters: {
        source_page: source,
        destination_page: destination,
        link_text: linkText,
        user_journey: 'internal_linking',
      },
    })
  }
  
  event({
    action: 'click_internal_link',
    category: 'seo',
    label: `${linkText} -> ${destination}`,
  })
  event({
    action: 'internal_navigation',
    category: 'engagement',
    label: `${source} -> ${destination}`,
  })
}

// ============================================
// CONVERSION GOALS & FUNNEL TRACKING
// ============================================

// Track booking form interactions with funnel steps
export const trackBookingFormStart = () => {
  if (typeof window !== 'undefined' && window.gtag) {
    // Funnel Step 1: Form Opened
    window.gtag('event', 'booking_funnel_step', {
      funnel_step: 1,
      funnel_name: 'booking_conversion',
      step_name: 'form_opened',
      event_category: 'conversion',
      event_label: 'booking_form_opened',
    })
    // Also track as conversion event
    event({
      action: 'start_booking',
      category: 'conversion',
      label: 'booking_form_opened',
    })
  }
}

// Track booking form field interactions (funnel step 2)
export const trackBookingFormFieldInteraction = (fieldName: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'booking_funnel_step', {
      funnel_step: 2,
      funnel_name: 'booking_conversion',
      step_name: 'form_field_interaction',
      field_name: fieldName,
      event_category: 'conversion',
    })
  }
}

// Track booking form completion attempt (funnel step 3)
export const trackBookingFormCompletionAttempt = (eventType: string, hasAllFields: boolean) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'booking_funnel_step', {
      funnel_step: 3,
      funnel_name: 'booking_conversion',
      step_name: 'form_completion_attempt',
      event_type: eventType,
      form_complete: hasAllFields,
      event_category: 'conversion',
    })
  }
}

// Track successful booking submission (CONVERSION GOAL)
export const trackBookingFormSubmit = (eventType: string, bookingData?: {
  participants?: string
  dateRange?: boolean
  organizationType?: string
}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    // Funnel Step 4: Conversion Complete
    window.gtag('event', 'booking_funnel_step', {
      funnel_step: 4,
      funnel_name: 'booking_conversion',
      step_name: 'conversion_complete',
      event_type: eventType,
      event_category: 'conversion',
    })
    
    // Track as conversion goal (GA4 format)
    window.gtag('event', 'conversion', {
      send_to: GA_TRACKING_ID,
      event_category: 'conversion',
      event_label: 'booking_submission',
      value: 1,
      currency: 'THB',
    })
    
    // Enhanced ecommerce tracking
    window.gtag('event', 'purchase', {
      transaction_id: `booking_${Date.now()}`,
      value: 0, // Free booking, but track for analytics
      currency: 'THB',
      items: [{
        item_id: 'event_booking',
        item_name: `Event Booking - ${eventType}`,
        item_category: eventType,
        quantity: bookingData?.participants ? parseInt(bookingData.participants) || 1 : 1,
        price: 0,
      }],
      custom_parameters: {
        event_type: eventType,
        organization_type: bookingData?.organizationType || 'unknown',
        date_range: bookingData?.dateRange ? 'yes' : 'no',
      },
    })
    
    // Also track as standard event
    event({
      action: 'submit_booking',
      category: 'conversion',
      label: eventType,
      value: 1,
    })
  }
}

export const trackBookingFormError = (errorType: string, funnelStep?: number) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'booking_funnel_abandonment', {
      funnel_name: 'booking_conversion',
      abandonment_step: funnelStep || 0,
      error_type: errorType,
      event_category: 'conversion',
    })
  }
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

// ============================================
// ENGAGEMENT METRICS & USER BEHAVIOR
// ============================================

// Track page engagement (time on page, scroll depth, etc.)
export const trackPageEngagement = (metrics: {
  timeOnPage?: number // seconds
  scrollDepth?: number // percentage
  interactions?: number
  pageType?: string
}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'page_engagement', {
      event_category: 'engagement',
      custom_parameters: {
        time_on_page: metrics.timeOnPage || 0,
        scroll_depth: metrics.scrollDepth || 0,
        interactions: metrics.interactions || 0,
        page_type: metrics.pageType || 'unknown',
      },
    })
  }
}

// Track content engagement
export const trackContentEngagement = (contentType: string, contentId: string, engagementType: 'view' | 'click' | 'share' | 'complete') => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'content_engagement', {
      event_category: 'engagement',
      event_label: `${contentType}_${engagementType}`,
      custom_parameters: {
        content_type: contentType,
        content_id: contentId,
        engagement_type: engagementType,
      },
    })
  }
}

// Track user journey step
export const trackUserJourneyStep = (step: string, journeyName: string, metadata?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'user_journey_step', {
      event_category: 'user_journey',
      event_label: step,
      custom_parameters: {
        journey_name: journeyName,
        step_name: step,
        ...metadata,
      },
    })
  }
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
