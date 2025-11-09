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

  // Delay loading reCAPTCHA until component is mounted
  useEffect(() => {
    setMounted(true)
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
      onVerify(token)
    } else {
      // Token expired or user closed the challenge
      if (onExpire) {
        onExpire()
      }
    }
  }

  const handleError = () => {
    if (onError) {
      onError()
    }
  }

  const handleExpired = () => {
    if (onExpire) {
      onExpire()
    }
  }

  return (
    <div className="flex justify-center">
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
  )
}

