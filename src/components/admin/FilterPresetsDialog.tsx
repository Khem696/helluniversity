"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Save, Loader2, Bookmark } from "lucide-react"
import { useFilterPresets, type FilterPreset } from "@/hooks/useFilterPresets"
import { toast } from "sonner"

interface FilterPresetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storageKey: string
  currentFilters: Record<string, any>
  onLoadPreset: (filters: Record<string, any>) => void
}

export function FilterPresetsDialog({
  open,
  onOpenChange,
  storageKey,
  currentFilters,
  onLoadPreset,
}: FilterPresetsDialogProps) {
  const [presetName, setPresetName] = useState("")
  const [saving, setSaving] = useState(false)
  const { presets, savePreset, deletePreset } = useFilterPresets({
    storageKey,
    maxPresets: 10,
  })

  const handleSave = async () => {
    if (!presetName.trim()) {
      toast.error("Please enter a preset name")
      return
    }

    setSaving(true)
    try {
      savePreset(presetName.trim(), currentFilters)
      toast.success("Filter preset saved")
      setPresetName("")
    } catch (error) {
      toast.error("Failed to save preset")
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = (preset: FilterPreset) => {
    onLoadPreset(preset.filters)
    toast.success(`Loaded preset: ${preset.name}`)
    onOpenChange(false)
  }

  const handleDelete = (preset: FilterPreset, e: React.MouseEvent) => {
    e.stopPropagation()
    deletePreset(preset.id)
    toast.success("Preset deleted")
  }

  const hasActiveFilters = Object.values(currentFilters).some(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "all" &&
      (Array.isArray(value) ? value.length > 0 : true)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="w-5 h-5" />
            Saved Filter Presets
          </DialogTitle>
          <DialogDescription>
            Save your current filters as a preset for quick access later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Save Current Filters */}
          <div className="space-y-2">
            <Label htmlFor="preset-name">Save Current Filters</Label>
            <div className="flex gap-2">
              <Input
                id="preset-name"
                placeholder="Enter preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSave()
                  }
                }}
                disabled={!hasActiveFilters || saving}
              />
              <Button
                onClick={handleSave}
                disabled={!hasActiveFilters || !presetName.trim() || saving}
                size="sm"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
            {!hasActiveFilters && (
              <p className="text-xs text-gray-500">
                No active filters to save. Apply some filters first.
              </p>
            )}
          </div>

          {/* Saved Presets List */}
          <div className="space-y-2">
            <Label>Saved Presets</Label>
            {presets.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No saved presets yet. Save your first preset above.
              </p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-auto">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between p-2 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer group"
                    onClick={() => handleLoad(preset)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {preset.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(preset.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleDelete(preset, e)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

