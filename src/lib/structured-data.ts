export const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Hell University",
  "description": "A Cultural House for Creative Expression. Promoting cultural activities and community engagement through art, music, and creativity.",
  "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity" : "http://localhost:3000",
  "logo": "https://helluniversity.com/logo.png",
  "image": "https://helluniversity.com/og-image.jpg",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Creative Street",
    "addressLocality": "Art District",
    "addressRegion": "City",
    "postalCode": "12345",
    "addressCountry": "US"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+1-555-123-4567",
    "contactType": "customer service",
    "email": "hello@helluniversity.com"
  },
  "sameAs": [
    "https://facebook.com/helluniversity",
    "https://instagram.com/helluniversity",
    "https://twitter.com/helluniversity"
  ],
  "foundingDate": "2024",
  "mission": "Promoting cultural activities and community engagement through art, music, and creativity"
}

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Hell University",
  "description": "A Cultural House for Creative Expression",
  "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity" : "http://localhost:3000",
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
  "description": "A Cultural House for Creative Expression. Promoting cultural activities and community engagement through art, music, and creativity.",
  "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity" : "http://localhost:3000",
  "telephone": "+1-555-123-4567",
  "email": "hello@helluniversity.com",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Creative Street",
    "addressLocality": "Art District",
    "addressRegion": "City",
    "postalCode": "12345",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "40.7128",
    "longitude": "-74.0060"
  },
  "openingHours": "Mo-Su 09:00-21:00",
  "priceRange": "$$",
  "paymentAccepted": "Cash, Credit Card",
  "currenciesAccepted": "USD",
  "image": "https://helluniversity.com/og-image.jpg",
  "logo": "https://helluniversity.com/logo.png"
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
    "url": process.env.NODE_ENV === 'production' ? "https://khem696.github.io/helluniversity/reservation" : "http://localhost:3000/reservation",
    "price": "0",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}
