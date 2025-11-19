import { Hero } from "@/components/Hero"
import { EventSliders } from "@/components/EventSliders"
import { generateMetadata as generateSEOMetadata, getBaseUrl } from '@/lib/seo-utils'

export const metadata = generateSEOMetadata({
  title: 'Home',
  description: 'Hell University - A Cultural Hub in Mae Taeng, Chiang Mai, Thailand. Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings in Northern Thailand.',
  keywords: [
    'cultural hub',
    'event booking',
    'book event space',
    'arrange activities',
    'event venue booking',
    'cultural activities booking',
    'Mae Taeng',
    'Chiang Mai',
    'Thailand',
    'event space rental',
    'book cultural events',
    'activity arrangement',
    'creative space booking',
    'studio gallery',
    'art community',
    'cultural engagement',
    'art workshops',
    'creative events',
    'art exhibitions',
    'community events',
    'venue booking',
    'event arrangement',
  ],
  url: getBaseUrl(),
  type: 'website',
})

export default function Home() {
  return (
    <div className="min-h-vp bg-[#f4f1ed] no-horiz-overflow">
      <main id="main-content">
        <Hero />
        <EventSliders />
      </main>
    </div>
  )
}