"use client"

import { useState, useEffect } from "react"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Loader2, Calendar, CalendarX } from "lucide-react"
import { toast } from "sonner"

export function BookingToggle() {
  const [enabled, setEnabled] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  // Fetch current booking status
  useEffect(() => {
    async function fetchBookingStatus() {
      try {
        setLoading(true)
        const response = await fetch(buildApiUrl(API_PATHS.adminSettings, { key: 'bookings_enabled' }))
        const json = await response.json()
        
        if (json.success && json.data) {
          const value = json.data.value
          setEnabled(value === '1' || value === 1 || value === true)
        } else if (json.error?.message?.includes("does not exist")) {
          // Settings table doesn't exist - show warning
          toast.warning("Database not initialized. Please initialize the database first.", {
            description: "The settings table needs to be created. Use the 'Initialize Database' button.",
            duration: 10000,
          })
          setEnabled(true) // Default to enabled
        } else {
          // Default to enabled if setting doesn't exist
          setEnabled(true)
        }
      } catch (error) {
        console.error("Failed to fetch booking status:", error)
        toast.error("Failed to load booking status")
        setEnabled(true) // Default to enabled on error
      } finally {
        setLoading(false)
      }
    }

    fetchBookingStatus()
  }, [])

  // Handle toggle change
  const handleToggle = async (checked: boolean) => {
    try {
      setUpdating(true)
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
        setEnabled(checked)
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
        } else {
          toast.error(errorMessage)
        }
      }
    } catch (error) {
      console.error("Failed to update booking status:", error)
      toast.error("Failed to update booking status")
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Booking Status</h3>
            <p className="text-sm text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
            enabled ? 'bg-green-100' : 'bg-red-100'
          }`}>
            {enabled ? (
              <Calendar className="w-6 h-6 text-green-600" />
            ) : (
              <CalendarX className="w-6 h-6 text-red-600" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Booking Submissions</h3>
            <p className="text-sm text-gray-600">
              {enabled 
                ? "Bookings are currently enabled" 
                : "Bookings are currently disabled"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {enabled 
                ? "Users can submit booking requests" 
                : "Users cannot submit booking requests"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <Label htmlFor="booking-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="booking-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={updating}
              className="mt-1"
            />
          </div>
        </div>
      </div>
      {updating && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Updating...</span>
        </div>
      )}
    </div>
  )
}

