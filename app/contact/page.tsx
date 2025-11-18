import { ContactPage as ContactContent } from '@/components/ContactPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { generateContactPageStructuredData } from '@/lib/structured-data'

export const metadata = generateSEOMetadata({
  title: 'Contact',
  description: 'Contact Hell University in Mae Taeng, Chiang Mai, Thailand – book event spaces, arrange cultural activities, and inquire about venue booking for events, workshops, and creative gatherings.',
  keywords: [
    'contact Hell University',
    'book event space',
    'event booking inquiry',
    'venue booking',
    'arrange activities',
    'Mae Taeng event venue',
    'Chiang Mai cultural hub',
    'event space rental',
    'activity arrangement',
    'cultural events booking',
    'studio booking',
    'gallery information',
  ],
  url: `${getBaseUrl()}/contact`,
  type: 'website',
})

export default function Contact() {
  const structuredData = generateContactPageStructuredData()
  
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      <ContactContent />
    </>
  )
}


