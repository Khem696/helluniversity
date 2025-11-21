import { ContactPage as ContactContent } from '@/components/ContactPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { generateContactPageStructuredData, generateServiceStructuredData } from '@/lib/structured-data'
import { BreadcrumbWrapper } from '@/components/BreadcrumbWrapper'

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
  const contactStructuredData = generateContactPageStructuredData()
  const serviceStructuredData = generateServiceStructuredData()
  
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(contactStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(serviceStructuredData),
        }}
      />
      {/* Breadcrumbs - Automatically hides when modals are open */}
      <BreadcrumbWrapper items={[{ name: 'Contact', url: '/contact' }]} />
      {/* Original Contact page layout - untouched */}
      <ContactContent />
    </>
  )
}


