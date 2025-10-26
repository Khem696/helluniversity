import { Metadata } from 'next'
import { StudioGalleryPage as StudioGalleryContent } from '@/components/StudioGalleryPage'

export const metadata: Metadata = {
  title: 'Studio & Gallery',
  description: 'Explore the Studio and Gallery of Hell University in one place.'
}

export default function StudioGallery() {
  return (
    <div className="min-h-screen bg-[#f4f1ed]">
      <StudioGalleryContent />
    </div>
  )
}


