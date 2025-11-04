"use client"

import { Turnstile as ReactTurnstile } from "@marsidev/react-turnstile"

interface TurnstileProps {
  onVerify: (token: string) => void
  onError?: () => void
  onExpire?: () => void
  size?: "normal" | "compact"
}

export function Turnstile({ onVerify, onError, onExpire, size = "normal" }: TurnstileProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  if (!siteKey) {
    console.warn("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set. Turnstile will not work.")
    return (
      <div className="p-4 border border-yellow-500 rounded bg-yellow-50 text-yellow-800 text-sm">
        Turnstile configuration missing. Please set NEXT_PUBLIC_TURNSTILE_SITE_KEY in your environment variables.
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
        }}
      />
    </div>
  )
}

