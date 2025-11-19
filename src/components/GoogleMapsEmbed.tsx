"use client"

interface GoogleMapsEmbedProps {
  latitude: string
  longitude: string
  className?: string
  height?: string
}

export function GoogleMapsEmbed({ 
  latitude, 
  longitude, 
  className = "",
  height = "400px"
}: GoogleMapsEmbedProps) {
  // Google Maps embed URL using coordinates
  // Format: https://www.google.com/maps/embed/v1/place?key=API_KEY&q=lat,lng
  // For public embed without API key, use the standard embed format
  const embedUrl = `https://www.google.com/maps?q=${latitude},${longitude}&hl=en&z=14&output=embed`
  
  return (
    <div className={`w-full rounded-lg overflow-hidden ${className}`} style={{ height }}>
      <iframe
        src={embedUrl}
        width="100%"
        height="100%"
        style={{ border: 0 }}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Hell University Location - Mae Taeng, Chiang Mai, Thailand"
        aria-label="Interactive map showing Hell University location in Mae Taeng, Chiang Mai, Thailand"
      />
    </div>
  )
}

