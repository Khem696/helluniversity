"use client"

import React, { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { X, History, Clock } from "lucide-react"
import { useSearchHistory } from "@/hooks/useSearchHistory"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface SearchInputWithHistoryProps {
  value: string
  onChange: (value: string) => void
  onSearch?: (value: string) => void // Called when Enter is pressed or search is confirmed
  debouncedOnSearch?: (value: string) => void // Called after debounce delay when typing (for auto-search)
  placeholder?: string
  storageKey: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  className?: string
  debounceMs?: number // Debounce delay in milliseconds (default: 500)
}

export function SearchInputWithHistory({
  value,
  onChange,
  onSearch,
  debouncedOnSearch,
  placeholder = "Search...",
  storageKey,
  onKeyDown,
  className = "",
  debounceMs = 500,
}: SearchInputWithHistoryProps) {
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const { history, addToHistory, removeFromHistory } = useSearchHistory({
    storageKey,
    maxHistory: 10,
  })

  // Debounced search - triggers automatically while typing
  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // If debouncedOnSearch is provided, set up debounced call
    if (debouncedOnSearch) {
      debounceTimerRef.current = setTimeout(() => {
        const trimmedValue = value.trim()
        console.log('[SearchInputWithHistory] Debounced search triggered:', trimmedValue)
        debouncedOnSearch(trimmedValue)
      }, debounceMs)
    }

    // Cleanup on unmount or value change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [value, debouncedOnSearch, debounceMs])

  // Add to history when search is performed (user presses Enter or search is applied)
  const handleSearch = () => {
    // Clear any pending debounced search
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    const trimmedValue = value.trim()
    console.log('[SearchInputWithHistory] handleSearch called (Enter key):', { value, trimmedValue, hasOnSearch: !!onSearch })
    
    if (trimmedValue) {
      addToHistory(trimmedValue)
      setShowHistory(false)
    } else {
      setShowHistory(false)
    }

    // Call onSearch callback to trigger search immediately (Enter key)
    if (onSearch) {
      console.log('[SearchInputWithHistory] Calling onSearch with:', trimmedValue)
      onSearch(trimmedValue)
    } else {
      console.warn('[SearchInputWithHistory] onSearch callback not provided!')
    }
  }

  // Handle Enter key - prevent form submission and trigger search
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      console.log('[SearchInputWithHistory] Enter key pressed')
      e.preventDefault()
      e.stopPropagation()
      handleSearch()
      if (onKeyDown) {
        onKeyDown(e)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      setShowHistory(false)
    } else if (e.key === "ArrowDown" && showHistory && history.length > 0) {
      e.preventDefault()
      // Focus first history item
      const firstItem = document.getElementById(`${storageKey}-history-0`)
      if (firstItem) {
        firstItem.focus()
      }
    }
  }

  // Show history when input is focused and has history
  const handleFocus = () => {
    if (history.length > 0) {
      setShowHistory(true)
    }
  }

  const handleBlur = (e: React.FocusEvent) => {
    // Delay to allow clicking on history items
    setTimeout(() => {
      if (!inputRef.current?.contains(e.relatedTarget as Node)) {
        setShowHistory(false)
      }
    }, 200)
  }

  const selectHistoryItem = (item: string) => {
    onChange(item)
    setShowHistory(false)
    inputRef.current?.focus()
  }

  const filteredHistory = history.filter((item) =>
    item.toLowerCase().includes(value.toLowerCase())
  )

  return (
    <div className="relative w-full">
      <div className="relative">
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={`pr-8 ${className}`}
          type="text"
          autoComplete="off"
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-gray-100"
            onClick={() => {
              onChange("")
              inputRef.current?.focus()
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Search History Dropdown */}
      {showHistory && filteredHistory.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          <div className="p-2 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <History className="h-3 w-3" />
              <span>Recent Searches</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                // Clear history logic would go here if needed
                setShowHistory(false)
              }}
            >
              Clear
            </Button>
          </div>
          <div className="py-1">
            {filteredHistory.map((item, index) => (
              <div
                key={index}
                id={`${storageKey}-history-${index}`}
                role="button"
                tabIndex={0}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between group cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded"
                onClick={() => selectHistoryItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    selectHistoryItem(item)
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault()
                    const nextItem = document.getElementById(
                      `${storageKey}-history-${index + 1}`
                    )
                    if (nextItem) {
                      nextItem.focus()
                    }
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    if (index === 0) {
                      inputRef.current?.focus()
                    } else {
                      const prevItem = document.getElementById(
                        `${storageKey}-history-${index - 1}`
                      )
                      if (prevItem) {
                        prevItem.focus()
                      }
                    }
                  } else if (e.key === "Escape") {
                    setShowHistory(false)
                    inputRef.current?.focus()
                  }
                }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Clock className="h-3 w-3 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{item}</span>
                </div>
                <button
                  type="button"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFromHistory(item)
                  }}
                  aria-label={`Remove ${item} from history`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

