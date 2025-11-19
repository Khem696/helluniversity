import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTursoClient } from '@/lib/turso'
import { withBasePath } from '@/lib/utils'
import { generateEventStructuredData, generateArticleStructuredData, EventForStructuredData } from '@/lib/structured-data'
import { EventDetailPage } from '@/components/EventDetailPage'

interface PageProps {
  params: Promise<{ id: string }>
}

async function getEvent(id: string) {
  const db = getTursoClient()
  
  const eventResult = await db.execute({
    sql: `
      SELECT 
        e.id, 
        e.title, 
        e.description, 
        e.image_id, 
        e.event_date,
        e.start_date, 
        e.end_date, 
        e.created_at, 
        e.updated_at,
        i.blob_url as image_url, 
        i.title as image_title
      FROM events e
      LEFT JOIN images i ON e.image_id = i.id
      WHERE e.id = ?
    `,
    args: [id],
  })
  
  if (eventResult.rows.length === 0) {
    return null
  }
  
  // Get in-event photos
  const inEventPhotos = await db.execute({
    sql: `
      SELECT 
        ei.id, ei.image_id, ei.display_order,
        i.blob_url, i.width, i.height, i.title
      FROM event_images ei
      JOIN images i ON ei.image_id = i.id
      WHERE ei.event_id = ? AND ei.image_type = 'in_event'
      ORDER BY ei.display_order ASC
    `,
    args: [id],
  })
  
  const event = eventResult.rows[0] as any
  
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    image_url: event.image_url,
    start_date: event.start_date,
    end_date: event.end_date,
    event_date: event.event_date,
    created_at: event.created_at,
    updated_at: event.updated_at,
    in_event_photos: inEventPhotos.rows.map((row: any) => ({
      blob_url: row.blob_url,
      title: row.title,
      width: row.width,
      height: row.height,
    })),
  }
}

async function getRelatedEvents(currentEventId: string, limit: number = 3) {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // Get other events (excluding current event) that are upcoming or recent
  const relatedEvents = await db.execute({
    sql: `
      SELECT 
        e.id, 
        e.title, 
        e.description, 
        e.start_date, 
        e.end_date, 
        e.event_date,
        i.blob_url as image_url
      FROM events e
      LEFT JOIN images i ON e.image_id = i.id
      WHERE e.id != ? 
        AND (e.start_date >= ? OR e.end_date >= ? OR e.event_date >= ?)
      ORDER BY COALESCE(e.start_date, e.event_date, e.end_date) ASC
      LIMIT ?
    `,
    args: [currentEventId, now - 86400, now - 86400, now - 86400, limit],
  })
  
  return relatedEvents.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    image_url: row.image_url,
    start_date: row.start_date,
    end_date: row.end_date,
    event_date: row.event_date,
  }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const event = await getEvent(id)
  
  if (!event) {
    return {
      title: 'Event Not Found',
    }
  }
  
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://www.huculturehub.com' 
      : 'http://localhost:3000')
  
  const eventDate = event.start_date || event.event_date || event.end_date
  const formattedDate = eventDate 
    ? new Date((eventDate as number) * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''
  
  const description = event.description 
    ? `${event.description.substring(0, 150)}${event.description.length > 150 ? '...' : ''}`
    : `Join us at Hell University for ${event.title}${formattedDate ? ` on ${formattedDate}` : ''}.`
  
  const imageUrl = event.image_url || withBasePath('/og-image.jpg')
  
  // Format dates for Open Graph
  const publishedTime = event.created_at ? new Date((event.created_at as number) * 1000).toISOString() : undefined
  const modifiedTime = event.updated_at ? new Date((event.updated_at as number) * 1000).toISOString() : publishedTime
  
  return {
    title: `${event.title} | Hell University`,
    description,
    keywords: [
      'cultural events',
      'art events',
      'creative workshops',
      'Hell University',
      event.title,
    ],
    openGraph: {
      title: `${event.title} | Hell University`,
      description,
      url: `${baseUrl}/events/${id}`,
      siteName: 'Hell University',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: event.title,
        },
      ],
      type: 'article',
      locale: 'en_US',
      publishedTime,
      modifiedTime,
      authors: ['Hell University'],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${event.title} | Hell University`,
      description,
      images: [imageUrl],
      creator: '@huculturehub',
    },
    alternates: {
      canonical: `${baseUrl}/events/${id}`,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-video-preview': -1,
      },
    },
  }
}

export default async function EventPage({ params }: PageProps) {
  const { id } = await params
  const event = await getEvent(id)

  if (!event) {
    notFound()
  }

  // Get related events
  const relatedEvents = await getRelatedEvents(id, 3)

  // Generate both Event and Article structured data for better SEO and social sharing
  const eventStructuredData = generateEventStructuredData(event as EventForStructuredData)
  const articleStructuredData = generateArticleStructuredData(event as EventForStructuredData)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(eventStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData),
        }}
      />
      <EventDetailPage event={event} relatedEvents={relatedEvents} />
    </>
  )
}

