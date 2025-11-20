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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Download, FileSpreadsheet, FileText } from "lucide-react"
import { EXPORT_FIELDS, getDefaultExportFields, type ExportBookingRow } from "@/lib/booking-export"
import { API_PATHS } from "@/lib/api-config"
import { toast } from "sonner"

interface BookingExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: {
    status?: string
    statuses?: string[]
    email?: string
    referenceNumber?: string
    name?: string
    phone?: string
    eventType?: string
    sortBy?: string
    sortOrder?: string
    showOverlappingOnly?: boolean
    archive?: boolean
    startDateFrom?: number
    startDateTo?: number
  }
  isFiltered?: boolean
}

export function BookingExportDialog({
  open,
  onOpenChange,
  filters,
  isFiltered = false,
}: BookingExportDialogProps) {
  const [format, setFormat] = useState<"csv" | "excel">("csv")
  const [selectedFields, setSelectedFields] = useState<string[]>(getDefaultExportFields())
  const [includeStatusHistory, setIncludeStatusHistory] = useState(false)
  const [includeFeeHistory, setIncludeFeeHistory] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Group fields by category
  const fieldsByCategory = {
    essential: EXPORT_FIELDS.filter(f => f.category === "essential"),
    financial: EXPORT_FIELDS.filter(f => f.category === "financial"),
    operational: EXPORT_FIELDS.filter(f => f.category === "operational"),
    content: EXPORT_FIELDS.filter(f => f.category === "content"),
  }

  const toggleField = (fieldKey: keyof ExportBookingRow) => {
    setSelectedFields(prev =>
      prev.includes(fieldKey)
        ? prev.filter(f => f !== fieldKey)
        : [...prev, fieldKey]
    )
  }

  const selectCategory = (category: "essential" | "financial" | "operational" | "content") => {
    const categoryFields = fieldsByCategory[category].map(f => f.key) as (keyof ExportBookingRow)[]
    setSelectedFields(prev => {
      const allSelected = categoryFields.every(f => prev.includes(f as string))
      if (allSelected) {
        // Deselect all in category
        return prev.filter(f => !categoryFields.includes(f as keyof ExportBookingRow))
      } else {
        // Select all in category
        return [...new Set([...prev, ...categoryFields.map(f => f as string)])]
      }
    })
  }

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      toast.error("Please select at least one field to export")
      return
    }

    setIsExporting(true)
    try {
      // Build export URL with filters and options
      const params = new URLSearchParams()
      params.append("format", format)
      params.append("fields", selectedFields.join(","))
      if (includeStatusHistory) {
        params.append("includeStatusHistory", "true")
      }
      if (includeFeeHistory) {
        params.append("includeFeeHistory", "true")
      }

      // Add filters
      // Support multiple status filters
      if (filters.statuses && filters.statuses.length > 0) {
        filters.statuses.forEach((status) => {
          params.append("status", status)
        })
      } else if (filters.status && filters.status !== "all") {
        params.append("status", filters.status)
      }
      if (filters.email) {
        params.append("email", filters.email)
      }
      if (filters.referenceNumber) {
        params.append("referenceNumber", filters.referenceNumber)
      }
      if (filters.name) {
        params.append("name", filters.name)
      }
      if (filters.phone) {
        params.append("phone", filters.phone)
      }
      if (filters.eventType && filters.eventType !== "all") {
        params.append("eventType", filters.eventType)
      }
      if (filters.sortBy) {
        params.append("sortBy", filters.sortBy)
      }
      if (filters.sortOrder) {
        params.append("sortOrder", filters.sortOrder)
      }
      if (filters.showOverlappingOnly) {
        params.append("showOverlappingOnly", "true")
      }
      if (filters.archive) {
        params.append("archive", "true")
      }
      if (filters.startDateFrom) {
        params.append("startDateFrom", filters.startDateFrom.toString())
      }
      if (filters.startDateTo) {
        params.append("startDateTo", filters.startDateTo.toString())
      }

      const url = `${API_PATHS.adminBookingExport}?${params.toString()}`

      // Trigger download
      const response = await fetch(url)
      if (!response.ok) {
        // Try to parse error response
        let errorMessage = "Export failed"
        try {
          const contentType = response.headers.get("content-type")
          if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json()
            // Handle different error response structures
            if (errorData.error) {
              if (typeof errorData.error === "string") {
                errorMessage = errorData.error
              } else if (errorData.error.message) {
                errorMessage = errorData.error.message
              } else if (errorData.error.code) {
                errorMessage = `${errorData.error.code}: ${errorData.error.message || "Export failed"}`
              }
            } else if (errorData.message) {
              errorMessage = errorData.message
            }
          } else {
            // Non-JSON error response
            const text = await response.text()
            errorMessage = text || `HTTP ${response.status}: ${response.statusText}`
          }
        } catch (parseError) {
          // If parsing fails, use status text
          errorMessage = `HTTP ${response.status}: ${response.statusText || "Export failed"}`
        }
        throw new Error(errorMessage)
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get("Content-Disposition")
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch
        ? filenameMatch[1]
        : `bookings_${new Date().toISOString().slice(0, 10)}.${format === "excel" ? "xlsx" : "csv"}`

      // Create blob and download
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      toast.success(`Export completed successfully`)
      onOpenChange(false)
    } catch (error) {
      console.error("Export error:", error)
      toast.error(error instanceof Error ? error.message : "Failed to export bookings")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Bookings</DialogTitle>
          <DialogDescription>
            Export booking data as CSV or Excel file. Select format and fields to include.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div className="space-y-2">
            <Label>Export Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as "csv" | "excel")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    CSV (Comma Separated Values)
                  </div>
                </SelectItem>
                <SelectItem value="excel">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    Excel (.xlsx)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            {format === "excel" && (
              <p className="text-xs text-gray-500">
                Excel format supports multiple sheets including status and fee history.
              </p>
            )}
          </div>

          {/* Field Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Fields to Include</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFields(EXPORT_FIELDS.map(f => f.key))}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFields([])}
                >
                  Deselect All
                </Button>
              </div>
            </div>

            <div className="space-y-4 border rounded-lg p-4 max-h-96 overflow-y-auto">
              {/* Essential Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Essential Fields</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectCategory("essential")}
                  >
                    {fieldsByCategory.essential.every(f => selectedFields.includes(f.key))
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {fieldsByCategory.essential.map(field => (
                    <div key={field.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={field.key}
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <label
                        htmlFor={field.key}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {field.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Financial Fields</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectCategory("financial")}
                  >
                    {fieldsByCategory.financial.every(f => selectedFields.includes(f.key))
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {fieldsByCategory.financial.map(field => (
                    <div key={field.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={field.key}
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <label
                        htmlFor={field.key}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {field.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operational Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Operational Fields</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectCategory("operational")}
                  >
                    {fieldsByCategory.operational.every(f => selectedFields.includes(f.key))
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {fieldsByCategory.operational.map(field => (
                    <div key={field.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={field.key}
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <label
                        htmlFor={field.key}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {field.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Content Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Content Fields</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectCategory("content")}
                  >
                    {fieldsByCategory.content.every(f => selectedFields.includes(f.key))
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {fieldsByCategory.content.map(field => (
                    <div key={field.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={field.key}
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <label
                        htmlFor={field.key}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {field.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* History Options (Excel only) */}
          {format === "excel" && (
            <div className="space-y-3">
              <Label>Additional Sheets (Excel only)</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeStatusHistory"
                    checked={includeStatusHistory}
                    onCheckedChange={(checked) => setIncludeStatusHistory(checked === true)}
                  />
                  <label
                    htmlFor="includeStatusHistory"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Include Status History
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeFeeHistory"
                    checked={includeFeeHistory}
                    onCheckedChange={(checked) => setIncludeFeeHistory(checked === true)}
                  />
                  <label
                    htmlFor="includeFeeHistory"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Include Fee History
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleExport}
            disabled={isExporting || selectedFields.length === 0}
            className="flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

