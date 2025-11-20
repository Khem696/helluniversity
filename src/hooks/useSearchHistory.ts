"use client"

import { useState, useEffect, useCallback } from "react"

interface UseSearchHistoryOptions {
  storageKey: string
  maxHistory?: number
}

interface UseSearchHistoryReturn {
  history: string[]
  addToHistory: (search: string) => void
  clearHistory: () => void
  removeFromHistory: (search: string) => void
}

/**
 * Hook for managing search history in localStorage
 */
export function useSearchHistory({
  storageKey,
  maxHistory = 10,
}: UseSearchHistoryOptions): UseSearchHistoryReturn {
  const [history, setHistory] = useState<string[]>([])

  // Load history from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setHistory(parsed)
        }
      }
    } catch (error) {
      console.error("Failed to load search history:", error)
    }
  }, [storageKey])

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      localStorage.setItem(storageKey, JSON.stringify(history))
    } catch (error) {
      console.error("Failed to save search history:", error)
    }
  }, [history, storageKey])

  const addToHistory = useCallback(
    (search: string) => {
      if (!search || !search.trim()) return

      const trimmed = search.trim()
      setHistory((prev) => {
        // Remove if already exists
        const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
        // Add to beginning and limit to maxHistory
        return [trimmed, ...filtered].slice(0, maxHistory)
      })
    },
    [maxHistory]
  )

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  const removeFromHistory = useCallback((search: string) => {
    setHistory((prev) => prev.filter((item) => item.toLowerCase() !== search.toLowerCase()))
  }, [])

  return {
    history,
    addToHistory,
    clearHistory,
    removeFromHistory,
  }
}

