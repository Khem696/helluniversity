"use client"

import { cn } from "@/lib/utils"

interface NotificationBadgeProps {
  count: number
  className?: string
  variant?: "default" | "small"
}

/**
 * Notification Badge Component
 * Displays a count badge with animation
 */
export function NotificationBadge({ count, className, variant = "default" }: NotificationBadgeProps) {
  if (count === 0) return null

  const sizeClasses = variant === "small" 
    ? "min-w-[1.25rem] h-5 px-1.5 text-xs" 
    : "min-w-[1.5rem] h-6 px-2 text-sm"

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-red-500 text-white font-semibold",
        "animate-pulse",
        sizeClasses,
        className
      )}
      aria-label={`${count} notifications`}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

