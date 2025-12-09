"use client"

import { useState, useEffect } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Loader2, Code, Code2 } from "lucide-react"
import { toast } from "sonner"

const DEV_MODE_STORAGE_KEY = "helluniversity_dev_mode"

/**
 * Dashboard Card for Dev Mode Toggle
 * Similar to DeleteAllBookingsCard but for dev mode
 */
export function DevModeCard() {
  const [enabled, setEnabled] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)

  // Load dev mode from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DEV_MODE_STORAGE_KEY)
      setEnabled(stored === "true")
    } catch (error) {
      console.error("Failed to load dev mode from localStorage:", error)
      setEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle toggle change
  const handleToggle = (checked: boolean) => {
    try {
      localStorage.setItem(DEV_MODE_STORAGE_KEY, checked ? "true" : "false")
      setEnabled(checked)
      toast.success(
        checked 
          ? "Dev mode enabled - Development tools are now visible" 
          : "Dev mode disabled - Development tools are now hidden"
      )
      // Trigger a custom event to notify other components
      window.dispatchEvent(new CustomEvent('devModeChanged', { detail: { enabled: checked } }))
    } catch (error) {
      console.error("Failed to save dev mode to localStorage:", error)
      toast.error("Failed to update dev mode")
    }
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
            enabled ? 'bg-blue-100' : 'bg-gray-100'
          }`}>
            {loading ? (
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            ) : enabled ? (
              <Code className="w-6 h-6 text-blue-600" />
            ) : (
              <Code2 className="w-6 h-6 text-gray-600" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Dev Mode</h3>
            <p className="text-sm text-gray-600">
              {enabled 
                ? "Development tools are visible" 
                : "Development tools are hidden"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {enabled 
                ? "Database and migration tools are shown" 
                : "Database and migration tools are hidden"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <Label htmlFor="dev-mode-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <Switch
                id="dev-mode-toggle"
                checked={enabled}
                onCheckedChange={handleToggle}
                className="mt-1"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

