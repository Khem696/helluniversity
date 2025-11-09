import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-config"
import Link from "next/link"
import { SignOutButton } from "@/components/SignOutButton"
import { InitDatabaseButton } from "./components/InitDatabaseButton"

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
        <p className="text-gray-600">
          Welcome, {session.user.name || session.user.email}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link
            href="/admin/images"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Images</h3>
                <p className="text-sm text-gray-600">Manage uploaded images</p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/events"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Events</h3>
                <p className="text-sm text-gray-600">Manage events and information</p>
              </div>
            </div>
          </Link>

          <InitDatabaseButton />
      </div>

      <div className="mt-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Account Information</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Email:</span>
            <span className="font-medium text-gray-900">{session.user.email}</span>
          </div>
          {session.user.name && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Name:</span>
              <span className="font-medium text-gray-900">{session.user.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
