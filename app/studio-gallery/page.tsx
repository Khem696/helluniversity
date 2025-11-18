import { StudioGalleryPage as StudioGalleryContent } from '@/components/StudioGalleryPage'
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'

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
  return <StudioGalleryContent />
}


