import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-config"
import { SignOutButton } from "@/components/SignOutButton"
import { BookingToggle } from "./components/BookingToggle"
import { DevModeToggle } from "./components/DevModeToggle"
import { DashboardClient } from "./components/DashboardClient"
import { DevToolsSection } from "./components/DevToolsSection"

// Mark as dynamic to prevent static export issues
export const dynamic = 'force-dynamic'

/**
 * Admin Dashboard
 * Simple authentication check and dashboard display
 */

export default async function AdminDashboard() {
  // Check authentication
  const session = await auth()
  
  // Redirect if not authenticated
  if (!session?.user) {
    redirect("/admin/login")
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Welcome, {session.user.name || session.user.email}
        </p>
      </div>

      {/* Booking Toggle - Moved to top */}
      <div className="mb-6">
        <BookingToggle />
      </div>

      {/* Dev Mode Toggle */}
      <div className="mb-6">
        <DevModeToggle />
      </div>

      <DashboardClient />

      {/* Dev Tools Section - Only visible when dev mode is enabled */}
      <DevToolsSection />

      <div className="mt-6 sm:mt-8 p-4 sm:p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-3 sm:mb-4">Account Information</h2>
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="text-sm sm:text-base text-gray-600">Email:</span>
            <span className="text-sm sm:text-base font-medium text-gray-900 break-all">{session.user.email}</span>
          </div>
          {session.user.name && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="text-sm sm:text-base text-gray-600">Name:</span>
              <span className="text-sm sm:text-base font-medium text-gray-900">{session.user.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
