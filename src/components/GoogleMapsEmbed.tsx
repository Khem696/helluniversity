"use client"

interface GoogleMapsEmbedProps {
  embedUrl?: string
  latitude?: string
  longitude?: string
  className?: string
  height?: string
}

export function GoogleMapsEmbed({ 
  embedUrl,
  latitude, 
  longitude, 
  className = "",
  height = "400px"
}: GoogleMapsEmbedProps) {
  // Use provided embedUrl if available, otherwise construct from coordinates
  const mapUrl = embedUrl || (latitude && longitude 
    ? `https://www.google.com/maps?q=${latitude},${longitude}&hl=en&z=14&output=embed`
    : "")
  
  return (
    <div 
      className={`w-full rounded-lg overflow-hidden ${className}`} 
      style={{ height }}
    >
      <iframe
        src={mapUrl}
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

