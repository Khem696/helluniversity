"use client"

import Link from "next/link"
import { NotificationBadge } from "./NotificationBadge"

interface DashboardCardProps {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  notificationCount?: number
}

/**
 * Dashboard Card Component with Notification Badge
 */
export function DashboardCard({ href, icon, title, description, notificationCount }: DashboardCardProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow relative"
    >
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {notificationCount !== undefined && notificationCount > 0 && (
              <NotificationBadge count={notificationCount} />
            )}
          </div>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
    </Link>
  )
}

