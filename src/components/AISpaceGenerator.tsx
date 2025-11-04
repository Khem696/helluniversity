"use client"

import { useState } from "react"
import { ALL_ALLOWED_IMAGES, HONGSEE_IMAGES, GALLERY_IMAGES } from "@/lib/aispaces"
import { Turnstile } from "./Turnstile"

export async function generateAIImages(selectedImages: string[], prompt: string): Promise<string[]> {
  const placeholder = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&auto=format&fit=crop"
  if (selectedImages.length === 0 || prompt.trim().length === 0) return []
  return selectedImages.map(() => placeholder)
}

export function AISpaceGenerator() {
  const [prompt, setPrompt] = useState("")
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState<string>("")
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [isTurnstileVerified, setIsTurnstileVerified] = useState(false)

  function handleTurnstileVerify(token: string) {
    setTurnstileToken(token)
    setIsTurnstileVerified(true)
  }

  function handleTurnstileError() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
    setError("CAPTCHA verification failed. Please try again.")
  }

  function handleTurnstileExpire() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
  }

  async function onGenerate() {
    if (!isTurnstileVerified || !turnstileToken) {
      setError("Please complete the CAPTCHA verification first.")
      return
    }

    setError("")
    setIsLoading(true)
    try {
      const images = await generateAIImages(selectedImages, prompt)
      setResults(images)
    } catch (e) {
      setResults([])
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setIsLoading(false)
    }
  }

  function toggleImage(url: string) {
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Turnstile CAPTCHA - Must be verified before using the form */}
      <div className="space-y-2 sm:space-y-3">
        <p className="text-xs sm:text-sm text-[#5a3a2a]/70 font-comfortaa">
          Please verify you're human before proceeding:
        </p>
        <Turnstile
          onVerify={handleTurnstileVerify}
          onError={handleTurnstileError}
          onExpire={handleTurnstileExpire}
          size="normal"
        />
        {!isTurnstileVerified && (
          <p className="text-xs text-[#5a3a2a]/60 font-comfortaa italic">
            Complete verification to enable form fields
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {HONGSEE_IMAGES.concat(GALLERY_IMAGES).map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => toggleImage(url)}
            disabled={!isTurnstileVerified}
            className={`px-2 py-1 rounded border text-xs sm:text-sm transition-opacity ${
              selectedImages.includes(url) ? "bg-[#5B9AB8] text-white" : "bg-white text-black"
            } ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`}
            aria-pressed={selectedImages.includes(url)}
            aria-disabled={!isTurnstileVerified}
          >
            {url.split("/").slice(-2).join("/")}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={isTurnstileVerified ? "Describe the decoration style you want..." : "Please complete CAPTCHA verification first..."}
        disabled={!isTurnstileVerified}
        className={`w-full min-h-[80px] sm:min-h-[96px] p-2 sm:p-3 text-sm sm:text-base border rounded ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
      />

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading || selectedImages.length === 0 || prompt.trim().length === 0 || !isTurnstileVerified}
          className="px-3 sm:px-4 py-2 sm:py-2.5 rounded bg-black text-white text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Generating…" : "Generate"}
        </button>
        <span className="text-xs sm:text-sm text-gray-500">
          {selectedImages.length} selected
        </span>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 mt-2">
          {results.map((url, idx) => (
            // Using plain img to keep this minimal and decoupled from UI libs
            <img key={`${url}-${idx}`} src={url} alt="AI generated" className="w-full h-auto rounded border" />
          ))}
        </div>
      )}
    </div>
  )
}


