"use client"

import React from "react"

interface SearchHighlightProps {
  text: string
  searchTerm: string
  className?: string
}

/**
 * Highlights matching text in search results
 * Case-insensitive matching with proper escaping
 */
export function SearchHighlight({ text, searchTerm, className = "" }: SearchHighlightProps) {
  if (!searchTerm || !text) {
    return <span className={className}>{text}</span>
  }

  // Escape special regex characters
  const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escapedSearch})`, "gi")
  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, index) => {
        // Check if this part matches the search term (case-insensitive)
        if (part.toLowerCase() === searchTerm.toLowerCase()) {
          return (
            <mark
              key={index}
              className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded"
            >
              {part}
            </mark>
          )
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </span>
  )
}

