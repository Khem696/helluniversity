import { auth } from "@/lib/auth-config"
import Link from "next/link"
import { SignOutButton } from "@/components/SignOutButton"

// Mark as dynamic to prevent static export issues
export const dynamic = 'force-dynamic'

/**
 * Admin Layout
 * 
 * Separate layout for all admin pages
 * Provides admin-specific navigation and styling
 * Excludes the main website header
 * Login page doesn't show admin header (no session = login page)
 */

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Check authentication
  // If no session, we're likely on login page - don't show admin header
  const session = await auth()

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Admin Header - only show if user is authenticated */}
      {session?.user && (
        <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="text-xl font-bold text-gray-900 hover:text-gray-700 transition-colors"
              >
                Admin Panel
              </Link>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-6">
              <Link
                href="/admin"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/admin/bookings"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Reservation
              </Link>
              <Link
                href="/admin/events"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Event
              </Link>
              <Link
                href="/admin/images"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Image
              </Link>
              <Link
                href="/admin/email-queue"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Email Queue
              </Link>
            </nav>

            {/* User Info & Sign Out */}
            {session?.user && (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
                  <span>{session.user.name || session.user.email}</span>
                </div>
                <SignOutButton />
              </div>
            )}
          </div>
        </div>
      </header>
      )}

      {/* Admin Content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}

