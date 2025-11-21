"use client"

import { useState } from "react"
import { DeleteAllBookingsDialog } from "./DeleteAllBookingsDialog"

/**
 * Dashboard Card for Delete All Bookings
 * Opens a dialog instead of navigating to a page
 */
export function DeleteAllBookingsCard() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="block w-full p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow text-left"
      >
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Delete All Bookings</h3>
            <p className="text-sm text-gray-600">Delete active or archive bookings</p>
          </div>
        </div>
      </button>

      <DeleteAllBookingsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          // Optionally refresh the page or trigger a refetch
          window.location.reload()
        }}
      />
    </>
  )
}

