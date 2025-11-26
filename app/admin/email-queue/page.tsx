"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { redirect } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Play,
  Trash,
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { useInfiniteAdminEmails, type EmailQueueItem } from "@/hooks/useInfiniteAdminEmails"
import { useAdminEmailsSSE } from "@/hooks/useAdminEmailsSSE"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll"
import { GenericDeleteConfirmationDialog } from "@/components/admin/GenericDeleteConfirmationDialog"
import { SearchInputWithHistory } from "@/components/admin/SearchInputWithHistory"

interface EmailQueueStats {
  pending: number
  processing: number
  failed: number
  sent: number
  total: number
}

export default function EmailQueuePage() {
  const { data: session, status } = useSession()
  const [stats, setStats] = useState<EmailQueueStats>({
    pending: 0,
    processing: 0,
    failed: 0,
    sent: 0,
    total: 0,
  })
  const [processing, setProcessing] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<EmailQueueItem | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [emailToDelete, setEmailToDelete] = useState<EmailQueueItem | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailTypeFilter, setEmailTypeFilter] = useState<string>("all")
  const [bookingReferenceFilter, setBookingReferenceFilter] = useState("")
  const [debouncedBookingReferenceFilter, setDebouncedBookingReferenceFilter] = useState("")
  const [pageSize, setPageSize] = useState(25)
  
  // FIXED: Track optimistic updates to prevent SSE from overwriting user actions (Issue #2)
  // This protects against race conditions where SSE events arrive while user is retrying/canceling emails
  const pendingOptimisticUpdatesRef = useRef<Map<string, number>>(new Map())
  // Track timeout IDs for optimistic updates to allow cleanup on unmount
  const optimisticUpdateTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  
  // Search handlers for booking reference
  const handleBookingReferenceSearch = (value: string) => {
    setDebouncedBookingReferenceFilter(value)
  }

  const handleBookingReferenceDebouncedSearch = (value: string) => {
    setDebouncedBookingReferenceFilter(value)
  }
  
  // Build base endpoint with filters (without limit/offset for infinite scroll)
  const baseEndpoint = useMemo(() => {
    const params = new URLSearchParams()
    if (statusFilter !== "all") {
      params.append("status", statusFilter)
    }
    if (emailTypeFilter !== "all") {
      params.append("emailType", emailTypeFilter)
    }
    if (debouncedBookingReferenceFilter) {
      params.append("bookingReference", debouncedBookingReferenceFilter)
    }
    return buildApiUrl(API_PATHS.adminEmailQueue, Object.fromEntries(params))
  }, [statusFilter, emailTypeFilter, debouncedBookingReferenceFilter])
  
  // Track SSE connection status for fallback polling
  // FIXED: Initialize sseConnected to true (optimistic) to prevent premature polling (Bug #51)
  // This assumes SSE will connect successfully. If it fails, the useEffect syncing
  // sseHookResult will update this to false, enabling fallback polling.
  // The initial data fetch is not affected by refetchInterval, so this is safe.
  const [sseError, setSseError] = useState<Error | null>(null)
  const [sseConnected, setSseConnected] = useState<boolean>(true)

  // FIXED: Use useMemo to make refetchInterval reactive to SSE state changes (Bug #52)
  // This ensures polling activates/deactivates when SSE connection status changes
  const refetchInterval = useMemo(() => {
    // Enable fallback polling if SSE is not connected OR has an error (30 seconds interval)
    // When SSE is connected and working, polling is disabled for efficiency
    return (!sseConnected || sseError) ? 30000 : false
  }, [sseConnected, sseError])

  // FIXED: Cleanup optimistic update timeouts on unmount (Issue #2)
  useEffect(() => {
    return () => {
      // Clear all pending optimistic update timeouts
      if (optimisticUpdateTimeoutsRef.current) {
        for (const timeoutId of optimisticUpdateTimeoutsRef.current.values()) {
          clearTimeout(timeoutId)
        }
        optimisticUpdateTimeoutsRef.current.clear()
      }
      // Clear optimistic updates map on unmount
      pendingOptimisticUpdatesRef.current.clear()
    }
  }, [])

  // Helper function to check if SSE update should be applied
  // FIXED: Prevent SSE from overwriting optimistic updates (Issue #2)
  const shouldApplySSEUpdate = useCallback((emailId: string, sseUpdatedAt: number): boolean => {
    const pendingTimestamp = pendingOptimisticUpdatesRef.current.get(emailId)
    
    // If there's no pending optimistic update, always apply SSE update
    if (!pendingTimestamp) {
      return true
    }
    
    // FIXED: Handle timestamp precision mismatch between server (seconds) and client (milliseconds)
    // pendingTimestamp is in milliseconds (from Date.now())
    // sseUpdatedAt is in seconds (Unix timestamp from server)
    // Convert SSE timestamp to milliseconds for comparison
    const sseTimestampMs = sseUpdatedAt * 1000
    
    // CRITICAL: When server processes an update within the same second as the client's optimistic update,
    // the converted SSE timestamp (rounded down to start of second) will be EARLIER than the client's
    // precise millisecond timestamp. For example:
    // - Client optimistic update: 1234567890500 (500ms into second)
    // - Server SSE timestamp: 1234567890 (start of second) -> 1234567890000ms
    // - Difference: -500ms (SSE appears earlier, but it's actually the same update)
    // 
    // Solution: Handle precision loss for older updates (within 500ms), but block significantly older updates.
    // For newer updates, allow if at least 500ms newer OR within the same second (to handle precision).
    const timeDiffMs = sseTimestampMs - pendingTimestamp
    
    // If SSE is newer (positive timeDiffMs):
    // - Allow if it's at least 500ms newer (legitimate real-time update from another source)
    // - This prevents SSE from immediately reverting optimistic updates (same-second echo)
    // - Precision loss only affects negative timeDiffMs (when server timestamp is rounded down)
    if (timeDiffMs >= 0) {
      // Allow if >= 500ms (prevents 0-499ms echo, allows 500ms+ legitimate updates)
      return timeDiffMs >= 500
    }
    
    // If SSE is older (negative timeDiffMs):
    // - Block if it's within 500ms older (likely the same update being echoed back due to precision loss)
    // - Only allow if it's significantly older (< -500ms), which would be unusual and might indicate
    //   a legitimate older update from another source (though this is rare)
    // This prevents SSE echoes from overwriting optimistic updates while still allowing edge cases
    return timeDiffMs < -500
  }, [])

  // Use infinite scroll hook for emails
  const {
    emails,
    total,
    stats: emailStats,
    loading,
    hasMore,
    loadMore,
    refetch: fetchEmails,
    updateItem,
    addItem,
    removeItem,
    replaceItem
  } = useInfiniteAdminEmails({
    baseEndpoint,
    pageSize,
    refetchInterval,
    enabled: !!session,
    isDialogOpen: () => viewDialogOpen,
    onStatsUpdate: (stats) => {
      setStats(stats)
    },
  })

  // Real-time email queue updates via SSE (replaces polling)
  const sseHookResult = useAdminEmailsSSE({
    enabled: !!session,
    onEmailUpdate: (event) => {
      // Handle email status changes
      if (event.email) {
        const email = event.email
        
        // Handle new email queued - add to list
        if (event.type === 'email:queued') {
          // FIXED: Check if SSE update should be applied (prevent overwriting optimistic updates) (Issue #2)
          // For new emails, we check updatedAt timestamp to prevent overwriting recently created emails
          if (!shouldApplySSEUpdate(email.id, email.updatedAt)) {
            // Skip this SSE update - optimistic update is pending
            return
          }
          
          // Create EmailQueueItem from SSE event data
          // Note: SSE event may not have all fields, so we use defaults for missing ones
          const emailItem: EmailQueueItem = {
            id: email.id,
            emailType: email.emailType,
            recipientEmail: email.recipientEmail,
            subject: email.subject,
            htmlContent: '', // Will be loaded when email details are fetched
            textContent: '', // Will be loaded when email details are fetched
            metadata: undefined,
            retryCount: email.retryCount || 0,
            maxRetries: 5, // Default max retries (matches lib/email-queue.ts default)
            status: email.status,
            errorMessage: email.errorMessage || undefined,
            scheduledAt: email.scheduledAt || email.createdAt || Date.now(), // Use scheduledAt from SSE, fallback to createdAt, then current time
            nextRetryAt: email.nextRetryAt || undefined,
            sentAt: email.sentAt || undefined,
            createdAt: email.createdAt,
            updatedAt: email.updatedAt,
          }
          addItem(emailItem)
        } 
        // Update email in list if it exists
        else if (event.type === 'email:updated' || event.type === 'email:sent' || event.type === 'email:failed' || event.type === 'email:processing') {
          // FIXED: Check if SSE update should be applied (prevent overwriting optimistic updates) (Issue #2)
          if (!shouldApplySSEUpdate(email.id, email.updatedAt)) {
            // Skip this SSE update - optimistic update is pending
            return
          }
          
          updateItem(email.id, {
            status: email.status as any,
            retryCount: email.retryCount || 0,
            errorMessage: email.errorMessage || undefined,
            scheduledAt: email.scheduledAt ?? email.createdAt ?? Date.now(), // Use scheduledAt from SSE, fallback to createdAt, then current time
            nextRetryAt: email.nextRetryAt || undefined,
            sentAt: email.sentAt || undefined,
            updatedAt: email.updatedAt,
          })
        } 
        // Remove email from list if deleted
        else if (event.type === 'email:deleted') {
          removeItem(email.id)
        }
      }
    },
    onStatsUpdate: (stats) => {
      // Update stats when received from SSE
      setStats(stats)
    },
  })

  // Update SSE status state for fallback polling
  useEffect(() => {
    setSseError(sseHookResult.error)
    setSseConnected(sseHookResult.connected)
  }, [sseHookResult.error, sseHookResult.connected])
  
  // Infinite scroll setup
  const { elementRef: scrollSentinelRef } = useInfiniteScroll({
    hasMore,
    loading,
    onLoadMore: loadMore,
    threshold: 200,
    enabled: !!session && !viewDialogOpen,
  })

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])


  // Process queue
  const handleProcessQueue = async () => {
    try {
      setProcessing(true)
      const response = await fetch(API_PATHS.adminEmailQueue, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process", limit: 10 }),
      })
      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { result: {...} } }
        const responseData = json.data || json
        const result = responseData.result || responseData
        toast.success(`Processed: ${result.sent} sent, ${result.failed} failed`)
        // Invalidate emails cache to trigger refetch
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminEmails')
          window.dispatchEvent(event)
        }
      } else {
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to process queue"
        toast.error(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to process queue"
      toast.error(errorMsg)
      console.error(error)
    } finally {
      setProcessing(false)
    }
  }

  // Retry specific email
  const handleRetryEmail = async (id: string) => {
    // FIXED: Register optimistic update BEFORE API call to prevent SSE events from arriving first (Issue #2, Issue #5)
    // This closes the timing window where SSE events could arrive before optimistic registration
    const optimisticUpdateTimestamp = Date.now()
    pendingOptimisticUpdatesRef.current.set(id, optimisticUpdateTimestamp)
    
    // FIXED: Set timeout to clear optimistic update after grace period (Issue #2, Issue #5)
    // Use id in closure to ensure correct email is referenced after delay
    const timeoutId = setTimeout(() => {
      const currentTimestamp = pendingOptimisticUpdatesRef.current.get(id)
      // Only clear if this is still the same optimistic update (not overwritten by another)
      if (currentTimestamp === optimisticUpdateTimestamp) {
        pendingOptimisticUpdatesRef.current.delete(id)
      }
    }, 2000) // 2 second grace period for server response
    
    // FIXED: Store timeout ID for cleanup (Issue #2, Issue #5)
    // Clear any existing timeout for this email before storing new one
    // This prevents memory leaks and unnecessary callback executions when
    // optimistic updates are triggered multiple times for the same email
    const existingTimeout = optimisticUpdateTimeoutsRef.current.get(id)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    optimisticUpdateTimeoutsRef.current.set(id, timeoutId)
    
    try {
      const response = await fetch(API_PATHS.adminEmailQueueItem(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      })
      
      if (!response.ok) {
        // FIXED: Clear optimistic update on error (Issue #2, Issue #5)
        // Clear timeout if it hasn't fired yet
        const timeoutId = optimisticUpdateTimeoutsRef.current.get(id)
        if (timeoutId) {
          clearTimeout(timeoutId)
          optimisticUpdateTimeoutsRef.current.delete(id)
        }
        // Clear optimistic update timestamp
        pendingOptimisticUpdatesRef.current.delete(id)
        
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` }
        }
        const errorMsg = typeof errorData.error === 'string' ? errorData.error : JSON.stringify(errorData.error) || "Failed to retry email"
        toast.error(errorMsg)
        return
      }
      
      const json = await response.json()
      if (json.success) {
        const updatedEmail = json.data?.email || json.email
        // FIXED: Clear optimistic update timeout on successful server response (Issue #2, Issue #5)
        // Clear timeout if it hasn't fired yet
        const timeoutId = optimisticUpdateTimeoutsRef.current.get(id)
        if (timeoutId) {
          clearTimeout(timeoutId)
          optimisticUpdateTimeoutsRef.current.delete(id)
        }
        // Note: Keep optimistic update timestamp until SSE confirms or timeout expires
        // This ensures SSE events arriving after API response are still blocked
        
        // Update the email status with server response
        if (updatedEmail) {
          replaceItem(id, updatedEmail)
        }
        toast.success("Email retried successfully")
        // Invalidate emails cache to trigger refetch
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminEmails')
          window.dispatchEvent(event)
        }
      } else {
        // FIXED: Clear optimistic update on error (Issue #2, Issue #5)
        // Clear timeout if it hasn't fired yet
        const timeoutId = optimisticUpdateTimeoutsRef.current.get(id)
        if (timeoutId) {
          clearTimeout(timeoutId)
          optimisticUpdateTimeoutsRef.current.delete(id)
        }
        // Clear optimistic update timestamp
        pendingOptimisticUpdatesRef.current.delete(id)
        
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to retry email"
        toast.error(errorMsg)
      }
    } catch (error) {
      // FIXED: Clear optimistic update on error (Issue #2, Issue #5)
      // Clear timeout if it hasn't fired yet
      const timeoutId = optimisticUpdateTimeoutsRef.current.get(id)
      if (timeoutId) {
        clearTimeout(timeoutId)
        optimisticUpdateTimeoutsRef.current.delete(id)
      }
      // Clear optimistic update timestamp
      pendingOptimisticUpdatesRef.current.delete(id)
      
      const errorMsg = error instanceof Error ? error.message : "Failed to retry email"
      toast.error(errorMsg)
      console.error("Retry email error:", error)
    }
  }

  // Handle delete email - open confirmation dialog
  const handleDeleteEmail = (id: string) => {
    const email = emails.find(e => e.id === id)
    if (email) {
      setEmailToDelete(email)
      setDeleteDialogOpen(true)
    }
  }

  // Confirm delete email - actually perform the deletion
  const confirmDeleteEmail = async () => {
    if (!emailToDelete) return

    try {
      setDeleting(true)
      // Optimistically remove from list
      removeItem(emailToDelete.id)
      
      const response = await fetch(API_PATHS.adminEmailQueueItem(emailToDelete.id), {
        method: "DELETE",
      })
      const json = await response.json()
      if (json.success) {
        toast.success("Email deleted successfully")
        setDeleteDialogOpen(false)
        setEmailToDelete(null)
        // Invalidate emails cache to trigger refetch
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminEmails')
          window.dispatchEvent(event)
        }
      } else {
        // Rollback on error - invalidate to refetch
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('invalidateAdminEmails')
          window.dispatchEvent(event)
        }
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to delete email"
        toast.error(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to delete email"
      toast.error(errorMsg)
      console.error(error)
    }
  }

  // Cleanup all sent emails
  const handleCleanup = async () => {
    try {
      setCleaningUp(true)
      const response = await fetch(API_PATHS.adminEmailQueue, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup" }),
      })
      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { deletedCount: ... } }
        const responseData = json.data || json
        toast.success(`Cleaned up ${responseData.deletedCount || 0} sent emails`)
        // Refresh to get updated list after cleanup
        fetchEmails()
        setCleanupDialogOpen(false)
      } else {
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to cleanup"
        toast.error(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to cleanup"
      toast.error(errorMsg)
      console.error(error)
    } finally {
      setCleaningUp(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
      processing: { color: "bg-blue-100 text-blue-800", icon: RefreshCw },
      sent: { color: "bg-green-100 text-green-800", icon: CheckCircle2 },
      failed: { color: "bg-red-100 text-red-800", icon: XCircle },
      cancelled: { color: "bg-gray-100 text-gray-800", icon: X },
    }

    const variant = variants[status] || variants.pending
    const Icon = variant.icon

    return (
      <Badge className={variant.color}>
        <Icon className="w-3 h-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getEmailTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      admin_notification: "Admin Notification",
      user_confirmation: "User Confirmation",
      status_change: "Status Change",
      user_response: "User Response",
      auto_update: "Auto Update",
    }
    return labels[type] || type
  }

  const formatTimestamp = (timestamp: number | null | undefined) => {
    if (!timestamp) return "N/A"
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const timestampMs = timestamp > 1000000000000 
        ? timestamp // Already in milliseconds
        : timestamp * 1000 // Convert from seconds to milliseconds
      
      // CRITICAL: Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      
      return format(bangkokDate, "MMM dd, yyyy 'at' h:mm a")
    } catch (error) {
      console.error("Error formatting timestamp:", timestamp, error)
      return "N/A"
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Email Queue Management</h1>
        <p className="text-sm sm:text-base text-gray-600">Manage failed and pending email notifications</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Total</div>
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg shadow">
          <div className="text-sm text-yellow-600">Pending</div>
          <div className="text-2xl font-bold text-yellow-900">{stats.pending}</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg shadow">
          <div className="text-sm text-blue-600">Processing</div>
          <div className="text-2xl font-bold text-blue-900">{stats.processing}</div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg shadow">
          <div className="text-sm text-red-600">Failed</div>
          <div className="text-2xl font-bold text-red-900">{stats.failed}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg shadow">
          <div className="text-sm text-green-600">Sent</div>
          <div className="text-2xl font-bold text-green-900">{stats.sent}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center">
        <Button onClick={handleProcessQueue} disabled={processing} className="w-full sm:w-auto">
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Process Queue
            </>
          )}
        </Button>
        <Button onClick={() => setCleanupDialogOpen(true)} variant="outline" className="w-full sm:w-auto">
          <Trash className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Cleanup All Sent Emails</span>
          <span className="sm:hidden">Cleanup</span>
        </Button>
        <Button onClick={fetchEmails} variant="outline" className="w-full sm:w-auto">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={emailTypeFilter} onValueChange={setEmailTypeFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="admin_notification">Admin Notification</SelectItem>
            <SelectItem value="user_confirmation">User Confirmation</SelectItem>
            <SelectItem value="status_change">Status Change</SelectItem>
            <SelectItem value="user_response">User Response</SelectItem>
            <SelectItem value="auto_update">Auto Update</SelectItem>
          </SelectContent>
        </Select>
        <div className="w-full sm:w-64">
          <SearchInputWithHistory
            value={bookingReferenceFilter}
            onChange={setBookingReferenceFilter}
            onSearch={handleBookingReferenceSearch}
            debouncedOnSearch={handleBookingReferenceDebouncedSearch}
            placeholder="Search booking reference..."
            storageKey="email-queue-search-booking-ref"
            className="w-full"
          />
        </div>
      </div>

      {/* Emails Table */}
      {emails.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Mail className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No emails found</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retries</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {emails.map((email) => (
                    <tr key={email.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getEmailTypeLabel(email.emailType)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {email.recipientEmail}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md truncate">
                        {email.subject}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(email.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {email.retryCount} / {email.maxRetries}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatTimestamp(email.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedEmail(email)
                              setViewDialogOpen(true)
                            }}
                          >
                            View
                          </Button>
                          {email.status === "pending" || email.status === "failed" ? (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleRetryEmail(email.id)}
                            >
                              <Play className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteEmail(email.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Page size selector and total count */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{emails.length}</span> of <span className="font-medium">{total}</span> emails
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Items per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(parseInt(value))
                    fetchEmails()
                  }}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!hasMore && emails.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
                No more emails to load
              </div>
            )}
          </div>

          {/* Mobile/Tablet Card View */}
          <div className="lg:hidden space-y-4">
            {emails.map((email) => (
              <div
                key={email.id}
                className="bg-white rounded-lg shadow p-4 sm:p-6"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusBadge(email.status)}
                      <span className="text-xs font-medium text-gray-500">
                        {getEmailTypeLabel(email.emailType)}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-1 truncate">
                      {email.subject}
                    </h3>
                    <div className="flex items-center gap-1 text-sm text-gray-600 mb-2">
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{email.recipientEmail}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mb-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Retries:</span>
                    <span className="text-gray-900 font-medium">{email.retryCount} / {email.maxRetries}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Created:</span>
                    <span className="text-gray-900">{formatTimestamp(email.createdAt)}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setSelectedEmail(email)
                      setViewDialogOpen(true)
                    }}
                  >
                    View
                  </Button>
                  {email.status === "pending" || email.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={() => handleRetryEmail(email.id)}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Retry
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => handleDeleteEmail(email.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {/* Page size selector and total count for mobile */}
            <div className="bg-white rounded-lg shadow px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{emails.length}</span> of <span className="font-medium">{total}</span>
              </div>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(parseInt(value))
                  fetchEmails()
                }}
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!hasMore && emails.length > 0 && (
              <div className="bg-white rounded-lg shadow px-4 py-3 text-center text-sm text-gray-500">
                No more emails to load
              </div>
            )}
          </div>
        </>
      )}

      {/* View Email Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Queue Item Details</DialogTitle>
            <DialogDescription>View email details and metadata</DialogDescription>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-gray-600">Type</div>
                  <div className="text-sm text-gray-900">{getEmailTypeLabel(selectedEmail.emailType)}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-600">Status</div>
                  <div>{getStatusBadge(selectedEmail.status)}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-600">Recipient</div>
                  <div className="text-sm text-gray-900">{selectedEmail.recipientEmail}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-600">Retries</div>
                  <div className="text-sm text-gray-900">{selectedEmail.retryCount} / {selectedEmail.maxRetries}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-600">Subject</div>
                  <div className="text-sm text-gray-900">{selectedEmail.subject}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-600">Created</div>
                  <div className="text-sm text-gray-900">{formatTimestamp(selectedEmail.createdAt)}</div>
                </div>
                {selectedEmail.nextRetryAt && (
                  <div>
                    <div className="text-sm font-medium text-gray-600">Next Retry</div>
                    <div className="text-sm text-gray-900">{formatTimestamp(selectedEmail.nextRetryAt)}</div>
                  </div>
                )}
                {selectedEmail.sentAt && (
                  <div>
                    <div className="text-sm font-medium text-gray-600">Sent At</div>
                    <div className="text-sm text-gray-900">{formatTimestamp(selectedEmail.sentAt)}</div>
                  </div>
                )}
              </div>
              {selectedEmail.errorMessage && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">Error Message</div>
                  <div className="bg-red-50 p-3 rounded text-sm text-red-900">
                    {typeof selectedEmail.errorMessage === 'string' 
                      ? selectedEmail.errorMessage 
                      : JSON.stringify(selectedEmail.errorMessage, null, 2)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-gray-600 mb-2">Email Content (Text)</div>
                <div className="bg-gray-50 p-3 rounded text-sm text-gray-900 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {selectedEmail.textContent}
                </div>
              </div>
              {selectedEmail.metadata && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">Metadata</div>
                  <div className="bg-gray-50 p-3 rounded text-sm text-gray-900">
                    <pre className="whitespace-pre-wrap">
                      {(() => {
                        try {
                          // If metadata is already a string, try to parse and re-stringify for formatting
                          if (typeof selectedEmail.metadata === 'string') {
                            try {
                              const parsed = JSON.parse(selectedEmail.metadata)
                              return JSON.stringify(parsed, null, 2)
                            } catch {
                              return selectedEmail.metadata
                            }
                          }
                          // If it's an object, stringify it
                          return JSON.stringify(selectedEmail.metadata, null, 2)
                        } catch (error) {
                          return `Error displaying metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                      })()}
                    </pre>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                {(selectedEmail.status === "pending" || selectedEmail.status === "failed") && (
                  <Button onClick={() => {
                    handleRetryEmail(selectedEmail.id)
                    setViewDialogOpen(false)
                  }}>
                    <Play className="w-4 h-4 mr-2" />
                    Retry Email
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <GenericDeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Email from Queue"
        description="Are you sure you want to delete this email from the queue?"
        itemName={emailToDelete ? `Email ID: ${emailToDelete.id}` : undefined}
        itemDetails={emailToDelete ? (
          <div className="space-y-1 text-xs">
            <div><span className="font-medium">To:</span> {emailToDelete.recipientEmail}</div>
            <div><span className="font-medium">Subject:</span> {emailToDelete.subject || "N/A"}</div>
            <div><span className="font-medium">Status:</span> {emailToDelete.status}</div>
            <div><span className="font-medium">Type:</span> {emailToDelete.emailType}</div>
            {emailToDelete.createdAt && (
              <div><span className="font-medium">Created:</span> {format(new Date(emailToDelete.createdAt * 1000), "MMM dd, yyyy 'at' h:mm a")}</div>
            )}
          </div>
        ) : undefined}
        warningMessage="This email will be permanently removed from the queue. This action cannot be undone."
        onConfirm={confirmDeleteEmail}
        onCancel={() => {
          setDeleteDialogOpen(false)
          setEmailToDelete(null)
        }}
        isLoading={deleting}
        confirmButtonText="Delete Email"
      />

      {/* Cleanup Confirmation Dialog */}
      <GenericDeleteConfirmationDialog
        open={cleanupDialogOpen}
        onOpenChange={setCleanupDialogOpen}
        title="Cleanup All Sent Emails"
        description="Are you sure you want to delete all sent emails?"
        itemName="All Sent Emails"
        itemDetails={
          <div className="space-y-1 text-xs">
            <div>This will permanently delete all emails with status "sent" from the queue.</div>
            <div className="text-gray-500 mt-2">This action cannot be undone.</div>
          </div>
        }
        warningMessage="All sent emails will be permanently deleted from the queue. This action cannot be undone."
        onConfirm={handleCleanup}
        onCancel={() => setCleanupDialogOpen(false)}
        isLoading={cleaningUp}
        confirmButtonText="Cleanup Emails"
      />
    </div>
  )
}

