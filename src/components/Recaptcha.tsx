"use client"

import ReCAPTCHA from "react-google-recaptcha"
import { useEffect, useState, useRef } from "react"

interface RecaptchaProps {
  onVerify: (token: string) => void
  onError?: () => void
  onExpire?: () => void
  size?: "normal" | "compact"
}

export function Recaptcha({ 
  onVerify, 
  onError, 
  onExpire, 
  size = "normal"
}: RecaptchaProps) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  const [mounted, setMounted] = useState(false)
  const recaptchaRef = useRef<ReCAPTCHA>(null)
  const hasVerifiedRef = useRef(false) // Track if we've ever received a valid token

  // Delay loading reCAPTCHA until component is mounted
  useEffect(() => {
    setMounted(true)
    
    // Add global styles to ensure reCAPTCHA challenge popup works correctly
    const styleId = 'recaptcha-fix-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        /* Ensure reCAPTCHA challenge popup is clickable */
        .grecaptcha-badge,
        iframe[src*="recaptcha"],
        iframe[title*="recaptcha"] {
          z-index: 9999 !important;
          pointer-events: auto !important;
        }
        
        /* Fix for reCAPTCHA challenge popup container */
        body > div[style*="position: fixed"][style*="z-index"] {
          z-index: 9999 !important;
        }
        
        /* Ensure reCAPTCHA widget container allows interactions */
        .g-recaptcha {
          position: relative !important;
          z-index: 1000 !important;
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  if (!siteKey) {
    console.warn("NEXT_PUBLIC_RECAPTCHA_SITE_KEY is not set. reCAPTCHA will not work.")
    return (
      <div className="p-4 border border-yellow-500 rounded bg-yellow-50 text-yellow-800 text-sm">
        reCAPTCHA configuration missing. Please set NEXT_PUBLIC_RECAPTCHA_SITE_KEY in your environment variables.
      </div>
    )
  }

  // Don't render reCAPTCHA until mounted to prevent preload warnings
  if (!mounted) {
    return (
      <div className="flex justify-center items-center" style={{ minHeight: '65px' }}>
        <div className="text-sm text-gray-500">Loading verification...</div>
      </div>
    )
  }

  const handleChange = (token: string | null) => {
    if (token) {
      // Mark that we've verified at least once
      hasVerifiedRef.current = true
      onVerify(token)
    } else {
      // Only call onExpire if we've previously verified (token actually expired)
      // Don't call onExpire on initial null state or when widget resets
      if (hasVerifiedRef.current && onExpire) {
        onExpire()
        // Reset the flag so we don't call onExpire again until next verification
        hasVerifiedRef.current = false
      }
    }
  }

  const handleError = () => {
    if (onError) {
      onError()
    }
  }

  const handleExpired = () => {
    // Only call onExpire if we've previously verified (token actually expired)
    if (hasVerifiedRef.current && onExpire) {
      onExpire()
      hasVerifiedRef.current = false
    }
  }

  return (
    <div 
      className="flex justify-center"
      style={{
        position: 'relative',
        zIndex: 1000,
        pointerEvents: 'auto',
        isolation: 'isolate' // Creates a new stacking context
      }}
    >
      <div
        style={{
          position: 'relative',
          zIndex: 1000,
          pointerEvents: 'auto',
          transform: 'none' // Ensure no transforms interfere
        }}
      >
        <ReCAPTCHA
          ref={recaptchaRef}
          sitekey={siteKey}
          onChange={handleChange}
          onErrored={handleError}
          onExpired={handleExpired}
          size={size}
          theme="light"
        />
      </div>
    </div>
  )
}

