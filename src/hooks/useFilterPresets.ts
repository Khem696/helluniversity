"use client"

import { useState, useEffect, useCallback } from "react"

export interface FilterPreset {
  id: string
  name: string
  filters: Record<string, any>
  createdAt: number
}

interface UseFilterPresetsOptions {
  storageKey: string
  maxPresets?: number
}

interface UseFilterPresetsReturn {
  presets: FilterPreset[]
  savePreset: (name: string, filters: Record<string, any>) => void
  deletePreset: (id: string) => void
  updatePreset: (id: string, name: string, filters: Record<string, any>) => void
  loadPreset: (id: string) => FilterPreset | undefined
}

/**
 * Hook for managing saved filter presets in localStorage
 */
export function useFilterPresets({
  storageKey,
  maxPresets = 10,
}: UseFilterPresetsOptions): UseFilterPresetsReturn {
  const [presets, setPresets] = useState<FilterPreset[]>([])

  // Load presets from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setPresets(parsed)
        }
      }
    } catch (error) {
      console.error("Failed to load filter presets:", error)
    }
  }, [storageKey])

  // Save presets to localStorage whenever they change
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      localStorage.setItem(storageKey, JSON.stringify(presets))
    } catch (error) {
      console.error("Failed to save filter presets:", error)
    }
  }, [presets, storageKey])

  const savePreset = useCallback(
    (name: string, filters: Record<string, any>) => {
      if (!name || !name.trim()) return

      const newPreset: FilterPreset = {
        id: crypto.randomUUID(),
        name: name.trim(),
        filters: { ...filters },
        createdAt: Date.now(),
      }

      setPresets((prev) => {
        // Limit to maxPresets
        const updated = [newPreset, ...prev].slice(0, maxPresets)
        return updated
      })
    },
    [maxPresets]
  )

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((preset) => preset.id !== id))
  }, [])

  const updatePreset = useCallback(
    (id: string, name: string, filters: Record<string, any>) => {
      setPresets((prev) =>
        prev.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                name: name.trim(),
                filters: { ...filters },
              }
            : preset
        )
      )
    },
    []
  )

  const loadPreset = useCallback(
    (id: string) => {
      return presets.find((preset) => preset.id === id)
    },
    [presets]
  )

  return {
    presets,
    savePreset,
    deletePreset,
    updatePreset,
    loadPreset,
  }
}

