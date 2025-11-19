export const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Hell University",
  "description": "A Cultural Hub in Mae Taeng, Chiang Mai, Thailand. Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings.",
  "url": process.env.NODE_ENV === 'production' ? "https://www.huculturehub.com" : "http://localhost:3000",
  "logo": "https://huculturehub.com/logo.png",
  "image": "https://huculturehub.com/og-image.jpg",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Mae Taeng",
    "addressRegion": "Chiang Mai",
    "addressCountry": "TH"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "email": "hello@huculturehub.com",
    "areaServed": "Thailand"
  },
  "sameAs": [
    "https://facebook.com/huculturehub",
    "https://instagram.com/huculturehub",
    "https://twitter.com/huculturehub"
  ],
  "foundingDate": "2024",
  "mission": "Providing event booking and activity arrangement services for cultural gatherings, workshops, and creative events in Northern Thailand"
}

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Hell University",
  "description": "A Cultural Hub in Mae Taeng, Chiang Mai, Thailand - Book event spaces and arrange cultural activities",
  "url": process.env.NODE_ENV === 'production' ? "https://www.huculturehub.com" : "http://localhost:3000",
  "potentialAction": {
    "@type": "SearchAction",
    "target": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity/search?q={search_term_string}" : "http://localhost:3000/search?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}

export const localBusinessStructuredData = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Hell University",
  "description": "A Cultural Hub in Mae Taeng, Chiang Mai, Thailand. Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings.",
  "url": process.env.NODE_ENV === 'production' ? "https://www.huculturehub.com" : "http://localhost:3000",
  "email": "hucultureinfo@huculturehub.com",
  "telephone": "+66-XX-XXX-XXXX", // Update with actual phone number if available
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Mae Taeng",
    "addressRegion": "Chiang Mai",
    "addressCountry": "TH"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "19.1200",
    "longitude": "98.9417"
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday"
      ],
      "opens": "09:00",
      "closes": "21:00"
    }
  ],
  "priceRange": "$$",
  "paymentAccepted": "Cash, Credit Card",
  "currenciesAccepted": "THB",
  "image": "https://www.huculturehub.com/og-image.jpg",
  "logo": "https://www.huculturehub.com/logo.png",
  "serviceArea": {
    "@type": "GeoCircle",
    "geoMidpoint": {
      "@type": "GeoCoordinates",
      "latitude": "19.1200",
      "longitude": "98.9417"
    }
  },
  "areaServed": {
    "@type": "City",
    "name": "Mae Taeng",
    "containedIn": {
      "@type": "State",
      "name": "Chiang Mai"
    }
  }
}

export const eventStructuredData = {
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Cultural Events at Hell University",
  "description": "Various cultural events, workshops, and creative activities",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": {
    "@type": "Place",
    "name": "Hell University",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Creative Street",
      "addressLocality": "Art District",
      "addressRegion": "City",
      "postalCode": "12345",
      "addressCountry": "US"
    }
  },
  "organizer": {
    "@type": "Organization",
    "name": "Hell University",
    "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity" : "http://localhost:3000"
  },
    "offers": {
      "@type": "Offer",
      "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity/booking" : "http://localhost:3000/booking",
      "price": "0",
      "priceCurrency": "THB",
      "availability": "https://schema.org/InStock",
      "description": "Book event space and arrange cultural activities"
    }
}

// Event interface for structured data generation
export interface EventForStructuredData {
  id: string
  title: string
  description: string
  start_date?: number | null
  end_date?: number | null
  event_date?: number | null
  created_at?: number | null
  updated_at?: number | null
  image_url?: string | null
  image_title?: string | null
  in_event_photos?: Array<{
    blob_url: string
    title?: string | null
  }>
}

function formatDateForSchema(timestamp?: number | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toISOString()
}

/**
 * Generate Article structured data for event pages (for social sharing)
 */
export function generateArticleStructuredData(event: EventForStructuredData) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://khem696.github.io/helluniversity' 
      : 'http://localhost:3000')
  
  const publishedDate = formatDateForSchema(event.created_at || Date.now() / 1000)
  const modifiedDate = formatDateForSchema(event.updated_at || event.created_at || Date.now() / 1000)
  
  const articleData: any = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": event.title,
    "description": event.description,
    "url": `${baseUrl}/events/${event.id}`,
    "datePublished": publishedDate,
    "dateModified": modifiedDate,
    "author": {
      "@type": "Organization",
      "name": "Hell University",
      "url": baseUrl
    },
    "publisher": {
      "@type": "Organization",
      "name": "Hell University",
      "logo": {
        "@type": "ImageObject",
        "url": `${baseUrl}/logo.png`
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `${baseUrl}/events/${event.id}`
    }
  }
  
  // Add event images
  const images: string[] = []
  if (event.image_url) {
    images.push(event.image_url)
    articleData.image = {
      "@type": "ImageObject",
      "url": event.image_url,
      "width": 1200,
      "height": 630
    }
  }
  if (event.in_event_photos && event.in_event_photos.length > 0) {
    event.in_event_photos.forEach((photo) => {
      if (photo.blob_url) {
        images.push(photo.blob_url)
      }
    })
  }
  
  if (images.length > 1) {
    articleData.image = images.map((url) => ({
      "@type": "ImageObject",
      "url": url
    }))
  }
  
  return articleData
}

/**
 * Generate event-specific structured data for SEO
 */
export function generateEventStructuredData(event: EventForStructuredData) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  const startDate = formatDateForSchema(event.start_date || event.event_date)
  const endDate = formatDateForSchema(event.end_date || event.event_date)
  
  const eventData: any = {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": event.title,
    "description": event.description,
    "url": `${baseUrl}/events/${event.id}`,
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": "Hell University",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Mae Taeng",
        "addressRegion": "Chiang Mai",
        "addressCountry": "TH"
      }
    },
    "organizer": {
      "@type": "Organization",
      "name": "Hell University",
      "url": baseUrl
    },
    "offers": {
      "@type": "Offer",
      "url": `${baseUrl}/booking`,
      "price": "0",
      "priceCurrency": "THB",
      "availability": "https://schema.org/InStock",
      "description": "Book event space and arrange cultural activities"
    }
  }
  
  if (startDate) {
    eventData.startDate = startDate
  }
  
  if (endDate && endDate !== startDate) {
    eventData.endDate = endDate
  }
  
  // Add event images
  const images: string[] = []
  if (event.image_url) {
    images.push(event.image_url)
  }
  if (event.in_event_photos && event.in_event_photos.length > 0) {
    event.in_event_photos.forEach((photo) => {
      if (photo.blob_url) {
        images.push(photo.blob_url)
      }
    })
  }
  
  if (images.length > 0) {
    eventData.image = images.length === 1 ? images[0] : images
  }
  
  return eventData
}

/**
 * Generate breadcrumb structured data
 */
export function generateBreadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": item.url.startsWith('http') ? item.url : `${baseUrl}${item.url}`
    }))
  }
}

/**
 * Generate ImageGallery structured data
 */
export function generateImageGalleryStructuredData(images: Array<{ url: string; title?: string; description?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "ImageGallery",
    "associatedMedia": images.map((image) => ({
      "@type": "ImageObject",
      "contentUrl": image.url,
      "name": image.title,
      "description": image.description
    }))
  }
}

/**
 * Generate AboutPage structured data
 */
export function generateAboutPageStructuredData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "name": "About Hell University",
    "description": "Learn about Hell University – a cultural hub in Mae Taeng, Chiang Mai, Thailand. Discover our mission to provide event booking and activity arrangement services for cultural gatherings, workshops, and creative events.",
    "url": `${baseUrl}/about`,
    "mainEntity": {
      "@type": "Organization",
      "name": "Hell University",
      "url": baseUrl,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Mae Taeng",
        "addressRegion": "Chiang Mai",
        "addressCountry": "TH"
      }
    }
  }
}

/**
 * Generate Service structured data for booking services
 */
export function generateServiceStructuredData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "serviceType": "Event Space Rental",
    "provider": {
      "@type": "LocalBusiness",
      "name": "Hell University",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Mae Taeng",
        "addressRegion": "Chiang Mai",
        "addressCountry": "TH"
      }
    },
    "areaServed": {
      "@type": "City",
      "name": "Mae Taeng",
      "containedIn": {
        "@type": "State",
        "name": "Chiang Mai"
      }
    },
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": "Event Booking Services",
      "itemListElement": [
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Event Space Booking",
            "description": "Book event spaces for cultural activities, workshops, and creative gatherings"
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Venue Rental",
            "description": "Rent venue space for events and activities in Mae Taeng, Chiang Mai"
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Cultural Activity Arrangement",
            "description": "Arrange and host cultural activities and creative workshops"
          }
        }
      ]
    },
    "url": `${baseUrl}/contact`
  }
}

/**
 * Generate ContactPage structured data
 */
export function generateContactPageStructuredData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "name": "Contact Hell University",
    "description": "Contact Hell University in Mae Taeng, Chiang Mai, Thailand – book event spaces, arrange cultural activities, and inquire about venue booking for events, workshops, and creative gatherings.",
    "url": `${baseUrl}/contact`,
    "mainEntity": {
      "@type": "Organization",
      "name": "Hell University",
      "url": baseUrl,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Mae Taeng",
        "addressRegion": "Chiang Mai",
        "addressCountry": "TH"
      },
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "email": "hucultureinfo@huculturehub.com",
        "areaServed": "Thailand",
        "availableLanguage": ["en", "th"]
      }
    }
  }
}