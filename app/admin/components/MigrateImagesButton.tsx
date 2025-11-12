"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Upload, CheckCircle2, XCircle, AlertCircle, Eye, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function MigrateImagesButton() {
  const [mounted, setMounted] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
  const [isCleaningUp, setIsCleaningUp] = useState(false)
  const [forceRemigrate, setForceRemigrate] = useState(false)
  const [dryRunDialogOpen, setDryRunDialogOpen] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<{
    type: "idle" | "success" | "error" | "checking" | "dryrun"
    message?: string
    stats?: {
      total: number
      migrated?: number
      skipped?: number
      failed?: number
      byCategory?: Record<string, number>
    }
    errors?: string[]
    dryRunResults?: {
      images: Array<{ path: string; category: string | null; filename: string }>
      stats: { total: number; byCategory: Record<string, number> }
    }
  }>({ type: "idle" })

  // Ensure component is mounted (client-side only)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-select all categories when dry run completes
  useEffect(() => {
    if (status.dryRunResults?.stats?.byCategory) {
      const allCategories = Object.keys(status.dryRunResults.stats.byCategory)
      setSelectedCategories(new Set(allCategories))
    }
  }, [status.dryRunResults])

  const checkStatus = async () => {
    setIsChecking(true)
    setStatus({ type: "checking" })
    try {
      const response = await fetch("/api/admin/migrate-images")
      
      // Check if response is ok
      if (!response.ok) {
        // If unauthorized, redirect to login
        if (response.status === 401 || response.status === 403) {
          setStatus({
            type: "error",
            message: "Authentication required. Please log in again.",
          })
          // Redirect to login after a short delay
          setTimeout(() => {
            window.location.href = "/admin/login"
          }, 2000)
          return
        }
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseData = await response.json()

      if (responseData.success && responseData.data) {
        const stats = responseData.data.stats || {}
        setStatus({
          type: "success",
          message: `Total images in database: ${stats.total || 0}`,
          stats: stats,
        })
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to check status"
        setStatus({ type: "error", message: errorMessage })
      }
    } catch (error) {
      // Handle network errors and authentication errors
      const errorMessage = error instanceof Error ? error.message : "Failed to check migration status"
      
      // Check if it's an authentication error
      if (errorMessage.includes("auth") || errorMessage.includes("session") || errorMessage.includes("Unauthorized")) {
        setStatus({
          type: "error",
          message: "Authentication error. Please refresh the page and log in again.",
        })
        setTimeout(() => {
          window.location.href = "/admin/login"
        }, 2000)
      } else {
        setStatus({
          type: "error",
          message: errorMessage,
        })
      }
    } finally {
      setIsChecking(false)
    }
  }

  const runDryRun = async () => {
    setIsDryRunning(true)
    setStatus({ type: "dryrun" })
    try {
      const response = await fetch("/api/admin/migrate-images?dryRun=true", {
        method: "POST",
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseData = await response.json()

      if (responseData.success && responseData.data) {
        const dryRunData = responseData.data
        setStatus({
          type: "dryrun",
          message: dryRunData.message || "Dry run completed",
          dryRunResults: {
            images: Array.isArray(dryRunData.images) ? dryRunData.images : [],
            stats: dryRunData.stats || { total: 0, byCategory: {} },
          },
        })
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to run dry run"
        setStatus({ type: "error", message: errorMessage })
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to run dry run",
      })
    } finally {
      setIsDryRunning(false)
    }
  }

  const cleanupOrphaned = async () => {
    if (!confirm("This will delete database records where blob files are missing. Continue?")) {
      return
    }

    setIsCleaningUp(true)
    setStatus({ type: "idle" })

    try {
      const response = await fetch("/api/admin/cleanup-orphaned-images", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const responseData = await response.json()

      if (responseData.success && responseData.data) {
        const cleanupData = responseData.data
        setStatus({
          type: "success",
          message: cleanupData.message || "Cleanup completed",
          stats: cleanupData.stats,
          errors: cleanupData.errors,
        })
        // Refresh status after cleanup
        setTimeout(() => checkStatus(), 1000)
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to cleanup orphaned images"
        setStatus({
          type: "error",
          message: errorMessage,
        })
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to cleanup orphaned images",
      })
    } finally {
      setIsCleaningUp(false)
    }
  }

  const startMigration = async () => {
    // Check if categories are selected
    if (selectedCategories.size === 0) {
      alert("Please select at least one category to migrate.")
      return
    }

    const categoriesList = Array.from(selectedCategories).join(", ")
    const forceMsg = forceRemigrate ? "\n\n⚠️ Force Re-migrate is enabled. This will re-upload images even if they exist in the database." : ""
    if (
      !confirm(
        `Are you sure you want to migrate images from the following categories to Vercel Blob?${forceMsg}\n\n${categoriesList}\n\nThis may take several minutes.`
      )
    ) {
      return
    }

    setIsMigrating(true)
    setStatus({ type: "idle" })

    try {
      // Build URL with selected categories and force remigrate flag
      const categoriesParam = Array.from(selectedCategories).join(",")
      const forceParam = forceRemigrate ? "&forceRemigrate=true" : ""
      const response = await fetch(`/api/admin/migrate-images?categories=${encodeURIComponent(categoriesParam)}${forceParam}`, {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const responseData = await response.json()

      if (responseData.success && responseData.data) {
        const migrationData = responseData.data
        setStatus({
          type: "success",
          message: migrationData.message || "Migration completed",
          stats: migrationData.stats,
          errors: migrationData.errors,
        })
        // Refresh status after migration
        setTimeout(() => checkStatus(), 1000)
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to migrate images"
        setStatus({
          type: "error",
          message: errorMessage,
        })
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to migrate images",
      })
    } finally {
      setIsMigrating(false)
    }
  }

  const toggleCategory = (category: string) => {
    const newSelected = new Set(selectedCategories)
    if (newSelected.has(category)) {
      newSelected.delete(category)
    } else {
      newSelected.add(category)
    }
    setSelectedCategories(newSelected)
  }

  const selectAllCategories = () => {
    if (status.dryRunResults?.stats?.byCategory) {
      setSelectedCategories(new Set(Object.keys(status.dryRunResults.stats.byCategory)))
    }
  }

  const deselectAllCategories = () => {
    setSelectedCategories(new Set())
  }

  return (
    <div className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
          <Upload className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">Image Migration</h3>
          <p className="text-sm text-gray-600">Migrate static images to Vercel Blob</p>
        </div>
      </div>

      {/* Status Display */}
      {status.type !== "idle" && (
        <div
          className={`mb-4 p-3 rounded-lg ${
            status.type === "success"
              ? "bg-green-50 border border-green-200"
              : status.type === "error"
              ? "bg-red-50 border border-red-200"
              : status.type === "dryrun"
              ? "bg-blue-50 border border-blue-200"
              : "bg-gray-50 border border-gray-200"
          }`}
        >
          <div className="flex items-start gap-2">
            {status.type === "success" && <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />}
            {status.type === "error" && <XCircle className="w-5 h-5 text-red-600 mt-0.5" />}
            {(status.type === "checking" || (status.type === "dryrun" && isDryRunning)) && (
              <Loader2 className="w-5 h-5 text-blue-600 mt-0.5 animate-spin" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  status.type === "success"
                    ? "text-green-800"
                    : status.type === "error"
                    ? "text-red-800"
                    : "text-blue-800"
                }`}
              >
                {status.message}
              </p>

              {/* Stats Display */}
              {status.stats && (
                <div className="mt-2 text-xs text-gray-600 space-y-1">
                  {status.stats.total !== undefined && (
                    <p>Total: {status.stats.total}</p>
                  )}
                  {status.stats.migrated !== undefined && (
                    <p className="text-green-700">Migrated: {status.stats.migrated}</p>
                  )}
                  {status.stats.skipped !== undefined && (
                    <p className="text-yellow-700">Skipped: {status.stats.skipped}</p>
                  )}
                  {status.stats.failed !== undefined && (
                    <p className="text-red-700">Failed: {status.stats.failed}</p>
                  )}
                  {status.stats.byCategory && (
                    <div className="mt-2">
                      <p className="font-semibold">By Category:</p>
                      {Object.entries(status.stats.byCategory).map(([cat, count]) => (
                        <p key={cat} className="ml-2">
                          {cat}: {count}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Selected Categories Display */}
              {status.type === "dryrun" && selectedCategories.size > 0 && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                  <p className="font-semibold text-blue-900 mb-1">
                    Selected Categories ({selectedCategories.size}):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedCategories).map((cat) => (
                      <span
                        key={cat}
                        className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded"
                      >
                        {cat || "uncategorized"}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Dry Run Results */}
              {status.dryRunResults && status.dryRunResults.images && Array.isArray(status.dryRunResults.images) && (
                <div className="mt-2 text-xs text-gray-600">
                  <p className="font-semibold mb-1">Images to migrate:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {status.dryRunResults.images.slice(0, 20).map((img, idx) => (
                      <p key={idx} className="ml-2 truncate">
                        {img.path} {img.category ? `(${img.category})` : ""}
                      </p>
                    ))}
                    {status.dryRunResults.images.length > 20 && (
                      <p className="ml-2 text-gray-500">
                        ... and {status.dryRunResults.images.length - 20} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Errors */}
              {status.errors && Array.isArray(status.errors) && status.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-600">
                  <p className="font-semibold">Errors:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {status.errors.slice(0, 10).map((error, idx) => (
                      <p key={idx} className="ml-2">{error}</p>
                    ))}
                    {status.errors.length > 10 && (
                      <p className="ml-2 text-gray-500">... and {status.errors.length - 10} more errors</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          onClick={checkStatus}
          variant="outline"
          size="sm"
          disabled={isMigrating || isChecking || isDryRunning}
          className="flex-1 min-w-[120px]"
        >
          {isChecking ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 mr-2" />
              Check Status
            </>
          )}
        </Button>

        {mounted && (
          <Dialog open={dryRunDialogOpen} onOpenChange={setDryRunDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isMigrating || isChecking || isDryRunning}
                className="flex-1 min-w-[120px]"
              >
                <Eye className="w-4 h-4 mr-2" />
                Dry Run
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Dry Run - Preview Migration</DialogTitle>
              <DialogDescription>
                This will scan for images without actually migrating them. After scanning, select which categories to migrate.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Button
                onClick={runDryRun}
                disabled={isDryRunning}
                className="w-full"
              >
                {isDryRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Run Dry Run
                  </>
                )}
              </Button>
              {status.dryRunResults && status.dryRunResults.stats && (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-semibold text-blue-900 mb-2">
                      Found {status.dryRunResults.stats.total || 0} images to migrate
                    </p>
                    {status.dryRunResults.stats.byCategory && Object.entries(status.dryRunResults.stats.byCategory).length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={selectAllCategories}
                            className="text-xs"
                          >
                            Select All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={deselectAllCategories}
                            className="text-xs"
                          >
                            Deselect All
                          </Button>
                        </div>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {Object.entries(status.dryRunResults.stats.byCategory).map(([cat, count]) => (
                            <div key={cat} className="flex items-center gap-3 p-2 hover:bg-blue-100 rounded">
                              <Checkbox
                                checked={selectedCategories.has(cat)}
                                onCheckedChange={() => toggleCategory(cat)}
                                id={`category-${cat}`}
                              />
                              <label
                                htmlFor={`category-${cat}`}
                                className="flex-1 text-sm cursor-pointer flex items-center justify-between"
                              >
                                <span className="font-medium">{cat || "uncategorized"}</span>
                                <span className="text-gray-600">({count} images)</span>
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="pt-2 border-t border-blue-200">
                          <p className="text-xs text-blue-700">
                            Selected: {selectedCategories.size} of {Object.keys(status.dryRunResults.stats.byCategory).length} categories
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No images found in categories</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
        )}

        <Button
          onClick={startMigration}
          disabled={isMigrating || isChecking || isDryRunning || isCleaningUp || selectedCategories.size === 0}
          size="sm"
          className="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700"
          title={selectedCategories.size === 0 ? "Please run dry run and select categories first" : ""}
        >
          {isMigrating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Migrating...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Migrate {selectedCategories.size > 0 && `(${selectedCategories.size})`}
            </>
          )}
        </Button>

        <Button
          onClick={cleanupOrphaned}
          disabled={isMigrating || isChecking || isDryRunning || isCleaningUp}
          variant="outline"
          size="sm"
          className="flex-1 min-w-[120px] text-red-600 border-red-300 hover:bg-red-50"
          title="Remove database records where blob files are missing"
        >
          {isCleaningUp ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Cleaning...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4 mr-2" />
              Cleanup Orphaned
            </>
          )}
        </Button>
      </div>

      {/* Force Re-migrate Option */}
      {selectedCategories.size > 0 && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={forceRemigrate}
              onCheckedChange={(checked) => setForceRemigrate(checked === true)}
              id="force-remigrate"
            />
            <label
              htmlFor="force-remigrate"
              className="text-sm cursor-pointer flex items-center gap-2"
            >
              <span className="font-medium text-yellow-900">Force Re-migrate</span>
              <span className="text-yellow-700 text-xs">
                (Re-upload images even if database records exist. Use when blob files were deleted.)
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

