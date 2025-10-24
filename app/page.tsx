import { Hero } from "@/components/Hero"
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Home',
  description: 'Hell University - A Cultural House for Creative Expression. Promoting cultural activities and community engagement through art, music, and creativity.',
  openGraph: {
    title: 'Hell University - A Cultural House for Creative Expression',
    description: 'Promoting cultural activities and community engagement through art, music, and creativity.',
    url: process.env.NODE_ENV === 'production' ? 'https://khem696.github.io/helluniversity' : 'http://localhost:3000',
    siteName: 'Hell University',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Hell University - Cultural House',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hell University - A Cultural House for Creative Expression',
    description: 'Promoting cultural activities and community engagement through art, music, and creativity.',
    images: ['/og-image.jpg'],
  },
  alternates: {
    canonical: process.env.NODE_ENV === 'production' ? 'https://khem696.github.io/helluniversity' : 'http://localhost:3000',
  },
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f4f1ed]">
      <main id="main-content">
        <Hero />
      </main>
    </div>
  )
}