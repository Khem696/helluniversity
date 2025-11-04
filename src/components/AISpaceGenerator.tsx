"use client"

import { useState } from "react"
import { ALL_ALLOWED_IMAGES, HONGSEE_IMAGES, GALLERY_IMAGES } from "@/lib/aispaces"

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

  async function onGenerate() {
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {HONGSEE_IMAGES.concat(GALLERY_IMAGES).map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => toggleImage(url)}
            className={`px-2 py-1 rounded border text-sm ${selectedImages.includes(url) ? "bg-[#5B9AB8] text-white" : "bg-white text-black"}`}
            aria-pressed={selectedImages.includes(url)}
          >
            {url.split("/").slice(-2).join("/")}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the decoration style you want..."
        className="w-full min-h-[96px] p-2 border rounded"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading || selectedImages.length === 0 || prompt.trim().length === 0}
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {isLoading ? "Generating…" : "Generate"}
        </button>
        <span className="text-xs text-gray-500">
          {selectedImages.length} selected
        </span>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {results.map((url, idx) => (
            // Using plain img to keep this minimal and decoupled from UI libs
            <img key={`${url}-${idx}`} src={url} alt="AI generated" className="w-full h-auto rounded border" />
          ))}
        </div>
      )}
    </div>
  )
}


