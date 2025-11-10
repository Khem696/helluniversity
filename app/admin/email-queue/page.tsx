"use client"

import { useState, useEffect } from "react"
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

interface EmailQueueItem {
  id: string
  emailType: "admin_notification" | "user_confirmation" | "status_change" | "user_response" | "auto_update"
  recipientEmail: string
  subject: string
  htmlContent: string
  textContent: string
  metadata?: any
  retryCount: number
  maxRetries: number
  status: "pending" | "processing" | "sent" | "failed" | "cancelled"
  errorMessage?: string
  scheduledAt: number
  nextRetryAt?: number
  sentAt?: number
  createdAt: number
  updatedAt: number
}

interface EmailQueueStats {
  pending: number
  processing: number
  failed: number
  sent: number
  total: number
}

export default function EmailQueuePage() {
  const { data: session, status } = useSession()
  const [emails, setEmails] = useState<EmailQueueItem[]>([])
  const [stats, setStats] = useState<EmailQueueStats>({
    pending: 0,
    processing: 0,
    failed: 0,
    sent: 0,
    total: 0,
  })
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<EmailQueueItem | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [emailTypeFilter, setEmailTypeFilter] = useState<string>("all")

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // Fetch emails and stats
  const fetchEmails = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }
      if (emailTypeFilter !== "all") {
        params.append("emailType", emailTypeFilter)
      }
      params.append("limit", "50")

      const response = await fetch(`/api/admin/email-queue?${params.toString()}`)
      const data = await response.json()
      if (data.success) {
        setEmails(data.items || [])
        setStats(data.stats || stats)
      } else {
        toast.error(data.error || "Failed to load email queue")
      }
    } catch (error) {
      toast.error("Failed to load email queue")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchEmails()
    }
  }, [session, statusFilter, emailTypeFilter])

  // Process queue
  const handleProcessQueue = async () => {
    try {
      setProcessing(true)
      const response = await fetch("/api/admin/email-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process", limit: 10 }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`Processed: ${data.result.sent} sent, ${data.result.failed} failed`)
        fetchEmails()
      } else {
        toast.error(data.error || "Failed to process queue")
      }
    } catch (error) {
      toast.error("Failed to process queue")
      console.error(error)
    } finally {
      setProcessing(false)
    }
  }

  // Retry specific email
  const handleRetryEmail = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/email-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success("Email retried successfully")
        fetchEmails()
      } else {
        toast.error(data.error || "Failed to retry email")
      }
    } catch (error) {
      toast.error("Failed to retry email")
      console.error(error)
    }
  }

  // Delete email
  const handleDeleteEmail = async (id: string) => {
    if (!confirm("Are you sure you want to delete this email from the queue?")) {
      return
    }

    try {
      const response = await fetch(`/api/admin/email-queue/${id}`, {
        method: "DELETE",
      })
      const data = await response.json()
      if (data.success) {
        toast.success("Email deleted successfully")
        fetchEmails()
      } else {
        toast.error(data.error || "Failed to delete email")
      }
    } catch (error) {
      toast.error("Failed to delete email")
      console.error(error)
    }
  }

  // Cleanup old sent emails
  const handleCleanup = async () => {
    if (!confirm("Delete all sent emails older than 30 days?")) {
      return
    }

    try {
      const response = await fetch("/api/admin/email-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup", daysOld: 30 }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`Cleaned up ${data.deletedCount} old emails`)
        fetchEmails()
      } else {
        toast.error(data.error || "Failed to cleanup")
      }
    } catch (error) {
      toast.error("Failed to cleanup")
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
    return format(new Date(timestamp * 1000), "MMM dd, yyyy 'at' h:mm a")
  }

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Email Queue Management</h1>
        <p className="text-gray-600">Manage failed and pending email notifications</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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
      <div className="mb-6 flex gap-4 items-center">
        <Button onClick={handleProcessQueue} disabled={processing}>
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
        <Button onClick={handleCleanup} variant="outline">
          <Trash className="w-4 h-4 mr-2" />
          Cleanup Old Sent Emails
        </Button>
        <Button onClick={fetchEmails} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
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
          <SelectTrigger className="w-48">
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
        <div className="bg-white rounded-lg shadow overflow-hidden">
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
        </div>
      )}

      {/* View Email Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Queue Item Details</DialogTitle>
            <DialogDescription>View email details and metadata</DialogDescription>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
                    {selectedEmail.errorMessage}
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
                    <pre className="whitespace-pre-wrap">{JSON.stringify(selectedEmail.metadata, null, 2)}</pre>
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

