import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-config"
import { BookingHoldsClient } from "./BookingHoldsClient"

export const dynamic = 'force-dynamic'

/**
 * Admin Booking Holds Page
 * Allows admins to manage date holds that block bookings
 */
export default async function BookingHoldsPage() {
  // Check authentication
  const session = await auth()
  
  // Redirect if not authenticated
  if (!session?.user) {
    redirect("/admin/login")
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
          Booking Holds
        </h1>
        <p className="text-sm sm:text-base text-gray-600">
          Manage dates that are unavailable for bookings
        </p>
      </div>

      <BookingHoldsClient />
    </div>
  )
}

