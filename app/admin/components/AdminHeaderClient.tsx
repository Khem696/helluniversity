"use client"

import Link from "next/link"
import { useAdminStatsSSE } from "@/hooks/useAdminStatsSSE"
import { NotificationBadge } from "./NotificationBadge"

/**
 * Client-side admin header navigation with notification badges
 * This enables real-time updates via Server-Sent Events
 */
export function AdminHeaderClient() {
  const { stats } = useAdminStatsSSE({
    enabled: true,
  })

  return (
    <nav className="hidden md:flex items-center gap-6">
      <Link
        href="/admin"
        prefetch={false}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        Dashboard
      </Link>
      <Link
        href="/admin/bookings"
        prefetch={false}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors relative"
      >
        Reservation
        {stats && stats.bookings.pending > 0 && (
          <span className="ml-2">
            <NotificationBadge count={stats.bookings.pending} variant="small" />
          </span>
        )}
      </Link>
      <Link
        href="/admin/email-queue"
        prefetch={false}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors relative"
      >
        Email Queue
        {stats && stats.emailQueue.total > 0 && (
          <span className="ml-2">
            <NotificationBadge count={stats.emailQueue.total} variant="small" />
          </span>
        )}
      </Link>
      <Link
        href="/admin/events"
        prefetch={false}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        Event
      </Link>
      <Link
        href="/admin/images"
        prefetch={false}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        Image
      </Link>
    </nav>
  )
}

