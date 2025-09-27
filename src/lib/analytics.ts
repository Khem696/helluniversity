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
