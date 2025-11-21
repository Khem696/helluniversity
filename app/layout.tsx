import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/react'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Toaster } from '@/components/ui/sonner'
import { Header } from '@/components/Header'
import { DisableServiceWorker } from '@/components/DisableServiceWorker'
import { GlobalErrorHandler } from '@/components/GlobalErrorHandler'
import { OverlayScrollbar } from '@/components/OverlayScrollbar'
import { organizationStructuredData, websiteStructuredData, localBusinessStructuredData, eventStructuredData, generateServiceStructuredData } from '@/lib/structured-data'
import './globals.css'
import { bodyFont, headingFont, uiFont, comfortaaFont, urbanistFont, acuminAlt } from '@/lib/fonts'
import { withBasePath } from '@/lib/utils'
import { ConditionalHeaderWrapper } from '@/components/ConditionalHeaderWrapper'
import { Providers } from '@/components/Providers'


export const metadata: Metadata = {
  title: {
    default: 'Hell University - A Cultural Hub in Mae Taeng, Chiang Mai, Thailand',
    template: '%s | Hell University'
  },
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
    'creative expression',
    'art community',
    'cultural activities',
    'artistic community',
    'creative space',
    'studio gallery',
    'cultural engagement',
    'art workshops',
    'creative events',
    'venue booking',
    'event arrangement',
  ],
  authors: [{ name: 'Hell University' }],
  creator: 'Hell University',
  publisher: 'Hell University',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NODE_ENV === 'production' ? 'https://www.huculturehub.com' : 'http://localhost:3000'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NODE_ENV === 'production' ? 'https://www.huculturehub.com' : 'http://localhost:3000',
    title: 'Hell University - A Cultural Hub in Mae Taeng, Chiang Mai, Thailand',
    description: 'Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings in Northern Thailand.',
    siteName: 'Hell University',
    images: [
      {
        url: withBasePath('/og-image.jpg'),
        width: 1200,
        height: 630,
        alt: 'Hell University - Cultural Hub in Mae Taeng, Chiang Mai, Thailand',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hell University - A Cultural Hub in Mae Taeng, Chiang Mai, Thailand',
    description: 'Book event spaces, arrange cultural activities, and host creative workshops. Perfect venue for booking events, activities, and cultural gatherings in Northern Thailand.',
    images: [withBasePath('/og-image.jpg')],
    creator: '@huculturehub',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable} ${uiFont.variable} ${comfortaaFont.variable} ${urbanistFont.variable} ${acuminAlt.variable}`} suppressHydrationWarning>
      <head>
        {/* Resource Hints for Performance - Improve loading speed */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        
        {/* Note: Next.js automatically handles font preloading via next/font/google */}
        
        <link rel="icon" href={withBasePath('/assets/icons/icon_helluniversity.svg')} />
        <link rel="apple-touch-icon" sizes="180x180" href={withBasePath('/assets/icons/icon_helluniversity.svg')} />
        <link rel="manifest" href={withBasePath('/site.webmanifest')} />
        <meta name="theme-color" content="#7ba3a3" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        
        {/* Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationStructuredData),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteStructuredData),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(localBusinessStructuredData),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(eventStructuredData),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(generateServiceStructuredData()),
          }}
        />
      </head>
      <body className="font-body">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] bg-black text-white px-4 py-2 rounded"
        >
          Skip to content
        </a>
        <Providers>
          <GlobalErrorHandler />
          <DisableServiceWorker />
          <OverlayScrollbar />
          <ConditionalHeaderWrapper />
          {children}
          <Toaster />
        </Providers>
        {process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === '1' && <Analytics />}
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID || ''} />
      </body>
    </html>
  )
}