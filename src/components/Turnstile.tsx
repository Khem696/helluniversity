"use client"

import { Turnstile as ReactTurnstile } from "@marsidev/react-turnstile"
import { useEffect, useState } from "react"

interface TurnstileProps {
  onVerify: (token: string) => void
  onError?: () => void
  onExpire?: () => void
  size?: "normal" | "compact"
}

export function Turnstile({ onVerify, onError, onExpire, size = "normal" }: TurnstileProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const [mounted, setMounted] = useState(false)

  // Delay loading Turnstile until component is mounted to avoid unnecessary preloads
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!siteKey) {
    console.warn("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set. Turnstile will not work.")
    return (
      <div className="p-4 border border-yellow-500 rounded bg-yellow-50 text-yellow-800 text-sm">
        Turnstile configuration missing. Please set NEXT_PUBLIC_TURNSTILE_SITE_KEY in your environment variables.
      </div>
    )
  }

  // Don't render Turnstile until mounted to prevent preload warnings
  if (!mounted) {
    return (
      <div className="flex justify-center items-center" style={{ minHeight: '65px' }}>
        <div className="text-sm text-gray-500">Loading verification...</div>
      </div>
    )
  }

  return (
    <div className="flex justify-center">
      <ReactTurnstile
        siteKey={siteKey}
        onSuccess={onVerify}
        onError={onError}
        onExpire={onExpire}
        options={{
          size,
          theme: "light",
          mode: "interactive", // Force interactive mode - always requires user interaction
        }}
      />
    </div>
  )
}

