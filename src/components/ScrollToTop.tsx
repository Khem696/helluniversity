'use client'

import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { ArrowUp } from 'lucide-react'

export function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 300) {
        setIsVisible(true)
      } else {
        setIsVisible(false)
      }
    }

    window.addEventListener('scroll', toggleVisibility)

    return () => {
      window.removeEventListener('scroll', toggleVisibility)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  if (!isVisible) {
    return null
  }

  return (
    <Button
      onClick={scrollToTop}
      className="fixed bottom-20 right-6 z-40 bg-[#7ba3a3] hover:bg-[#6b8b8b] text-[#faf8f5] rounded-full shadow-lg hover:shadow-xl transition-all duration-300"
      size="sm"
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  )
}
