import { AboutPage as AboutContent } from '@/components/AboutPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { generateAboutPageStructuredData } from '@/lib/structured-data'
import { Breadcrumbs } from '@/components/Breadcrumbs'

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
      {/* Breadcrumbs - Fixed position to not affect layout */}
      <div className="fixed top-[calc(var(--header-h)+1rem)] left-0 right-0 z-[100] pointer-events-none">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="pointer-events-auto">
            <Breadcrumbs items={[{ name: 'About', url: '/about' }]} />
          </div>
        </div>
      </div>
      {/* Original About page layout - untouched */}
      <AboutContent />
    </>
  )
}


