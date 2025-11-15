"use client"

import { InitDatabaseButton } from "./InitDatabaseButton"
import { MigrateImagesButton } from "./MigrateImagesButton"
import { useDevMode } from "./DevModeToggle"

/**
 * Client component that conditionally renders dev tools based on dev mode
 */
export function DevToolsSection() {
  const devModeEnabled = useDevMode()

  if (!devModeEnabled) {
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
      <InitDatabaseButton />
      <MigrateImagesButton />
    </div>
  )
}

