import { StudioGalleryPage as StudioGalleryContent } from '@/components/StudioGalleryPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'
import { Breadcrumbs } from '@/components/Breadcrumbs'

export const metadata = generateSEOMetadata({
  title: 'Studio & Gallery',
  description: 'Explore the Studio and Gallery of Hell University in Mae Taeng, Chiang Mai, Thailand. View our event spaces available for booking, artwork collection, and gallery exhibitions perfect for arranging cultural activities and events.',
  keywords: [
    'studio gallery',
    'art gallery',
    'event space gallery',
    'artwork collection',
    'art exhibitions',
    'cultural gallery',
    'art studio',
    'gallery photos',
    'artwork display',
    'Mae Taeng gallery',
    'Chiang Mai studio',
    'event space photos',
  ],
  url: `${getBaseUrl()}/studio-gallery`,
  type: 'website',
})

export default function StudioGallery() {
  return (
    <>
      {/* Breadcrumbs - Fixed position to not affect layout */}
      <div className="fixed top-[calc(var(--header-h)+1rem)] left-0 right-0 z-[100] pointer-events-none">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="pointer-events-auto">
            <Breadcrumbs items={[{ name: 'Studio & Gallery', url: '/studio-gallery' }]} />
          </div>
        </div>
      </div>
      {/* Original Studio Gallery page layout - untouched */}
      <StudioGalleryContent />
    </>
  )
}


