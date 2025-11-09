"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, CheckCircle2, XCircle, AlertCircle, Eye } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function MigrateImagesButton() {
  const [isMigrating, setIsMigrating] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
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

  const checkStatus = async () => {
    setIsChecking(true)
    setStatus({ type: "checking" })
    try {
      const response = await fetch("/api/admin/migrate-images")
      const data = await response.json()

      if (data.success) {
        setStatus({
          type: "success",
          message: `Total images in database: ${data.stats.total}`,
          stats: data.stats,
        })
      } else {
        setStatus({ type: "error", message: data.error || "Failed to check status" })
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to check migration status",
      })
    } finally {
      setIsChecking(false)
    }
  }

  const runDryRun = async () => {
    setIsDryRunning(true)
    setStatus({ type: "dryrun" })
    try {
      const response = await fetch("/api/admin/migrate-images?dryRun=true")
      const data = await response.json()

      if (data.success) {
        setStatus({
          type: "dryrun",
          message: data.message,
          dryRunResults: {
            images: Array.isArray(data.images) ? data.images : [],
            stats: data.stats || { total: 0, byCategory: {} },
          },
        })
      } else {
        setStatus({ type: "error", message: data.error || "Failed to run dry run" })
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

  const startMigration = async () => {
    if (
      !confirm(
        "Are you sure you want to migrate all static images to Vercel Blob? This may take several minutes."
      )
    ) {
      return
    }

    setIsMigrating(true)
    setStatus({ type: "idle" })

    try {
      const response = await fetch("/api/admin/migrate-images", {
        method: "POST",
      })

      const data = await response.json()

      if (data.success) {
        setStatus({
          type: "success",
          message: data.message,
          stats: data.stats,
          errors: data.errors,
        })
        // Refresh status after migration
        setTimeout(() => checkStatus(), 1000)
      } else {
        setStatus({
          type: "error",
          message: data.error || "Failed to migrate images",
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
            {(status.type === "checking" || status.type === "dryrun") && (
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

        <Dialog>
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
                This will scan for images without actually migrating them.
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
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Found {status.dryRunResults.stats.total || 0} images to migrate
                  </p>
                  {status.dryRunResults.stats.byCategory && Object.entries(status.dryRunResults.stats.byCategory).length > 0 ? (
                    Object.entries(status.dryRunResults.stats.byCategory).map(([cat, count]) => (
                      <p key={cat} className="text-sm">
                        {cat}: {count}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No images found in categories</p>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Button
          onClick={startMigration}
          disabled={isMigrating || isChecking || isDryRunning}
          size="sm"
          className="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700"
        >
          {isMigrating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Migrating...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Migrate
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

