"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Calendar, Edit2, Trash2, AlertCircle, CalendarX, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { formatDate } from "@/lib/booking-helpers"
import { logError, logWarn } from "@/lib/client-logger"
import { useActionLocks } from "@/hooks/useActionLocks"
import { getBangkokDateString } from "@/lib/timezone-client"

interface BookingHold {
  id: string
  startDate: number
  endDate: number | null
  startTime: string | null // Deprecated: Time fields are no longer used, always null
  endTime: string | null // Deprecated: Time fields are no longer used, always null
  reason: string | null
  createdBy: string
  modifiedBy: string | null
  createdAt: number
  updatedAt: number
}

export function BookingHoldsClient() {
  const [holds, setHolds] = useState<BookingHold[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingHold, setEditingHold] = useState<BookingHold | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Bulk delete state
  const [selectedHoldIds, setSelectedHoldIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  
  // Booking toggle state
  const [bookingEnabled, setBookingEnabled] = useState<boolean>(true)
  const [bookingToggleLoading, setBookingToggleLoading] = useState(true)
  const [bookingToggleUpdating, setBookingToggleUpdating] = useState(false)
  
  // Check action locks for bookings_enabled setting
  const { 
    lockStatus: actionLockStatus, 
    isLockedByOther: isActionLockedByOther,
  } = useActionLocks({
    resourceType: 'dashboard',
    resourceId: 'bookings_enabled',
    action: 'update_setting_bookings_enabled',
    pollInterval: 3000, // Poll every 3 seconds
    enabled: true,
  })
  
  // Form state
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  const [isDateRange, setIsDateRange] = useState(false)

  // Fetch holds
  const fetchHolds = async () => {
    try {
      setLoading(true)
      const response = await fetch(buildApiUrl("/api/v1/admin/booking-holds"))
      const json = await response.json()
      
      if (json.success) {
        const newHolds = json.data.holds || []
        setHolds(newHolds)
        
        // CRITICAL: Clear selection for holds that no longer exist
        // This prevents stale selection state if holds were deleted by another admin or expired
        setSelectedHoldIds(prev => {
          const holdIdsSet = new Set(newHolds.map((h: BookingHold) => h.id))
          const validSelection = new Set(Array.from(prev).filter(id => holdIdsSet.has(id)))
          
          // Log if any selections were cleared
          if (validSelection.size < prev.size) {
            const clearedCount = prev.size - validSelection.size
            logWarn("Cleared invalid hold selections after fetch", { 
              clearedCount,
              remaining: validSelection.size
            })
          }
          
          return validSelection
        })
      } else {
        toast.error("Failed to load booking holds")
      }
    } catch (error) {
      logError("Failed to fetch booking holds", { error: error instanceof Error ? error.message : String(error) }, error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to load booking holds")
    } finally {
      setLoading(false)
    }
  }

  // Fetch booking status
  useEffect(() => {
    async function fetchBookingStatus() {
      try {
        setBookingToggleLoading(true)
        const response = await fetch(buildApiUrl(API_PATHS.adminSettings, { key: 'bookings_enabled' }))
        const json = await response.json()
        
        if (json.success && json.data) {
          const value = json.data.value
          setBookingEnabled(value === '1' || value === 1 || value === true)
        } else if (json.error?.message?.includes("does not exist")) {
          toast.warning("Database not initialized. Please initialize the database first.", {
            description: "The settings table needs to be created. Use the 'Initialize Database' button.",
            duration: 10000,
          })
          setBookingEnabled(true) // Default to enabled
        } else {
          setBookingEnabled(true) // Default to enabled if setting doesn't exist
        }
      } catch (error) {
        console.error("Failed to fetch booking status:", error)
        toast.error("Failed to load booking status")
        setBookingEnabled(true) // Default to enabled on error
      } finally {
        setBookingToggleLoading(false)
      }
    }

    fetchBookingStatus()
  }, [])

  useEffect(() => {
    fetchHolds()
  }, [])

  // Handle booking toggle change
  const handleBookingToggle = async (checked: boolean) => {
    // Check if action is locked by another admin
    if (isActionLockedByOther) {
      const lockedBy = actionLockStatus.lockedBy || "another admin"
      toast.error(`This setting is currently being updated by ${lockedBy}. Please wait a moment and try again.`, {
        duration: 5000,
      })
      return
    }

    try {
      setBookingToggleUpdating(true)
      const response = await fetch(API_PATHS.adminSettings, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: "bookings_enabled",
          value: checked ? 1 : 0,
        }),
      })

      const json = await response.json()

      if (json.success) {
        setBookingEnabled(checked)
        toast.success(
          checked 
            ? "Booking submissions are now enabled" 
            : "Booking submissions are now disabled"
        )
      } else {
        const errorMessage = json.error?.message || "Failed to update booking status"
        if (errorMessage.includes("does not exist")) {
          toast.error("Database not initialized", {
            description: "Please initialize the database first using the 'Initialize Database' button.",
            duration: 10000,
          })
        } else if (response.status === 409) {
          toast.error("Another admin is currently updating this setting. Please wait and try again.", {
            duration: 5000,
          })
        } else {
          toast.error(errorMessage)
        }
      }
    } catch (error) {
      console.error("Failed to update booking status:", error)
      toast.error("Failed to update booking status")
    } finally {
      setBookingToggleUpdating(false)
    }
  }

  // Format timestamp to date string (YYYY-MM-DD) in Bangkok timezone
  const formatTimestampToDate = (timestamp: number): string => {
    try {
      const utcDate = new Date(timestamp * 1000)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      return format(bangkokDate, 'yyyy-MM-dd')
    } catch (error) {
      logWarn("Error formatting timestamp to date", { timestamp, error: error instanceof Error ? error.message : String(error) })
      // Fallback to UTC if timezone conversion fails
      const date = new Date(timestamp * 1000)
      const year = date.getUTCFullYear()
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const day = String(date.getUTCDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
  }

  // Format timestamp to readable date (uses formatDate helper which handles Bangkok timezone)
  const formatTimestampToReadable = (timestamp: number): string => {
    try {
      return formatDate(timestamp)
    } catch (error) {
      logWarn("Error formatting timestamp to readable date", { timestamp, error: error instanceof Error ? error.message : String(error) })
      return "Invalid Date"
    }
  }

  // Open dialog for creating new hold
  const handleCreate = () => {
    setEditingHold(null)
    setStartDate("")
    setEndDate("")
    setReason("")
    setIsDateRange(false)
    setIsDialogOpen(true)
  }

  // Open dialog for editing hold
  const handleEdit = (hold: BookingHold) => {
    setEditingHold(hold)
    setStartDate(formatTimestampToDate(hold.startDate))
    setEndDate(hold.endDate ? formatTimestampToDate(hold.endDate) : "")
    setReason(hold.reason || "")
    setIsDateRange(!!hold.endDate)
    setIsDialogOpen(true)
  }

  // Handle form submission
  const handleSubmit = async () => {
    // Validation
    if (!startDate) {
      toast.error("Start date is required")
      return
    }

    if (isDateRange && !endDate) {
      toast.error("End date is required for date ranges")
      return
    }

    if (isDateRange && endDate && endDate < startDate) {
      toast.error("End date must be after or equal to start date")
      return
    }

    // Validate dates using Bangkok timezone
    try {
      const todayBangkok = getBangkokDateString()
      
      // Check if start date is before today in Bangkok timezone
      if (startDate < todayBangkok) {
        toast.error("Start date cannot be in the past. Please select today or a future date (Bangkok timezone).")
        return
      }

      // Check if end date is before today in Bangkok timezone
      if (isDateRange && endDate && endDate < todayBangkok) {
        toast.error("End date cannot be in the past. Please select today or a future date (Bangkok timezone).")
        return
      }
    } catch (error) {
      logWarn("Error validating dates in Bangkok timezone", { error: error instanceof Error ? error.message : String(error) })
      // Continue with submission - server will validate
    }

    try {
      setIsSubmitting(true)
      const url = editingHold
        ? buildApiUrl(`/api/v1/admin/booking-holds/${editingHold.id}`)
        : buildApiUrl("/api/v1/admin/booking-holds")
      
      const method = editingHold ? "PUT" : "POST"
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate: isDateRange ? endDate : null,
          reason: reason || null,
        }),
      })

      const json = await response.json()

      if (json.success) {
        toast.success(editingHold ? "Booking hold updated" : "Booking hold created")
        setIsDialogOpen(false)
        fetchHolds()
      } else {
        toast.error(json.error?.message || "Failed to save booking hold")
      }
    } catch (error) {
      logError("Failed to save booking hold", { 
        editingHold: editingHold?.id, 
        error: error instanceof Error ? error.message : String(error) 
      }, error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to save booking hold")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle delete
  const handleDelete = async (hold: BookingHold) => {
    if (!confirm(`Are you sure you want to delete this booking hold?\n\n${formatTimestampToReadable(hold.startDate)}${hold.endDate ? ` - ${formatTimestampToReadable(hold.endDate)}` : ""}`)) {
      return
    }

    try {
      const response = await fetch(buildApiUrl(`/api/v1/admin/booking-holds/${hold.id}`), {
        method: "DELETE",
      })

      const json = await response.json()

      if (json.success) {
        toast.success("Booking hold deleted")
        fetchHolds()
        // Clear selection if deleted hold was selected
        setSelectedHoldIds(prev => {
          const newSet = new Set(prev)
          newSet.delete(hold.id)
          return newSet
        })
      } else {
        toast.error(json.error?.message || "Failed to delete booking hold")
      }
    } catch (error) {
      logError("Failed to delete booking hold", { 
        holdId: hold.id, 
        error: error instanceof Error ? error.message : String(error) 
      }, error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to delete booking hold")
    }
  }

  // Handle bulk delete
  const handleBulkDelete = async () => {
    if (selectedHoldIds.size === 0) {
      toast.error("Please select at least one hold to delete")
      return
    }

    const holdIdsArray = Array.from(selectedHoldIds)
    const selectedHolds = holds.filter(h => selectedHoldIds.has(h.id))
    
    // Limit displayed dates in confirmation to prevent extremely long dialogs
    const MAX_DISPLAYED_DATES = 10
    const holdDates = selectedHolds
      .slice(0, MAX_DISPLAYED_DATES)
      .map(h => formatTimestampToReadable(h.startDate) + (h.endDate ? ` - ${formatTimestampToReadable(h.endDate)}` : ""))
      .join('\n')
    
    const moreCount = selectedHolds.length > MAX_DISPLAYED_DATES 
      ? selectedHolds.length - MAX_DISPLAYED_DATES 
      : 0
    
    const confirmationMessage = `Are you sure you want to delete ${selectedHoldIds.size} booking hold(s)?\n\n${holdDates}${moreCount > 0 ? `\n\n... and ${moreCount} more` : ''}`

    if (!confirm(confirmationMessage)) {
      return
    }

    try {
      setIsBulkDeleting(true)
      const response = await fetch(buildApiUrl("/api/v1/admin/booking-holds"), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ holdIds: holdIdsArray }),
      })

      const json = await response.json()

      if (json.success) {
        const deletedCount = json.data?.deletedCount || 0
        const failedCount = json.data?.failed || 0
        
        if (failedCount > 0) {
          toast.warning(`Deleted ${deletedCount} hold(s), ${failedCount} failed`)
        } else {
          toast.success(`Successfully deleted ${deletedCount} booking hold(s)`)
        }
        
        // Clear selection and refresh holds
        setSelectedHoldIds(new Set())
        fetchHolds()
      } else {
        const errorMessage = json.error?.message || "Failed to delete booking holds"
        
        // Check for rate limit error
        if (json.error?.code === "RATE_LIMIT_EXCEEDED" || response.status === 429) {
          const resetTime = json.error?.details?.reset
          const retryAfter = json.error?.details?.retryAfter
          if (resetTime || retryAfter) {
            const retrySeconds = retryAfter || (resetTime - Math.floor(Date.now() / 1000))
            toast.error(`Rate limit exceeded. Please try again in ${retrySeconds} second(s).`)
          } else {
            toast.error("Rate limit exceeded. Please try again later.")
          }
        } else {
          toast.error(errorMessage)
        }
      }
    } catch (error) {
      logError("Failed to bulk delete booking holds", { 
        holdIds: holdIdsArray, 
        error: error instanceof Error ? error.message : String(error) 
      }, error instanceof Error ? error : new Error(String(error)))
      toast.error("Failed to delete booking holds")
    } finally {
      setIsBulkDeleting(false)
    }
  }

  // Handle select/deselect hold
  const handleToggleSelect = (holdId: string, selected: boolean) => {
    setSelectedHoldIds(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(holdId)
      } else {
        newSet.delete(holdId)
      }
      return newSet
    })
  }

  // Handle select all
  const handleSelectAll = (selectAll: boolean) => {
    if (selectAll) {
      setSelectedHoldIds(new Set(holds.map(h => h.id)))
    } else {
      setSelectedHoldIds(new Set())
    }
  }

  // Keyboard shortcuts for bulk operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if dialog is open or if user is typing in an input
      if (isDialogOpen || (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        return
      }

      // Ctrl/Cmd + A: Select all holds
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        if (holds.length > 0) {
          handleSelectAll(true)
        }
      }
      
      // Delete key: Bulk delete if selection exists
      if (e.key === 'Delete' && selectedHoldIds.size > 0 && !isBulkDeleting) {
        e.preventDefault()
        handleBulkDelete()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDialogOpen, holds.length, selectedHoldIds.size, isBulkDeleting])

  // Get today's date in YYYY-MM-DD format in Bangkok timezone
  const getTodayDate = () => {
    try {
      return getBangkokDateString()
    } catch (error) {
      logWarn("Error getting today's date in Bangkok timezone", { error: error instanceof Error ? error.message : String(error) })
      // Fallback to local time
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')
      const day = String(today.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Booking Submission Toggle */}
      <div className="p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
        {/* Show lock status warning if action is locked by another admin */}
        {isActionLockedByOther && (
          <Alert variant="destructive" className="mb-4 bg-orange-50 border-orange-200">
            <Lock className="h-4 w-4" />
            <AlertTitle className="text-orange-900">🔒 Setting Locked by Another Admin</AlertTitle>
            <AlertDescription className="text-orange-800">
              This setting is currently being updated by {actionLockStatus.lockedBy || "another admin"}. 
              Please wait a moment and try again. The page will automatically update when the lock is released.
            </AlertDescription>
          </Alert>
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
              bookingEnabled ? 'bg-green-100' : 'bg-red-100'
            }`}>
              {bookingEnabled ? (
                <Calendar className="w-6 h-6 text-green-600" />
              ) : (
                <CalendarX className="w-6 h-6 text-red-600" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Booking Submissions</h3>
              <p className="text-sm text-gray-600">
                {bookingEnabled 
                  ? "Bookings are currently enabled" 
                  : "Bookings are currently disabled"}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {bookingEnabled 
                  ? "Users can submit booking requests" 
                  : "Users cannot submit booking requests"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <Label htmlFor="booking-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
                {bookingEnabled ? "Enabled" : "Disabled"}
              </Label>
              {bookingToggleLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
              ) : (
                <Switch
                  id="booking-toggle"
                  checked={bookingEnabled}
                  onCheckedChange={handleBookingToggle}
                  disabled={bookingToggleUpdating || isActionLockedByOther}
                  className="mt-1"
                  title={isActionLockedByOther ? `This setting is locked by ${actionLockStatus.lockedBy || "another admin"}` : undefined}
                />
              )}
            </div>
          </div>
        </div>
        {bookingToggleUpdating && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Updating...</span>
          </div>
        )}
      </div>

      {/* Header with create button and bulk actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Active Holds</h2>
          <p className="text-sm text-gray-600 mt-1">
            {holds.length} hold{holds.length !== 1 ? 's' : ''} configured
            {selectedHoldIds.size > 0 && (
              <span className="ml-2 text-blue-600 font-medium">
                ({selectedHoldIds.size} selected)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedHoldIds.size > 0 && (
            <Button 
              onClick={handleBulkDelete} 
              variant="destructive"
              disabled={isBulkDeleting}
              className="flex items-center gap-2"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete Selected ({selectedHoldIds.size})
                </>
              )}
            </Button>
          )}
          <Button onClick={handleCreate} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Hold
          </Button>
        </div>
      </div>

      {/* Select all checkbox */}
      {holds.length > 0 && (
        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
          <Checkbox
            id="select-all"
            checked={selectedHoldIds.size === holds.length && holds.length > 0}
            onCheckedChange={(checked) => handleSelectAll(checked === true)}
          />
          <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
            Select All ({holds.length} holds)
          </Label>
          {selectedHoldIds.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedHoldIds(new Set())}
              className="ml-auto text-sm"
            >
              Clear Selection
            </Button>
          )}
        </div>
      )}

      {/* Holds list */}
      {holds.length === 0 ? (
        <div className="p-8 bg-white rounded-lg shadow-md text-center">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No booking holds</h3>
          <p className="text-sm text-gray-600 mb-4">
            Create a hold to mark dates as unavailable for bookings
          </p>
          <Button onClick={handleCreate} variant="outline">
            Create Your First Hold
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {holds.map((hold) => {
            // Check if hold is past using Bangkok timezone
            // CRITICAL: Calculate end of day timestamp (23:59:59) for proper comparison
            // The hold blocks until end of day, so we need to compare against end of day, not start of day
            const now = new Date()
            const bangkokNow = new TZDate(now.getTime(), 'Asia/Bangkok')
            
            // Calculate end of day timestamp for the hold's end date (or start date if single day)
            const holdEndDateTimestamp = hold.endDate || hold.startDate
            const holdEndDate = new TZDate(holdEndDateTimestamp * 1000, 'Asia/Bangkok')
            
            // Set to end of day (23:59:59) in Bangkok timezone for proper comparison
            const holdEndOfDay = new TZDate(
              holdEndDate.getFullYear(),
              holdEndDate.getMonth(),
              holdEndDate.getDate(),
              23, 59, 59,
              'Asia/Bangkok'
            )
            
            // Hold is past if end of day has passed
            const isPast = holdEndOfDay.getTime() < bangkokNow.getTime()
            
            const isSelected = selectedHoldIds.has(hold.id)
            
            return (
              <div
                key={hold.id}
                className={`p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow ${
                  isPast ? "opacity-60" : ""
                } ${isSelected ? "ring-2 ring-blue-500" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <Checkbox
                      id={`hold-${hold.id}`}
                      checked={isSelected}
                      onCheckedChange={(checked) => handleToggleSelect(hold.id, checked === true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Calendar className="w-5 h-5 text-gray-400" />
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {formatTimestampToReadable(hold.startDate)}
                            {hold.endDate && ` - ${formatTimestampToReadable(hold.endDate)}`}
                          </h3>
                        </div>
                        {isPast && (
                          <span className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded">
                            Past
                          </span>
                        )}
                      </div>
                      {hold.reason && (
                        <p className="text-sm text-gray-600 mt-2">{hold.reason}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Created by {hold.createdBy} on {formatTimestampToReadable(hold.createdAt)}
                        {hold.modifiedBy && hold.modifiedBy !== hold.createdBy && (
                          <span className="ml-2">
                            • Modified by {hold.modifiedBy} on {formatTimestampToReadable(hold.updatedAt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(hold)}
                      className="flex items-center gap-1"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(hold)}
                      className="flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingHold ? "Edit Booking Hold" : "Create Booking Hold"}
            </DialogTitle>
            <DialogDescription>
              Mark dates as unavailable for bookings. These dates will be blocked from new booking requests.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dateRange"
                checked={isDateRange}
                onChange={(e) => setIsDateRange(e.target.checked)}
                className="w-4 h-4"
              />
              <Label htmlFor="dateRange" className="text-sm font-medium">
                Date Range (multiple days)
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={getTodayDate()}
                required
              />
              <p className="text-xs text-gray-500">You can set the start date to today or any future date</p>
            </div>

            {isDateRange && (
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || getTodayDate()}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Maintenance, Private event, etc."
                rows={3}
              />
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                This hold will block all booking requests for the specified date(s). 
                Existing confirmed bookings will not be affected.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingHold ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

