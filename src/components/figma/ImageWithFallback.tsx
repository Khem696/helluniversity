'use client'

import Image from 'next/image'
import { useState } from 'react'

interface ImageWithFallbackProps {
  src: string
  alt: string
  className?: string
  width?: number
  height?: number
  priority?: boolean
  imgClassName?: string
  objectPosition?: string
}

export function ImageWithFallback({ 
  src, 
  alt, 
  className = '', 
  width, 
  height, 
  priority = false,
  imgClassName = '',
  objectPosition
}: ImageWithFallbackProps) {
  const [imgSrc, setImgSrc] = useState(src)
  const [isLoading, setIsLoading] = useState(true)

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
        </div>
      )}
      <Image
        src={imgSrc}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={`transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'} ${imgClassName}`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setImgSrc('/placeholder-image.jpg')
          setIsLoading(false)
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: objectPosition || 'center'
        }}
      />
    </div>
  )
}