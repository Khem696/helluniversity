import { AboutPage as AboutContent } from '@/components/AboutPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { generateAboutPageStructuredData } from '@/lib/structured-data'
import { BreadcrumbWrapper } from '@/components/BreadcrumbWrapper'

export const metadata = generateSEOMetadata({
  title: 'About',
  description: 'Learn about Hell University – a cultural hub in Mae Taeng, Chiang Mai, Thailand. Discover our mission to provide event booking and activity arrangement services for cultural gatherings, workshops, and creative events.',
  keywords: [
    'about Hell University',
    'cultural hub Mae Taeng',
    'Chiang Mai cultural hub',
    'event booking venue',
    'activity arrangement',
    'cultural activities',
    'creative expression',
    'cultural hub',
    'artistic community',
    'Thailand cultural hub',
  ],
  url: `${getBaseUrl()}/about`,
  type: 'website',
})

export default function About() {
  const structuredData = generateAboutPageStructuredData()
  
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      {/* Breadcrumbs - Automatically hides when modals are open */}
      <BreadcrumbWrapper items={[{ name: 'About', url: '/about' }]} />
      {/* Original About page layout - untouched */}
      <AboutContent />
    </>
  )
}


