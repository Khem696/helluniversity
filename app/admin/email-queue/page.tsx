"use client"

import { useState, useEffect, useMemo } from "react"
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
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll"

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
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailTypeFilter, setEmailTypeFilter] = useState<string>("all")
  const [pageSize, setPageSize] = useState(25)
  
  // Build base endpoint with filters (without limit/offset for infinite scroll)
  const baseEndpoint = useMemo(() => {
    const params = new URLSearchParams()
    if (statusFilter !== "all") {
      params.append("status", statusFilter)
    }
    if (emailTypeFilter !== "all") {
      params.append("emailType", emailTypeFilter)
    }
    return buildApiUrl(API_PATHS.adminEmailQueue, Object.fromEntries(params))
  }, [statusFilter, emailTypeFilter])
  
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
    removeItem,
    replaceItem
  } = useInfiniteAdminEmails({
    baseEndpoint,
    pageSize,
    refetchInterval: 30000,
    enabled: !!session,
    isDialogOpen: () => viewDialogOpen,
    onStatsUpdate: (stats) => {
      setStats(stats)
    },
  })
  
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
      const response = await fetch("/api/v1/admin/email-queue", {
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
    try {
      const response = await fetch(API_PATHS.adminEmailQueueItem(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      })
      
      if (!response.ok) {
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
        // Update the email status optimistically
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
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to retry email"
        toast.error(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to retry email"
      toast.error(errorMsg)
      console.error("Retry email error:", error)
    }
  }

  // Delete email
  const handleDeleteEmail = async (id: string) => {
    if (!confirm("Are you sure you want to delete this email from the queue?")) {
      return
    }

    try {
      // Optimistically remove from list
      removeItem(id)
      
      const response = await fetch(API_PATHS.adminEmailQueueItem(id), {
        method: "DELETE",
      })
      const json = await response.json()
      if (json.success) {
        toast.success("Email deleted successfully")
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

  // Cleanup old sent emails
  const handleCleanup = async () => {
    if (!confirm("Delete all sent emails older than 30 days?")) {
      return
    }

    try {
      const response = await fetch("/api/v1/admin/email-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup", daysOld: 30 }),
      })
      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { deletedCount: ... } }
        const responseData = json.data || json
        toast.success(`Cleaned up ${responseData.deletedCount || 0} old emails`)
        // Refresh to get updated list after cleanup
        fetchEmails()
      } else {
        const errorMsg = typeof json.error === 'string' ? json.error : json.error?.message || JSON.stringify(json.error) || "Failed to cleanup"
        toast.error(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to cleanup"
      toast.error(errorMsg)
      console.error(error)
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
        <Button onClick={handleCleanup} variant="outline" className="w-full sm:w-auto">
          <Trash className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Cleanup Old Sent Emails</span>
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
    </div>
  )
}

